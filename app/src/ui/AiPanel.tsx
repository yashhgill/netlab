import { useEffect, useRef, useState } from 'react';
import { accessToken, accountsEnabled, API_BASE, isPro, openAccountDialog, useAccount } from '../account/account';
import { applyActions, describeAction, sanitizeActions, type ActionResult, type AiAction } from '../ai/apply';
import { describeTopology } from '../ai/topology';
import { vlsm, type VlsmNeed, type VlsmResult } from '../engine/vlsm';
import { autoPair, connectPorts } from './actions';
import { UiIcon } from './icons';
import { engine, markDirty, setState, toast, useUi } from './store';

interface Subnet {
  name?: string;
  network?: string;
  prefix?: number;
  mask?: string;
  gateway?: string;
  range?: string;
}

interface Turn {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  subnets?: Subnet[];
  actions?: AiAction[];
  chosen?: boolean[];
  results?: ActionResult[];
  error?: string;
}

const SUGGESTIONS = [
  'Use VLSM on 192.168.10.0/24 for every LAN and link in my network, then configure all the IP addresses and routes.',
  'Why can’t my PCs ping each other? Find the problem and fix it.',
  'Add static routes so every network can reach every other network.',
  'Build a lab: 2 routers joined by a serial link, each with a switch and 2 PCs, fully addressed and routed.',
  'Explain my topology in simple words.',
];

let seq = 0;
let turns: Turn[] = [];

export function AiPanel() {
  const open = useUi((s) => s.aiOpen);
  const [tab, setTab] = useState<'chat' | 'calc'>('chat');
  if (!open) return null;
  return (
    <aside className="aipanel" aria-label="AI assistant">
      <div className="ai-head">
        <div className="ai-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>
            <UiIcon.sparkle /> Assistant
          </button>
          <button role="tab" aria-selected={tab === 'calc'} className={tab === 'calc' ? 'on' : ''} onClick={() => setTab('calc')}>
            <UiIcon.calc /> Subnet calculator
          </button>
        </div>
        <button className="icon-btn" onClick={() => setState({ aiOpen: false })} aria-label="Close AI panel">
          <UiIcon.close />
        </button>
      </div>
      {tab === 'chat' ? <Chat onCalc={() => setTab('calc')} /> : <Calculator />}
    </aside>
  );
}

function Gate() {
  const session = useAccount((s) => s.session);
  const profile = useAccount((s) => s.profile);
  if (!accountsEnabled) {
    return (
      <div className="ai-gate">
        <h3>AI needs the online version</h3>
        <p className="muted">Open NetLab at netlab.harnova.my and sign in to use the assistant. The subnet calculator works everywhere.</p>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="ai-gate">
        <h3>Your network assistant</h3>
        <p className="muted">Describe what you want and NetLab Pro plans the subnets with VLSM, writes the IP addressing, static routes and switch and router configuration, then applies it for you. You check every change before it's applied.</p>
        <button className="btn primary" onClick={() => openAccountDialog('signin')}>
          Sign in to start
        </button>
      </div>
    );
  }
  if (!isPro(profile)) {
    return (
      <div className="ai-gate">
        <h3>Get NetLab Pro</h3>
        <p className="muted">The AI assistant is part of NetLab Pro. It plans VLSM, addresses every device, writes routes and configuration, and finds why pings fail.</p>
        <button className="btn primary" onClick={() => openAccountDialog('upgrade')}>
          See Pro plans
        </button>
      </div>
    );
  }
  return null;
}

function Chat({ onCalc }: { onCalc: () => void }) {
  const session = useAccount((s) => s.session);
  const profile = useAccount((s) => s.profile);
  const [, force] = useState(0);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<{ used: number; limit: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const allowed = accountsEnabled && !!session && isPro(profile);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  });

  const update = (id: number, p: Partial<Turn>) => {
    turns = turns.map((t) => (t.id === id ? { ...t, ...p } : t));
    force((x) => x + 1);
  };

  const send = async (prompt: string) => {
    if (!prompt.trim() || busy) return;
    const history = turns.filter((t) => !t.error).slice(-6).map((t) => ({ role: t.role, content: t.text }));
    turns = [...turns, { id: ++seq, role: 'user', text: prompt.trim() }];
    const reply: Turn = { id: ++seq, role: 'assistant', text: '' };
    turns = [...turns, reply];
    setText('');
    setBusy(true);
    force((x) => x + 1);
    try {
      const token = await accessToken();
      const r = await fetch(`${API_BASE}/api/ai`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token ?? ''}` },
        body: JSON.stringify({ prompt, topology: describeTopology(engine), history }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        update(reply.id, { error: body.error || `The assistant isn't available right now (error ${r.status}).` });
        if (body.code === 'pro') openAccountDialog('upgrade');
        if (body.code === 'auth') openAccountDialog('signin');
      } else {
        const actions = sanitizeActions(body.actions || []);
        update(reply.id, { text: body.reply || 'Done.', subnets: body.subnets || [], actions, chosen: actions.map(() => true) });
        if (body.usage) setUsage(body.usage);
      }
    } catch {
      update(reply.id, { error: 'Could not reach the assistant. Check your internet connection and try again.' });
    } finally {
      setBusy(false);
    }
  };

  const apply = (t: Turn) => {
    const chosen = (t.actions ?? []).filter((_, i) => t.chosen?.[i]);
    const results = applyActions(
      engine,
      chosen,
      (a, b, cable) => (connectPorts(a, b, cable) ? null : 'That cable could not be connected'),
      (a, b) => {
        const p = autoPair(a, b);
        return p ? [p[0].name, p[1].name] : null;
      },
    );
    update(t.id, { results });
    markDirty();
    const bad = results.filter((r) => !r.ok).length;
    toast(bad ? `Applied with ${bad} problem${bad === 1 ? '' : 's'}. See the details in the AI panel.` : `Applied ${results.length} change${results.length === 1 ? '' : 's'}.`, bad ? 'error' : 'info');
  };

  return (
    <div className="ai-chat">
      <div className="ai-list" ref={listRef}>
        <Gate />
        {allowed && !turns.length && (
          <div className="ai-intro">
            <p>
              Tell me what you want to build or fix. I can see your whole topology. I'll plan subnets with exact VLSM, then show every change for you to check before it's applied.
            </p>
            <div className="ai-suggest">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
            <p className="muted small">
              Need just the maths? The{' '}
              <button className="link-btn" onClick={onCalc}>
                subnet calculator
              </button>{' '}
              is free.
            </p>
          </div>
        )}
        {allowed &&
          turns.map((t) => (
            <div key={t.id} className={`ai-turn ${t.role}`}>
              {t.role === 'user' ? (
                <div className="ai-bubble">{t.text}</div>
              ) : t.error ? (
                <div className="ai-error">{t.error}</div>
              ) : !t.text ? (
                <div className="ai-thinking">Working on it…</div>
              ) : (
                <div className="ai-answer">
                  <p className="ai-reply">{t.text}</p>
                  {!!t.subnets?.length && (
                    <div className="ai-table-wrap">
                      <table className="grid-table compact">
                        <thead>
                          <tr>
                            <th>Subnet</th>
                            <th>Network</th>
                            <th>Gateway</th>
                            <th>Usable range</th>
                          </tr>
                        </thead>
                        <tbody>
                          {t.subnets.map((s, i) => (
                            <tr key={i}>
                              <td>{s.name}</td>
                              <td className="mono">
                                {s.network}
                                {s.prefix !== undefined ? `/${s.prefix}` : ''}
                              </td>
                              <td className="mono">{s.gateway}</td>
                              <td className="mono">{s.range}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {!!t.actions?.length && (
                    <div className="ai-actions">
                      <div className="ai-actions-head">
                        <strong>
                          {t.actions.length} change{t.actions.length === 1 ? '' : 's'} to apply
                        </strong>
                        {!t.results && (
                          <button className="link-btn" onClick={() => update(t.id, { chosen: t.chosen?.every(Boolean) ? t.actions!.map(() => false) : t.actions!.map(() => true) })}>
                            {t.chosen?.every(Boolean) ? 'Clear all' : 'Select all'}
                          </button>
                        )}
                      </div>
                      <ul>
                        {t.actions.map((a, i) => (
                          <li key={i}>
                            <label>
                              <input
                                type="checkbox"
                                id={`ai-${t.id}-${i}`}
                                checked={!!t.chosen?.[i]}
                                disabled={!!t.results}
                                onChange={(e) => update(t.id, { chosen: t.chosen!.map((c, j) => (j === i ? e.target.checked : c)) })}
                              />
                              <span>{describeAction(a)}</span>
                            </label>
                            {a.type === 'cli' && (
                              <details>
                                <summary>Commands</summary>
                                <pre>{a.commands.join('\n')}</pre>
                              </details>
                            )}
                          </li>
                        ))}
                      </ul>
                      {!t.results ? (
                        <button className="btn primary" disabled={!t.chosen?.some(Boolean)} onClick={() => apply(t)}>
                          Apply {t.chosen?.filter(Boolean).length} change{t.chosen?.filter(Boolean).length === 1 ? '' : 's'}
                        </button>
                      ) : (
                        <ul className="ai-results">
                          {t.results.map((r, i) => (
                            <li key={i} className={r.ok ? 'ok' : 'bad'}>
                              {r.message}
                              {r.errors?.map((e) => (
                                <div key={e} className="mono small">
                                  {e}
                                </div>
                              ))}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
      </div>
      {allowed && (
        <form
          className="ai-input"
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
        >
          <textarea
            id="ai-prompt"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(text);
              }
            }}
            placeholder="Ask for a VLSM plan, a fix, or a whole lab…"
            rows={2}
            aria-label="Message the assistant"
          />
          <button className="btn primary icon" type="submit" disabled={busy || !text.trim()} aria-label="Send">
            <UiIcon.send />
          </button>
          {usage && (
            <span className="ai-usage muted small">
              {usage.used} of {usage.limit} requests used today
            </span>
          )}
        </form>
      )}
    </div>
  );
}

function Calculator() {
  const [base, setBase] = useState('192.168.10.0/24');
  const [rows, setRows] = useState<VlsmNeed[]>([
    { name: 'LAN A', hosts: 60 },
    { name: 'LAN B', hosts: 28 },
    { name: 'LAN C', hosts: 12 },
    { name: 'R1-R2 link', hosts: 2 },
  ]);
  const [res, setRes] = useState<VlsmResult | null>(null);
  useEffect(() => setRes(vlsm(base, rows.filter((r) => r.hosts > 0))), [base, rows]);
  return (
    <div className="ai-calc">
      <label className="calc-base">
        <span>Network to divide</span>
        <input id="calc-base" value={base} onChange={(e) => setBase(e.target.value)} placeholder="192.168.10.0/24" />
      </label>
      <table className="grid-table compact calc-rows">
        <thead>
          <tr>
            <th>Subnet name</th>
            <th>Hosts needed</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                <input id={`calc-name-${i}`} value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label="Subnet name" />
              </td>
              <td>
                <input
                  id={`calc-hosts-${i}`}
                  inputMode="numeric"
                  value={r.hosts || ''}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, hosts: parseInt(e.target.value.replace(/\D/g, '')) || 0 } : x)))}
                  aria-label="Hosts needed"
                />
              </td>
              <td>
                <button className="link-btn danger" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Remove ${r.name}`}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn" onClick={() => setRows([...rows, { name: `LAN ${String.fromCharCode(65 + rows.length)}`, hosts: 10 }])}>
        Add subnet
      </button>
      {res && !res.ok && <p className="field-err">{res.error}</p>}
      {res && res.ok && (
        <>
          <div className="ai-table-wrap">
            <table className="grid-table compact">
              <thead>
                <tr>
                  <th>Subnet</th>
                  <th>Network</th>
                  <th>Mask</th>
                  <th>Usable range</th>
                  <th>Broadcast</th>
                </tr>
              </thead>
              <tbody>
                {res.subnets.map((s) => (
                  <tr key={s.name + s.network}>
                    <td>
                      {s.name}
                      <div className="muted small">
                        {s.hostsNeeded} needed, {s.usableHosts} usable
                      </div>
                    </td>
                    <td className="mono">
                      {s.network}/{s.prefix}
                    </td>
                    <td className="mono">{s.mask}</td>
                    <td className="mono">
                      {s.firstUsable} – {s.lastUsable}
                    </td>
                    <td className="mono">{s.broadcast}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            Used {res.used} of {res.total} addresses. {res.free.length ? `Free: ${res.free.slice(0, 4).join(', ')}${res.free.length > 4 ? '…' : ''}` : 'No space left.'}
          </p>
        </>
      )}
    </div>
  );
}
