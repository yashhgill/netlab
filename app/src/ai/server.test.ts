import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from '../../../functions/api/ai';

const env = {
  GROQ_API_KEY: 'gsk_test',
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
};

function mockFetch(profile: { pro_until: string | null; is_admin: boolean }, groqReplies: unknown[]) {
  const groqCalls: { messages: { role: string; content?: string }[]; tools?: unknown }[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/auth/v1/user')) {
      return (init?.headers as Record<string, string>).authorization === 'Bearer good'
        ? new Response(JSON.stringify({ id: 'u1', email: 'a@b.c' }))
        : new Response('{}', { status: 401 });
    }
    if (url.includes('/rest/v1/profiles')) return new Response(JSON.stringify([profile]));
    if (url.includes('/rpc/bump_my_ai_usage')) return new Response('3');
    if (url.startsWith('https://generativelanguage.googleapis.com')) {
      groqCalls.push({ ...JSON.parse(String(init?.body)), provider: 'gemini' } as never);
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '{"reply":"From Gemini.","subnets":[],"actions":[]}' } }] }));
    }
    if (url.startsWith('https://api.groq.com')) {
      groqCalls.push(JSON.parse(String(init?.body)));
      const next = groqReplies.shift();
      if (next && typeof next === 'object' && '__rate' in (next as object)) return new Response(JSON.stringify({ error: { message: (next as { __rate: string }).__rate } }), { status: 429 });
      if (next === 'RATE') return new Response(JSON.stringify({ error: { message: 'Rate limit reached for model. Please try again in 0.05s.' } }), { status: 429 });
      return new Response(JSON.stringify({ choices: [{ message: next }] }));
    }
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', f);
  return groqCalls;
}

const req = (token: string, body: unknown) =>
  new Request('https://x/api/ai', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });

afterEach(() => vi.unstubAllGlobals());

describe('/api/ai', () => {
  it('rejects anonymous and free users', async () => {
    mockFetch({ pro_until: null, is_admin: false }, []);
    expect((await onRequestPost({ request: req('bad', { prompt: 'hi' }), env })).status).toBe(401);
    const r = await onRequestPost({ request: req('good', { prompt: 'hi' }), env });
    expect(r.status).toBe(402);
    expect((await r.json()).code).toBe('pro');
  });

  it('runs the VLSM tool and returns the parsed plan', async () => {
    const calls = mockFetch({ pro_until: new Date(Date.now() + 86400e3).toISOString(), is_admin: false }, [
      { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'vlsm', arguments: JSON.stringify({ base: '10.0.0.0/24', needs: [{ name: 'A', hosts: 100 }, { name: 'B', hosts: 2 }] }) } }] },
      {
        role: 'assistant',
        content: '```json\n{"reply":"Planned.","subnets":[{"name":"A","network":"10.0.0.0","prefix":25}],"actions":[{"type":"host_ip","device":"PC0","ip":"10.0.0.10","mask":"255.255.255.128","gateway":"10.0.0.1"}]}\n```',
      },
    ]);
    const r = await onRequestPost({ request: req('good', { prompt: 'plan it', topology: { devices: [] } }), env });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.reply).toBe('Planned.');
    expect(body.actions).toHaveLength(1);
    expect(body.usage).toEqual({ used: 3, limit: 150 });
    // the tool result went back to the model with the exact allocation
    const toolMsg = calls[1].messages.find((m) => m.role === 'tool');
    expect(JSON.parse(toolMsg!.content!).subnets.map((s: { network: string; prefix: number }) => `${s.network}/${s.prefix}`)).toEqual(['10.0.0.0/25', '10.0.0.128/30']);
    expect(calls[0].tools).toBeDefined();
  });

  it('waits out a per-minute rate limit and retries', async () => {
    const calls = mockFetch({ pro_until: null, is_admin: true }, ['RATE', { role: 'assistant', content: '{"reply":"Hi.","subnets":[],"actions":[]}' }]);
    const r = await onRequestPost({ request: req('good', { prompt: 'hello' }), env });
    expect(r.status).toBe(200);
    expect((await r.json()).reply).toBe('Hi.');
    expect(calls).toHaveLength(2);
  });

  it('hands over to the next free provider when one is busy', async () => {
    const calls = mockFetch({ pro_until: null, is_admin: true }, [{ __rate: 'Rate limit reached. Please try again in 50s.' }]);
    const r = await onRequestPost({ request: req('good', { prompt: 'hello' }), env: { ...env, GEMINI_API_KEY: 'g' } });
    const body = await r.json();
    expect(r.status).toBe(200);
    expect(body.reply).toBe('From Gemini.');
    expect(body.provider).toBe('Gemini');
    expect(calls).toHaveLength(2);
  });
});
