import { useEffect, useRef, useState } from 'react';
import { accessToken, accountsEnabled, API_BASE, isPro, openAccountDialog, useAccount } from '../account/account';
import { applyActions, describeAction, sanitizeActions, type ActionResult, type AiAction } from '../ai/apply';
import { ACCEPT, bundle, MAX_IMAGES, readAttachment, type Attachment } from '../ai/attach';
import { describeTopology } from '../ai/topology';
import { testPlan, type CheckReport } from '../ai/verify';
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

interface Step {
  title?: string;
  device?: string;
  where?: string;
  commands?: string[];
  note?: string;
}

interface Turn {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  files?: string[];
  status?: string;
  subnets?: Subnet[];
  actions?: AiAction[];
  chosen?: boolean[];
  results?: ActionResult[];
  steps?: Step[];
  check?: CheckReport;
  error?: string;
}

const PRO_SUGGESTIONS = [
  'Build a lab: 2 routers joined by a serial link, each with a switch and 2 PCs. Use VLSM on 192.168.10.0/24, address everything and add static routes.',
  'Use VLSM on 192.168.10.0/24 for every LAN and link in my network, then configure all the IP addresses and routes.',
  'Why can’t my PCs ping each other? Find the problem and fix it.',
  'Set up VLAN 10 STAFF and VLAN 20 STUDENTS with router-on-a-stick and DHCP for both.',
];

const FREE_SUGGESTIONS = [
  'Show me step by step how to subnet 192.168.10.0/24 for LANs of 60, 28 and 12 hosts.',
  'Guide me to address my network and add static routes so every PC can ping every other PC.',
  'Why can’t my PCs ping each other? Tell me what to check and what to type.',
  'What does "% Invalid input detected" mean, and how do I fix it?',
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
        <p className="muted">Sign in with your email to ask the AI. Free accounts get guided, step-by-step answers with the exact commands to type. NetLab Pro builds the whole lab for you: it picks the devices, plans the subnets, writes every configuration, tests it, and reads your lab sheets and pictures.</p>
        <button className="btn primary" onClick={() => openAccountDialog('signin')}>
          Sign in to start
        </button>
      </div>
    );
  }
  return null;
}

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="link-btn small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          toast('Copy failed. Select the commands and copy them by hand.', 'error');
        }
      }}
    >
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

/** One request to /api/ai. */
async function ask(payload: Record<string, unknown>) {
  const token = await accessToken();
  const r = await fetch(`${API_BASE}/api/ai`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token ?? ''}` },
    body: JSON.stringify(payload),
  });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}

const pairPorts = (a: Parameters<typeof autoPair>[0], b: Parameters<typeof autoPair>[1]): [string, string] | null => {
  const p = autoPair(a, b);
  return p ? [p[0].name, p[1].name] : null;
};

function CheckSummary({ c }: { c: CheckReport }) {
  const okPings = c.pings.filter((p) => p.ok).length;
  if (!c.problems.length) {
    return (
      <div className="ai-check ok">
        <strong>Tested on a copy of your network.</strong> {c.pings.length ? `${okPings} of ${c.pings.length} ping tests worked.` : 'Every command was accepted.'} No problems found.
      </div>
    );
  }
  return (
    <div className="ai-check bad">
      <strong>
        Tested on a copy: {c.problems.length} thing{c.problems.length === 1 ? '' : 's'} still need{c.problems.length === 1 ? 's' : ''} attention
      </strong>
      {c.pings.length > 0 && <span className="muted small"> ({okPings} of {c.pings.length} pings worked)</span>}
      <ul>
        {c.problems.slice(0, 8).map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <p className="muted small">You can still apply it and fix these by hand, or ask me to fix them.</p>
    </div>
  );
}

function Chat({ onCalc }: { onCalc: () => void }) {
  const session = useAccount((s) => s.session);
  const profile = useAccount((s) => s.profile);
  const [, force] = useState(0);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [reading, setReading] = useState(0);
  const [drag, setDrag] = useState(false);
  const [usage, setUsage] = useState<{ used: number; limit: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const allowed = accountsEnabled && !!session;
  const pro = isPro(profile);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  });

  const update = (id: number, p: Partial<Turn>) => {
    turns = turns.map((t) => (t.id === id ? { ...t, ...p } : t));
    force((x) => x + 1);
  };

  const addFiles = async (list: FileList | File[]) => {
    const arr = [...list];
    if (!arr.length) return;
    if (!pro) {
      toast('Reading lab sheets and pictures is part of NetLab Pro.');
      openAccountDialog('upgrade');
      return;
    }
    setReading((n) => n + arr.length);
    for (const f of arr) {
      try {
        const a = await readAttachment(f);
        setFiles((cur) => [...cur, a]);
      } catch (e) {
        toast((e as Error).message, 'error');
      } finally {
        setReading((n) => n - 1);
      }
    }
  };

  const send = async (prompt: string) => {
    if (!prompt.trim() || busy || reading) return;
    const history = turns.filter((t) => !t.error && t.text).slice(-6).map((t) => ({ role: t.role, content: t.text }));
    const att = files.length ? bundle(files) : null;
    turns = [...turns, { id: ++seq, role: 'user', text: prompt.trim(), files: files.map((f) => f.name) }];
    const reply: Turn = { id: ++seq, role: 'assistant', text: '', status: att ? 'Reading your files and planning…' : 'Working on it…' };
    turns = [...turns, reply];
    setText('');
    setFiles([]);
    setBusy(true);
    force((x) => x + 1);
    const fail = (status: number, body: { error?: string; code?: string }) => {
      update(reply.id, { status: undefined, error: body.error || `The assistant isn't available right now (error ${status}).` });
      if (body.code === 'pro') openAccountDialog('upgrade');
      if (body.code === 'auth') openAccountDialog('signin');
    };
    try {
      const topology = describeTopology(engine);
      const payload = { prompt, topology, history, attachments: att ?? undefined };
      // the free AI plans allow a few requests a minute; say so while the server waits for a slot
      const slow = setTimeout(() => update(reply.id, { status: 'The free AI is busy. Waiting for a free slot (up to a minute)…' }), 12000);
      const r = await ask(payload).finally(() => clearTimeout(slow));
      if (!r.ok) return fail(r.status, r.body);
      if (r.body.usage) setUsage(r.body.usage);
      if (r.body.mode === 'guide') {
        update(reply.id, { status: undefined, text: r.body.reply || 'Here’s how.', subnets: r.body.subnets || [], steps: (r.body.steps || []) as Step[] });
        return;
      }
      let actions = sanitizeActions(r.body.actions || []);
      let answer = { text: r.body.reply || 'Done.', subnets: (r.body.subnets || []) as Subnet[] };
      let check: CheckReport | undefined;
      if (actions.length) {
        update(reply.id, { status: 'Testing the plan on a copy of your network…' });
        await new Promise((res) => setTimeout(res, 0));
        check = testPlan(engine, actions, prompt, pairPorts);
        if (check.problems.length) {
          // one automatic correction round with the exact problems the test found
          update(reply.id, { status: `Found ${check.problems.length} problem${check.problems.length === 1 ? '' : 's'} in the test. Fixing…` });
          const fix = await ask({ ...payload, check: check.problems.join('\n'), previous: JSON.stringify(actions) });
          if (fix.ok) {
            const again = sanitizeActions(fix.body.actions || []);
            if (again.length) {
              const recheck = testPlan(engine, again, prompt, pairPorts);
              if (recheck.problems.length < check.problems.length) {
                actions = again;
                check = recheck;
                answer = { text: fix.body.reply || answer.text, subnets: (fix.body.subnets?.length ? fix.body.subnets : answer.subnets) as Subnet[] };
              }
            }
          }
        }
      }
      update(reply.id, { status: undefined, text: answer.text, subnets: answer.subnets, actions, chosen: actions.map(() => true), check });
    } catch {
      update(reply.id, { status: undefined, error: 'Could not reach the assistant. Check your internet connection and try again.' });
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
      pairPorts,
    );
    update(t.id, { results });
    markDirty();
    const bad = results.filter((r) => !r.ok).length;
    toast(bad ? `Applied with ${bad} problem${bad === 1 ? '' : 's'}. See the details in the AI panel.` : `Applied ${results.length} change${results.length === 1 ? '' : 's'}.`, bad ? 'error' : 'info');
  };

  const suggestions = pro ? PRO_SUGGESTIONS : FREE_SUGGESTIONS;
  const imageCount = files.reduce((n, f) => n + f.images.length, 0);

  return (
    <div
      className={`ai-chat${drag ? ' dragging' : ''}`}
      onDragOver={(e) => {
        if (!allowed || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        if (!allowed || !e.dataTransfer.files.length) return;
        e.preventDefault();
        e.stopPropagation();
        setDrag(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      <div className="ai-list" ref={listRef}>
        <Gate />
        {allowed && !turns.length && (
          <div className="ai-intro">
            {pro ? (
              <p>
                Tell me what to build or fix, or attach your lab sheet or a picture of the topology. I'll pick the devices, plan the subnets with exact VLSM, write every configuration and test it on a copy of your network. You check every change before it's applied.
              </p>
            ) : (
              <>
                <p>Ask me anything about your network. I'll explain the plan and give you the exact steps and commands to type, so you learn by doing it.</p>
                <p className="muted small">
                  Want me to build and configure it for you, or read your lab sheet?{' '}
                  <button className="link-btn" onClick={() => openAccountDialog('upgrade')}>
                    Get NetLab Pro
                  </button>
                </p>
              </>
            )}
            <div className="ai-suggest">
              {suggestions.map((s) => (
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
                <div className="ai-bubble">
                  {t.text}
                  {!!t.files?.length && <div className="ai-bubble-files">📎 {t.files.join(', ')}</div>}
                </div>
              ) : t.error ? (
                <div className="ai-error">{t.error}</div>
              ) : t.status ? (
                <div className="ai-thinking">{t.status}</div>
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
                  {!!t.steps?.length && (
                    <ol className="ai-steps">
                      {t.steps.map((st, i) => {
                        const cmds = (st.commands ?? []).filter((c) => typeof c === 'string');
                        return (
                          <li key={i}>
                            <div className="ai-step-head">
                              <strong>{st.title || `Step ${i + 1}`}</strong>
                              {st.device && <span className="ai-step-dev">{st.device}</span>}
                            </div>
                            {st.note && <p className="small">{st.note}</p>}
                            {!!cmds.length && (
                              <div className="ai-cmds">
                                <pre>{cmds.join('\n')}</pre>
                                <Copy text={cmds.join('\n')} />
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  )}
                  {t.check && !t.results && <CheckSummary c={t.check} />}
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
                        <div className="ai-apply-row">
                          <button className="btn primary" disabled={!t.chosen?.some(Boolean)} onClick={() => apply(t)}>
                            Apply {t.chosen?.filter(Boolean).length} change{t.chosen?.filter(Boolean).length === 1 ? '' : 's'}
                          </button>
                          {!!t.check?.problems.length && (
                            <button className="btn" disabled={busy} onClick={() => send(`Fix these problems in your plan:\n${t.check!.problems.join('\n')}`)}>
                              Ask AI to fix
                            </button>
                          )}
                        </div>
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
          {(files.length > 0 || reading > 0) && (
            <div className="ai-files">
              {files.map((f) => (
                <span key={f.id} className="ai-file">
                  {f.name} <span className="muted">({f.info})</span>
                  <button type="button" className="icon-btn" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((x) => x.id !== f.id))}>
                    <UiIcon.close />
                  </button>
                </span>
              ))}
              {reading > 0 && <span className="ai-file muted">Reading…</span>}
              {imageCount > MAX_IMAGES && <span className="muted small">The AI looks at the first {MAX_IMAGES} pictures; all the text is read.</span>}
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={ACCEPT}
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="btn icon"
            title={pro ? 'Attach a lab sheet, document or picture' : 'Reading lab sheets and pictures is part of NetLab Pro'}
            aria-label="Attach files"
            onClick={() => (pro ? fileRef.current?.click() : (toast('Reading lab sheets and pictures is part of NetLab Pro.'), openAccountDialog('upgrade')))}
          >
            📎
          </button>
          <textarea
            id="ai-prompt"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const imgs = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
              if (imgs.length) {
                e.preventDefault();
                addFiles(imgs);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(text);
              }
            }}
            placeholder={pro ? 'Ask for a lab, a VLSM plan or a fix, or attach your lab sheet…' : 'Ask how to subnet, configure or fix something…'}
            rows={2}
            aria-label="Message the assistant"
          />
          <button className="btn primary icon" type="submit" disabled={busy || reading > 0 || !text.trim()} aria-label="Send">
            <UiIcon.send />
          </button>
          <span className="ai-usage muted small">
            {pro ? 'Pro: builds and tests it for you' : 'Free: guided answers'}
            {usage ? ` · ${usage.used} of ${usage.limit} today` : ''}
          </span>
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
