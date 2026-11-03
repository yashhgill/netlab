/**
 * NetLab AI assistant (Cloudflare Pages Function, served at /api/ai).
 *
 * 1. Checks the caller's Supabase session. Pro accounts get "build" answers (actions NetLab
 *    applies, and lab sheets or pictures read); free accounts get "guide" answers (steps and
 *    the exact commands to type).
 * 2. Counts usage per day.
 * 3. Asks a free AI provider (Groq, then Gemini, Cerebras or OpenRouter when one is busy)
 *    for help, giving it exact subnet calculators as tools,
 *    and returns a reply plus a list of actions the app can preview and apply.
 *
 * Settings (wrangler.toml [vars] or Cloudflare Pages > Settings > Variables):
 *   Secrets (any one or more): GROQ_API_KEY, GEMINI_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY
 *   Optional model overrides: GROQ_MODEL, GEMINI_MODEL, CEREBRAS_MODEL, OPENROUTER_MODEL
 *   SUPABASE_URL, SUPABASE_ANON_KEY, AI_DAILY_LIMIT (optional)
 *
 * Supabase is called with the user's own sign-in token, so row level security
 * applies and no service key is needed.
 */
import { subnetInfo, vlsm } from '../../app/src/engine/vlsm';

interface Env {
  GROQ_API_KEY?: string;
  GROQ_MODEL?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  CEREBRAS_API_KEY?: string;
  CEREBRAS_MODEL?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  AI_DAILY_LIMIT?: string;
  /** Daily requests for free accounts (guided answers). */
  AI_FREE_DAILY_LIMIT?: string;
  /** Groq model used when pictures are attached (must accept images). */
  GROQ_VISION_MODEL?: string;
  /** Set at runtime when the model doesn't accept reasoning_effort. */
  __noReasoningParam?: boolean;
}

interface Ctx {
  request: Request;
  env: Env;
}

const DEFAULT_MODEL = 'qwen/qwen3.8-27b';
const MAX_TOOL_ROUNDS = 3;
/** Longest total time to wait out the provider's per-minute limits within one request. */
const MAX_RATE_WAIT_MS = 30000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const RULES = `Rules:
- For any subnetting or VLSM, ALWAYS call the vlsm or subnet_info tool. Never do subnet arithmetic yourself. Copy network, mask, gateway and range values exactly from the tool output.
- Give each LAN's default gateway the first usable address of its subnet unless the user or their document says otherwise.
- Point-to-point links between routers use /30 subnets.
- Hosts get addresses from the usable range of their own LAN, never the network, broadcast or gateway address, and never an address another device already uses.
- Only use device names and port names that exist in the topology, unless you add devices with add_device first. Pick free ports listed in freePorts.
- Router and switch configuration is IOS-style. Router interfaces start shut down, so include "no shutdown".
- Static routes: "ip route <network> <mask> <next-hop>". Every router needs a route to every network it is not directly connected to (or a default route), and the return path too.
- Multilayer switches need "ip routing". Serial DCE ends need "clock rate 64000".
- VLANs: create them on the switch ("vlan 10", "name STAFF"), set access ports ("switchport mode access", "switchport access vlan 10") and trunk the uplink ("switchport mode trunk"). Router-on-a-stick uses sub-interfaces "interface g0/0.10", "encapsulation dot1Q 10", "ip address ...", and "no shutdown" on the parent interface.
- DHCP on a router: "ip dhcp excluded-address <first> <last>", "ip dhcp pool NAME", "network <net> <mask>", "default-router <gw>", "dns-server <ip>"; hosts then use host_dhcp. A DHCP server on another network needs "ip helper-address" on the LAN interface.
- Supported features: static routing, VLANs, 802.1Q trunks, router-on-a-stick sub-interfaces, SVIs, routed ports (no switchport), DHCP pools, ip helper-address, serial links (clock rate, encapsulation ppp/hdlc), passwords, banners, wireless access points (clients join by SSID; wireless models NL-PC-W, NL-Laptop-W, NL-Tablet, NL-Smartphone). Not supported: OSPF, RIP, EIGRP, ACLs, NAT, STP tuning. If asked, explain and offer static routes instead.
- If the user attached documents or pictures (a lab sheet, a topology drawing, an addressing table), read them carefully and follow them exactly: the same device types, names, number of PCs, links, VLAN numbers and addresses. Only calculate what the document leaves out.
- Before you answer, check your own work: every address is inside its subnet, every host gateway is the router or SVI address of the same subnet, no address is used twice, every needed route exists in both directions.
- Keep explanations short, friendly and student-level. Use plain text with short lines; no markdown tables.`;

const SYSTEM_BUILD = `You are the NetLab assistant, an expert network engineer and patient CCNA tutor inside a network simulator.
The user's current topology is given as JSON. You design, address and configure it for them: you pick the devices, cable them, plan the subnets and write every configuration. NetLab applies your actions after the user reviews them.

${RULES}
- "cli" commands start in global configuration mode (after "configure terminal"), one command per array item, e.g. ["interface g0/0", "ip address 192.168.1.1 255.255.255.0", "no shutdown", "exit"].
- When building new devices, choose models from availableModels (e.g. a router with enough ports, a switch with enough access ports) and name them like R1, R2, S1, PC1.

Your FINAL message must be only a JSON object, no other text:
{
  "reply": "what you did and why, in a few short sentences",
  "subnets": [ { "name": "...", "network": "a.b.c.d", "prefix": 26, "mask": "...", "gateway": "...", "range": "first - last" } ],
  "actions": [
    { "type": "add_device", "kind": "router|switch|l3switch|hub|ap|pc|laptop|server|printer|phone|tablet|smartphone|tv", "model": "optional model id", "name": "R3" },
    { "type": "connect", "a": "R1", "aPort": "GigabitEthernet0/1", "b": "S1", "bPort": "GigabitEthernet0/1", "cable": "auto" },
    { "type": "cli", "device": "R1", "commands": ["..."] },
    { "type": "host_ip", "device": "PC0", "ip": "a.b.c.d", "mask": "a.b.c.d", "gateway": "a.b.c.d", "dns": "optional" },
    { "type": "host_dhcp", "device": "PC0" }
  ]
}
Order the actions: add devices, then cables, then configuration. Use "subnets": [] and "actions": [] when nothing needs to change (for example when only explaining).`;

const SYSTEM_GUIDE = `You are the NetLab tutor, an expert network engineer and patient CCNA tutor inside a network simulator.
The user's current topology is given as JSON. Guide them to the solution so they learn by doing it themselves: explain the plan, then give exact steps they follow and the exact commands to type. You do not change their network yourself.

${RULES}
- In "commands", give the full sequence to type in the device's CLI, starting from "enable" and "configure terminal" and ending with "end" and "write memory", one command per item.
- For PCs and other end devices, put the settings in "note" (IP address, subnet mask, default gateway, DNS) and leave "commands" empty, with "where": "desktop".
- For cabling, say which ports to join in "note" with "where": "cable". For adding devices, "where": "add".
- When they ask about one command or an error message, explain it simply and show the correct command.

Your FINAL message must be only a JSON object, no other text:
{
  "reply": "the plan and why, in a few short sentences",
  "subnets": [ { "name": "...", "network": "a.b.c.d", "prefix": 26, "mask": "...", "gateway": "...", "range": "first - last" } ],
  "steps": [
    { "title": "Configure R1's LAN interface", "device": "R1", "where": "cli|desktop|cable|add", "commands": ["enable", "configure terminal", "..."], "note": "optional short tip" }
  ]
}
Use "subnets": [] and "steps": [] when only explaining.`;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'vlsm',
      description: 'Exact VLSM allocation. Splits a base network into subnets sized for each host requirement, largest first.',
      parameters: {
        type: 'object',
        properties: {
          base: { type: 'string', description: 'Base network in CIDR form, e.g. 192.168.10.0/24' },
          needs: {
            type: 'array',
            items: {
              type: 'object',
              properties: { name: { type: 'string' }, hosts: { type: 'integer', description: 'Usable host addresses needed (use 2 for a point-to-point link)' } },
              required: ['name', 'hosts'],
            },
          },
        },
        required: ['base', 'needs'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'subnet_info',
      description: 'Network, mask, wildcard, broadcast and usable range for an address in CIDR form.',
      parameters: { type: 'object', properties: { cidr: { type: 'string', description: 'e.g. 10.1.5.77/27' } }, required: ['cidr'] },
    },
  },
];

function runTool(name: string, args: string): string {
  try {
    const a = JSON.parse(args || '{}');
    if (name === 'vlsm') return JSON.stringify(vlsm(String(a.base), Array.isArray(a.needs) ? a.needs.map((n: { name: unknown; hosts: unknown }) => ({ name: String(n.name), hosts: Number(n.hosts) })) : []));
    if (name === 'subnet_info') return JSON.stringify(subnetInfo(String(a.cidr)));
    return JSON.stringify({ error: `Unknown tool ${name}` });
  } catch {
    return JSON.stringify({ error: 'Arguments were not valid JSON' });
  }
}

async function getUser(env: Env, token: string) {
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  return (await r.json()) as { id: string; email?: string };
}

async function asUser(env: Env, token: string, path: string, init: RequestInit = {}) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

function extractJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1);
  try {
    const v = JSON.parse(candidate);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
type Msg = { role: string; content?: string | Part[] | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[]; tool_call_id?: string; name?: string };

class RateLimited extends Error {
  provider: string;
  constructor(message: string, provider: string) {
    super(message);
    this.provider = provider;
  }
}

/** One OpenAI-compatible chat provider. Free plans are tried in order; a busy one hands over to the next. */
interface Provider {
  name: string;
  url: string;
  key: string;
  model: string;
  headers?: Record<string, string>;
  /** Accepts pictures in the message. */
  vision: boolean;
  /** Extra request fields this provider understands. */
  tune?: (body: Record<string, unknown>) => Record<string, unknown>;
}

export function providers(env: Env): Provider[] {
  const list: Provider[] = [];
  if (env.GROQ_API_KEY)
    list.push({
      name: 'Groq',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      key: env.GROQ_API_KEY,
      model: env.GROQ_MODEL || DEFAULT_MODEL,
      vision: true,
      tune: (b) => ({ ...b, max_completion_tokens: (b.max_out as number) ?? 2048, ...(env.__noReasoningParam ? {} : { reasoning_effort: 'none' }) }),
    });
  if (env.GEMINI_API_KEY)
    list.push({
      name: 'Gemini',
      url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      key: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL || 'gemini-3.8-flash',
      vision: true,
      tune: (b) => ({ ...b, max_tokens: (b.max_out as number) ?? 2048, reasoning_effort: 'low' }),
    });
  if (env.CEREBRAS_API_KEY)
    list.push({
      name: 'Cerebras',
      url: 'https://api.cerebras.ai/v1/chat/completions',
      key: env.CEREBRAS_API_KEY,
      model: env.CEREBRAS_MODEL || 'gpt-oss-120b',
      vision: false,
      tune: (b) => ({ ...b, max_completion_tokens: (b.max_out as number) ?? 2048 }),
    });
  if (env.OPENROUTER_API_KEY)
    list.push({
      name: 'OpenRouter',
      url: 'https://openrouter.ai/api/v1/chat/completions',
      key: env.OPENROUTER_API_KEY,
      model: env.OPENROUTER_MODEL || 'openrouter/free',
      headers: { 'HTTP-Referer': 'https://netlab.harnova.my', 'X-Title': 'HarNova NetLab' },
      vision: true,
      tune: (b) => ({ ...b, max_tokens: (b.max_out as number) ?? 2048 }),
    });
  return list;
}

const waitFor = (msg: string) => {
  const m = msg.match(/try again in (?:(\d+)m)?([\d.]+)s/i) ?? msg.match(/retry (?:in|after) ([\d.]+)\s*s/i);
  if (!m) return 8000;
  return m.length === 3 ? (Number(m[1] ?? 0) * 60 + Number(m[2])) * 1000 + 300 : Number(m[1]) * 1000 + 300;
};

interface Budget {
  waited: number;
  /** Provider that last answered in this request; later rounds start with it. */
  prefer?: string;
  used?: string;
}

/**
 * Ask the providers in turn. A busy (rate-limited) or failing provider hands over
 * to the next one; only when every provider is busy do we wait briefly and retry.
 */
async function chat(env: Env, messages: Msg[], extra: Record<string, unknown>, budget: Budget = { waited: 0 }) {
  const pictures = messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'));
  const all = providers(env)
    .filter((p) => !pictures || p.vision)
    .map((p) => (pictures && p.name === 'Groq' && env.GROQ_VISION_MODEL ? { ...p, model: env.GROQ_VISION_MODEL } : p));
  if (!all.length) throw new Error(pictures ? 'No AI provider that can read pictures is set up.' : 'No AI provider is set up.');
  for (;;) {
    const order = budget.prefer ? [...all.filter((p) => p.name === budget.prefer), ...all.filter((p) => p.name !== budget.prefer)] : all;
    let soonest = Infinity;
    let lastLimit: RateLimited | null = null;
    let lastError: Error | null = null;
    for (const p of order) {
      try {
        const msg = await callOnce(env, p, messages, extra);
        budget.prefer = p.name;
        budget.used = p.name;
        return msg;
      } catch (e) {
        if (e instanceof RateLimited) {
          lastLimit = e;
          soonest = Math.min(soonest, waitFor(e.message));
        } else lastError = e as Error;
      }
    }
    if (!lastLimit) throw lastError ?? new Error('The AI service did not answer.');
    if (budget.waited + soonest > MAX_RATE_WAIT_MS) {
      const n = lastLimit.message.match(/Limit (\d+), Used (\d+), Requested (\d+)/);
      const big = all.length === 1 && n && Number(n[3]) > Number(n[1]);
      throw new Error(
        big
          ? `The AI is busy right now: this request needs ${n![3]} tokens but the AI plan allows ${n![1]} per minute. Try a shorter question.`
          : `The AI is busy right now. Please try again in a minute.${all.length === 1 && n ? ` (${n[2]} of ${n[1]} tokens used this minute)` : ''}`,
      );
    }
    budget.waited += soonest;
    await new Promise((r) => setTimeout(r, soonest));
  }
}

async function callOnce(env: Env, p: Provider, messages: Msg[], extra: Record<string, unknown>): Promise<Msg | undefined> {
  const base = { model: p.model, messages, temperature: 0.2, ...extra };
  const tuned: Record<string, unknown> = p.tune ? p.tune(base) : base;
  delete tuned.max_out;
  const r = await fetch(p.url, {
    method: 'POST',
    headers: { authorization: `Bearer ${p.key}`, 'content-type': 'application/json', ...(p.headers ?? {}) },
    body: JSON.stringify(tuned),
  });
  const raw = await r.json().catch(() => ({}));
  const body = (Array.isArray(raw) ? raw[0] : raw) as { choices?: { message: Msg }[]; error?: { message?: string } };
  const message = body.error?.message || `${p.name} returned ${r.status}`;
  if (r.status === 429 || r.status === 503 || /rate limit|quota|resource.?exhausted|overloaded/i.test(r.ok ? '' : message)) throw new RateLimited(message, p.name);
  // a model without a thinking switch rejects reasoning_effort: remember and retry without it
  if (r.status === 400 && p.name === 'Groq' && /reasoning/i.test(message) && !env.__noReasoningParam) {
    env.__noReasoningParam = true;
    return callOnce(env, { ...providers(env).find((x) => x.name === 'Groq')!, model: p.model }, messages, extra);
  }
  if (!r.ok) throw new Error(`${p.name}: ${message}`);
  const msg = body.choices?.[0]?.message;
  if (!msg) throw new Error(`${p.name} returned no answer.`);
  return msg;
}

export async function onRequestPost({ request, env }: Ctx): Promise<Response> {
  if (!providers(env).length || !env.SUPABASE_URL) return json({ error: 'The AI assistant is not set up on this server yet.' }, 503);

  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Sign in to use the AI assistant.', code: 'auth' }, 401);
  const user = await getUser(env, token);
  if (!user) return json({ error: 'Your session has expired. Sign in again.', code: 'auth' }, 401);

  const pr = await asUser(env, token, `profiles?id=eq.${user.id}&select=pro_until,is_admin`);
  const prof = ((await pr.json().catch(() => [])) as { pro_until: string | null; is_admin: boolean }[])[0];
  const isPro = !!prof && (prof.is_admin || (!!prof.pro_until && new Date(prof.pro_until) > new Date()));
  const mode: 'build' | 'guide' = isPro ? 'build' : 'guide';

  let body: {
    prompt?: string;
    topology?: unknown;
    history?: { role: 'user' | 'assistant'; content: string }[];
    /** Pictures as data URLs, and text read from attached documents. */
    attachments?: { images?: string[]; text?: string; names?: string[] };
    /** Problems found when the previous plan was tried in a test copy. */
    check?: string;
    /** The previous plan's actions (JSON), for a correction round. */
    previous?: string;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'The request was not valid JSON.' }, 400);
  }
  const prompt = String(body.prompt || '').slice(0, 4000);
  if (!prompt.trim()) return json({ error: 'Type a question or a task first.' }, 400);
  const images = (body.attachments?.images ?? []).filter((u) => typeof u === 'string' && /^data:image\/(png|jpe?g|webp);base64,/.test(u) && u.length < 4_000_000).slice(0, 3);
  const docText = String(body.attachments?.text ?? '').slice(0, 12000);
  const names = (body.attachments?.names ?? []).map(String).slice(0, 8);
  if (!isPro && (images.length || docText)) return json({ error: 'Reading lab sheets and pictures is part of NetLab Pro. Your free plan can still ask questions and get guided steps.', code: 'pro' }, 402);
  const fixing = isPro && !!body.check;

  // usage: a correction round is part of the same request, so it isn't counted again
  const limit = isPro ? Number(env.AI_DAILY_LIMIT || 150) : Number(env.AI_FREE_DAILY_LIMIT || 20);
  let used = 0;
  if (!fixing) {
    const ur = await asUser(env, token, 'rpc/bump_my_ai_usage', { method: 'POST', body: '{}' });
    used = Number(await ur.json().catch(() => 0));
    if (!prof?.is_admin && used > limit)
      return json({ error: isPro ? `You've used today's ${limit} AI requests. The limit resets at 8am Malaysia time.` : `You've used today's ${limit} free AI questions. They reset at 8am Malaysia time, or get Pro for more and for automatic setup.`, code: 'limit' }, 429);
  }

  // The model catalogue is only needed when devices may be added; leaving it out keeps
  // requests inside the provider's tokens-per-minute limit.
  const t = { ...((body.topology ?? {}) as Record<string, unknown>) };
  const devCount = Array.isArray(t.devices) ? t.devices.length : 0;
  if (devCount >= 2 && !images.length && !docText && !/\b(add|build|create|new|lab|design|more|extra|another|setup|set up)\b/i.test(prompt)) delete t.availableModels;
  const topo = JSON.stringify(t).slice(0, 40000);
  const history = (body.history || []).slice(-4).map((h) => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content).slice(0, 1500) }));

  let text = `Current topology:\n${topo}\n\n`;
  if (docText) text += `Attached documents${names.length ? ` (${names.join(', ')})` : ''}:\n"""\n${docText}\n"""\n\n`;
  if (images.length) text += `${images.length} attached picture${images.length > 1 ? 's' : ''}${names.length ? ` from ${names.join(', ')}` : ''} follow. Read every label, port name and address in them.\n\n`;
  text += `Request: ${prompt}`;
  if (fixing) {
    text +=
      `\n\nYou already answered this once. Your plan was tried on a test copy of the network and these problems were found:\n${String(body.check).slice(0, 4000)}\n\n` +
      `Your previous actions were:\n${String(body.previous ?? '').slice(0, 12000)}\n\n` +
      `Send the complete corrected plan: every action needed starting from the current topology above (not only the changes), with the problems fixed.`;
  }
  const userContent: string | Part[] = images.length ? [{ type: 'text', text }, ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } }))] : text;

  const messages: Msg[] = [{ role: 'system', content: mode === 'build' ? SYSTEM_BUILD : SYSTEM_GUIDE }, ...history, { role: 'user', content: userContent }];
  const maxOut = mode === 'build' ? 4096 : 2048;

  try {
    let final: Msg | undefined;
    const budget: Budget = { waited: 0 };
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const msg = await chat(env, messages, round < MAX_TOOL_ROUNDS ? { tools: TOOLS, tool_choice: 'auto', max_out: maxOut } : { max_out: maxOut }, budget);
      if (!msg) throw new Error('The model returned no answer.');
      if (msg.tool_calls?.length) {
        messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls });
        for (const tc of msg.tool_calls) messages.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: runTool(tc.function.name, tc.function.arguments) });
        continue;
      }
      final = msg;
      break;
    }
    const finalText = typeof final?.content === 'string' ? final.content : '';
    let out = finalText ? extractJson(finalText) : null;
    if (!out) {
      // Ask once more, in JSON mode, to restate the answer in the required shape.
      messages.push({ role: 'assistant', content: finalText });
      messages.push({ role: 'user', content: 'Restate your final answer as the required JSON object only.' });
      const fix = await chat(env, messages, { response_format: { type: 'json_object' }, max_out: maxOut }, budget);
      out = typeof fix?.content === 'string' ? extractJson(fix.content) : null;
    }
    if (!out) return json({ error: 'The AI answer could not be read. Try asking again in a different way.' }, 424);
    return json({
      mode,
      reply: String(out.reply ?? ''),
      subnets: Array.isArray(out.subnets) ? out.subnets.slice(0, 64) : [],
      actions: mode === 'build' && Array.isArray(out.actions) ? out.actions.slice(0, 300) : [],
      steps: mode === 'guide' && Array.isArray(out.steps) ? out.steps.slice(0, 60) : [],
      usage: fixing ? undefined : { used, limit },
      provider: budget.used,
    });
  } catch (e) {
    const msg = (e as Error).message;
    return json({ error: msg.startsWith('The AI is busy') ? msg : `The AI service had a problem: ${msg}` }, 424);
  }
}

export async function onRequestGet({ env }: Ctx): Promise<Response> {
  const list = providers(env);
  return json({ ok: true, configured: !!(list.length && env.SUPABASE_URL), providers: list.map((p) => `${p.name} (${p.model})`), model: list[0]?.model ?? null });
}
