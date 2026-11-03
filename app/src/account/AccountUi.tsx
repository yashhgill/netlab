import { useEffect, useState } from 'react';
import { UiIcon } from '../ui/icons';
import { askConfirm, getState } from '../ui/store';
import {
  accountsEnabled,
  adminDecide,
  adminGrantPro,
  adminGrants,
  type ProGrant,
  adminPayments,
  adminSetPro,
  adminUsers,
  DEFAULT_PAYMENT,
  isPro,
  loadPaymentSettings,
  savePaymentSettings,
  sendSignInCode,
  verifySignInCode,
  type PaymentSettings,
  myPayments,
  openAccountDialog,
  refreshProfile,
  signOut,
  submitPayment,
  useAccount,
  type PaymentRequest,
  type Profile,
} from './account';

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/** Account button for the top bar. */
export function AccountButton() {
  const session = useAccount((s) => s.session);
  const profile = useAccount((s) => s.profile);
  const [open, setOpen] = useState(false);
  if (!accountsEnabled) return null;
  if (!session) {
    return (
      <button className="topbar-btn" onClick={() => openAccountDialog('signin')}>
        <UiIcon.user />
        <span>Sign in</span>
      </button>
    );
  }
  const pro = isPro(profile);
  return (
    <div className="menu">
      <button className="topbar-btn" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} onPointerDown={(e) => e.stopPropagation()}>
        <UiIcon.user />
        <span className={`plan-badge${pro ? ' pro' : ''}`}>{pro ? 'Pro' : 'Free'}</span>
      </button>
      {open && (
        <div className="menu-pop right" role="menu" onPointerDown={(e) => e.stopPropagation()}>
          <div className="menu-label">{session.user.email}</div>
          <div className="menu-label">{profile?.is_admin ? 'Admin' : pro ? `Pro until ${fmtDate(profile?.pro_until ?? null)}` : 'Free plan'}</div>
          <div className="menu-sep" />
          <button role="menuitem" onClick={() => (setOpen(false), openAccountDialog('upgrade'))}>
            {pro ? 'Extend Pro' : 'Upgrade to Pro'}
          </button>
          {profile?.is_admin && (
            <button role="menuitem" onClick={() => (setOpen(false), openAccountDialog('admin'))}>
              Admin: payments and users
            </button>
          )}
          <button
            role="menuitem"
            onClick={async () => {
              setOpen(false);
              if (getState().dirty && !(await askConfirm('This topology has unsaved changes. Save it first with File > Save, or sign out and leave it here on this device.', 'Sign out anyway'))) return;
              await signOut();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function AccountDialogs() {
  const dialog = useAccount((s) => s.dialog);
  if (!dialog) return null;
  const close = () => openAccountDialog(null);
  return (
    <div className="modal-back" onPointerDown={close}>
      <div className={`modal${dialog === 'admin' ? ' wide' : ''}`} role="dialog" aria-label={dialog} onPointerDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{dialog === 'signin' ? 'Sign in to NetLab' : dialog === 'upgrade' ? 'NetLab Pro' : 'Admin'}</h2>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <UiIcon.close />
          </button>
        </div>
        {dialog === 'signin' && <SignIn />}
        {dialog === 'upgrade' && <Upgrade />}
        {dialog === 'admin' && <Admin />}
      </div>
    </div>
  );
}

function SignIn() {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const digits = code.replace(/\D/g, '');

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const send = async () => {
    setBusy(true);
    setErr(null);
    const r = await sendSignInCode(email);
    setBusy(false);
    if (r) return setErr(r);
    setStep('code');
    setCode('');
    setWait(60);
  };

  if (step === 'code') {
    return (
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          const r = await verifySignInCode(email, digits);
          setBusy(false);
          if (r) setErr(r);
        }}
      >
        <p>
          We emailed a sign-in code to <strong>{email.trim()}</strong>. Type it here.
        </p>
        <label className="stack-field">
          <span>Code</span>
          <input
            id="signin-code"
            className="code-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={12}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^\d\s]/g, ''))}
            placeholder="123456"
          />
        </label>
        {err && <p className="field-err">{err}</p>}
        <button className="btn primary" type="submit" disabled={busy || digits.length < 6}>
          {busy ? 'Checking…' : 'Sign in'}
        </button>
        <p className="muted small">The code works once and expires after an hour. No email? Check your spam folder.</p>
        <div className="row-between">
          <button type="button" className="link-btn" onClick={() => (setStep('email'), setErr(null))}>
            Use a different email
          </button>
          <button type="button" className="link-btn" disabled={busy || wait > 0} onClick={send}>
            {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (emailOk) send();
      }}
    >
      <p className="muted small">Type your email and we'll send you a 6-digit code. No password needed. New here? The same code creates your account.</p>
      <label className="stack-field">
        <span>Email</span>
        <input id="signin-email" type="email" autoComplete="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
      </label>
      {err && <p className="field-err">{err}</p>}
      <button className="btn primary" type="submit" disabled={busy || !emailOk}>
        {busy ? 'Sending…' : 'Email me a code'}
      </button>
      <p className="muted small">Your topologies stay on this device. An account is needed for the AI assistant.</p>
    </form>
  );
}

function Upgrade() {
  const session = useAccount((s) => s.session);
  const profile = useAccount((s) => s.profile);
  const [plan, setPlan] = useState<'monthly' | 'yearly'>('monthly');
  const [ref, setRef] = useState('');
  const [list, setList] = useState<PaymentRequest[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pay, setPay] = useState<PaymentSettings>(DEFAULT_PAYMENT);
  useEffect(() => {
    loadPaymentSettings().then(setPay);
  }, []);
  useEffect(() => {
    myPayments().then(setList);
    refreshProfile();
  }, [done]);
  const PRICES = { monthly: pay.monthly, yearly: pay.yearly };
  if (!session) {
    return (
      <div className="stack">
        <p>Sign in first, so your Pro access is linked to your account.</p>
        <button className="btn primary" onClick={() => openAccountDialog('signin')}>
          Sign in
        </button>
      </div>
    );
  }
  const pro = isPro(profile);
  const pending = list.find((p) => p.status === 'pending');
  return (
    <div className="stack">
      {pro && <p className="ok-note">Pro is active until {fmtDate(profile?.pro_until ?? null)}. Paying again adds time on top.</p>}
      <ul className="pro-list">
        <li>AI assistant that plans VLSM, addresses every device and writes the configuration</li>
        <li>Finds and fixes why pings fail</li>
        <li>Builds whole practice labs from one sentence</li>
      </ul>
      <div className="plans" role="radiogroup" aria-label="Plan">
        {(['monthly', 'yearly'] as const).map((p) => (
          <label key={p} className={`plan${plan === p ? ' on' : ''}`}>
            <input type="radio" name="plan" checked={plan === p} onChange={() => setPlan(p)} />
            <span className="plan-name">{p === 'monthly' ? 'Monthly' : 'Yearly'}</span>
            <span className="plan-price">RM {PRICES[p].toFixed(2)}</span>
            <span className="muted small">{p === 'monthly' ? '1 month of Pro' : `12 months of Pro, save RM ${(PRICES.monthly * 12 - PRICES.yearly).toFixed(2)}`}</span>
          </label>
        ))}
      </div>
      {pending && !done ? (
        <p className="ok-note">
          Your payment reference {pending.reference} for RM {Number(pending.amount_rm).toFixed(2)} is waiting for approval. Pro turns on as soon as it's approved, usually within a day.
        </p>
      ) : done ? (
        <p className="ok-note">Thanks. We received your reference. Pro turns on as soon as the payment is approved, usually within a day.</p>
      ) : (
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await submitPayment(plan, ref, PRICES[plan]);
            if (r) setErr(r);
            else setDone(true);
          }}
        >
          <div className="pay-box">
            <div>
              <strong>1. Pay RM {PRICES[plan].toFixed(2)} by DuitNow</strong>
              <p className="muted small">
                To {pay.name}
                {pay.duitnow_id && (
                  <>
                    , DuitNow ID <span className="mono">{pay.duitnow_id}</span>
                  </>
                )}
                .{pay.qr ? ' Scan the QR code with any Malaysian banking app or e-wallet.' : ''}
              </p>
            </div>
            {pay.qr && <img src={pay.qr} alt="DuitNow QR code" className="qr" />}
          </div>
          <label className="stack-field">
            <span>2. Enter the payment reference or transaction ID from your receipt</span>
            <input id="pay-ref" required minLength={3} maxLength={80} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. 20261021MBBEMYKL030OQR12345678" />
          </label>
          {err && <p className="field-err">{err}</p>}
          <button className="btn primary" type="submit" disabled={ref.trim().length < 3}>
            Submit payment for approval
          </button>
        </form>
      )}
      {list.length > 0 && (
        <table className="grid-table compact">
          <thead>
            <tr>
              <th>Date</th>
              <th>Plan</th>
              <th>Reference</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td>{fmtDate(p.created_at)}</td>
                <td>{p.plan}</td>
                <td className="mono">{p.reference}</td>
                <td>
                  <span className={`status ${p.status === 'approved' ? 'successful' : p.status === 'rejected' ? 'failed' : 'in-progress'}`}>{p.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Admin() {
  const [tab, setTab] = useState<'payments' | 'users' | 'settings'>('payments');
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [pays, setPays] = useState<PaymentRequest[]>([]);
  const [users, setUsers] = useState<Profile[]>([]);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => {
    if (tab === 'payments') adminPayments(filter).then(setPays);
    else if (tab === 'users') adminUsers(q).then(setUsers);
  };
  useEffect(load, [tab, filter, q]);
  return (
    <div className="stack">
      <div className="seg" role="tablist">
        <button role="tab" aria-selected={tab === 'payments'} className={tab === 'payments' ? 'on' : ''} onClick={() => setTab('payments')}>
          Payments
        </button>
        <button role="tab" aria-selected={tab === 'users'} className={tab === 'users' ? 'on' : ''} onClick={() => setTab('users')}>
          Users
        </button>
        <button role="tab" aria-selected={tab === 'settings'} className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>
          Payment settings
        </button>
      </div>
      {msg && <p className="field-err">{msg}</p>}
      {tab === 'settings' ? (
        <PaymentSettingsForm />
      ) : tab === 'payments' ? (
        <>
          <div className="seg small">
            <button className={filter === 'pending' ? 'on' : ''} onClick={() => setFilter('pending')}>
              Waiting for approval
            </button>
            <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
              All
            </button>
          </div>
          <div className="ai-table-wrap">
            <table className="grid-table compact">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Email</th>
                  <th>Plan</th>
                  <th>RM</th>
                  <th>Reference</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pays.map((p) => (
                  <tr key={p.id}>
                    <td>{fmtDate(p.created_at)}</td>
                    <td>{p.email}</td>
                    <td>{p.plan}</td>
                    <td>{Number(p.amount_rm).toFixed(2)}</td>
                    <td className="mono">{p.reference}</td>
                    <td className="nowrap">
                      {p.status === 'pending' ? (
                        <>
                          <button
                            className="btn small primary"
                            onClick={async () => {
                              setMsg(await adminDecide(p.id, true));
                              load();
                            }}
                          >
                            Approve
                          </button>{' '}
                          <button
                            className="btn small"
                            onClick={async () => {
                              setMsg(await adminDecide(p.id, false));
                              load();
                            }}
                          >
                            Reject
                          </button>
                        </>
                      ) : (
                        <span className={`status ${p.status === 'approved' ? 'successful' : 'failed'}`}>{p.status}</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!pays.length && (
                  <tr>
                    <td colSpan={6} className="muted">
                      {filter === 'pending' ? 'No payments are waiting.' : 'No payments yet.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="muted small">Check that the money arrived in your bank account before you approve. Approving adds 1 or 12 months of Pro.</p>
        </>
      ) : (
        <>
          <GiveProForm onDone={load} />
          <input id="admin-search" className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by email" />
          <div className="ai-table-wrap">
            <table className="grid-table compact">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Pro until</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      {u.email}
                      {u.is_admin && <span className="plan-badge pro">Admin</span>}
                    </td>
                    <td>{fmtDate(u.pro_until)}</td>
                    <td className="nowrap">
                      <button
                        className="btn small"
                        onClick={async () => {
                          const base = u.pro_until && new Date(u.pro_until) > new Date() ? new Date(u.pro_until) : new Date();
                          base.setMonth(base.getMonth() + 1);
                          setMsg(await adminSetPro(u.id, base.toISOString()));
                          load();
                        }}
                      >
                        Add 1 month
                      </button>{' '}
                      {u.pro_until && (
                        <button
                          className="btn small"
                          onClick={async () => {
                            setMsg(await adminSetPro(u.id, null));
                            load();
                          }}
                        >
                          Remove Pro
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

const GRANT_LENGTHS = [
  { label: '1 week', days: 7 },
  { label: '1 month', days: 30 },
  { label: '3 months', days: 91 },
  { label: '6 months', days: 182 },
  { label: '1 year', days: 365 },
];

/** Give Pro to any email, e.g. a lecturer testing the AI. Applies at sign-up if they have no account yet. */
function GiveProForm({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [days, setDays] = useState(30);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [grants, setGrants] = useState<ProGrant[]>([]);
  const loadGrants = () => void adminGrants().then(setGrants);
  useEffect(loadGrants, []);
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  return (
    <div className="give-pro">
      <form
        className="give-pro-row"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const until = new Date(Date.now() + days * 86400000).toISOString();
          const r = await adminGrantPro(email, until, 'Given by admin');
          setBusy(false);
          if (r.error) return setMsg({ ok: false, text: r.error });
          setMsg({
            ok: true,
            text:
              r.result === 'waiting'
                ? `${email.trim()} has no account yet. Pro starts as soon as they sign in with that email, and lasts until ${fmtDate(until)}.`
                : `${email.trim()} now has Pro until ${fmtDate(until)}.`,
          });
          setEmail('');
          loadGrants();
          onDone();
        }}
      >
        <label className="stack-field grow">
          <span>Give Pro to an email</span>
          <input id="give-pro-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="lecturer@utem.edu.my" />
        </label>
        <label className="stack-field">
          <span>For</span>
          <select id="give-pro-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {GRANT_LENGTHS.map((g) => (
              <option key={g.days} value={g.days}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <button className="btn primary" type="submit" disabled={busy || !ok}>
          {busy ? 'Saving…' : 'Give Pro'}
        </button>
      </form>
      {msg && <p className={msg.ok ? 'muted small' : 'field-err'}>{msg.text}</p>}
      {!!grants.length && (
        <div className="muted small">
          Waiting for sign-up:{' '}
          {grants.map((g, i) => (
            <span key={g.email}>
              {i ? ', ' : ''}
              {g.email} (until {fmtDate(g.pro_until)}){' '}
              <button
                className="link-btn danger"
                onClick={async () => {
                  await adminGrantPro(g.email, null);
                  loadGrants();
                }}
              >
                cancel
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Shrink an uploaded image so it fits comfortably in the database (QR codes stay sharp). */
function readImage(file: File, max = 640): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      const g = c.getContext('2d')!;
      g.imageSmoothingEnabled = k === 1;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('That file is not an image.'));
    img.src = URL.createObjectURL(file);
  });
}

function PaymentSettingsForm() {
  const [v, setV] = useState<PaymentSettings | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  useEffect(() => {
    loadPaymentSettings().then(setV);
  }, []);
  if (!v) return <p className="muted">Loading…</p>;
  const up = (p: Partial<PaymentSettings>) => {
    setV({ ...v, ...p });
    setMsg(null);
  };
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await savePaymentSettings(v);
        setMsg(r ? { text: r, ok: false } : { text: 'Saved. The upgrade screen shows these details now.', ok: true });
      }}
    >
      <div className="pay-settings">
        <div className="stack">
          <label className="stack-field">
            <span>Pay to (name shown to customers)</span>
            <input id="pay-name" value={v.name} onChange={(e) => up({ name: e.target.value })} />
          </label>
          <label className="stack-field">
            <span>DuitNow ID (phone, IC or business number, optional)</span>
            <input id="pay-duitnow" value={v.duitnow_id} onChange={(e) => up({ duitnow_id: e.target.value })} placeholder="e.g. 012-345 6789" />
          </label>
          <div className="pay-prices">
            <label className="stack-field">
              <span>Monthly (RM)</span>
              <input id="pay-monthly" type="number" min="1" step="0.1" value={v.monthly} onChange={(e) => up({ monthly: Number(e.target.value) })} />
            </label>
            <label className="stack-field">
              <span>Yearly (RM)</span>
              <input id="pay-yearly" type="number" min="1" step="0.1" value={v.yearly} onChange={(e) => up({ yearly: Number(e.target.value) })} />
            </label>
          </div>
        </div>
        <div className="stack qr-upload">
          <span className="small">DuitNow QR</span>
          {v.qr ? <img src={v.qr} alt="Your DuitNow QR code" className="qr" /> : <div className="qr qr-empty">No QR yet</div>}
          <label className="btn small">
            {v.qr ? 'Replace QR image' : 'Upload QR image'}
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  up({ qr: await readImage(f) });
                } catch (er) {
                  setMsg({ text: (er as Error).message, ok: false });
                }
              }}
            />
          </label>
          {v.qr && (
            <button type="button" className="link-btn danger" onClick={() => up({ qr: '' })}>
              Remove
            </button>
          )}
        </div>
      </div>
      {msg && <p className={msg.ok ? 'ok-note' : 'field-err'}>{msg.text}</p>}
      <button className="btn primary" type="submit" disabled={!v.name.trim() || !(v.monthly > 0) || !(v.yearly > 0)}>
        Save payment settings
      </button>
      <p className="muted small">Tip: in your bank app, open DuitNow QR → My QR / Receive, save it as an image, then upload it here. Crop it to just the QR for the sharpest result.</p>
    </form>
  );
}
