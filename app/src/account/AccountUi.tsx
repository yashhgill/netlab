import { useEffect, useState } from 'react';
import { UiIcon } from '../ui/icons';
import {
  accountsEnabled,
  adminDecide,
  adminPayments,
  adminSetPro,
  adminUsers,
  DUITNOW,
  isPro,
  myPayments,
  openAccountDialog,
  PRICES,
  refreshProfile,
  signInWithEmail,
  signInWithGoogle,
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
          <button role="menuitem" onClick={() => (setOpen(false), signOut())}>
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
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (sent) {
    return (
      <div className="stack">
        <p>
          We sent a sign-in link to <strong>{email}</strong>. Open it on this device to finish signing in.
        </p>
        <p className="muted small">No email after a minute? Check your spam folder, or go back and send it again.</p>
        <button className="btn" onClick={() => setSent(false)}>
          Back
        </button>
      </div>
    );
  }
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await signInWithEmail(email);
        setBusy(false);
        if (r) setErr(r);
        else setSent(true);
      }}
    >
      <p className="muted">Your topologies stay on this device. An account is needed for the AI assistant.</p>
      <button
        type="button"
        className="btn google"
        onClick={async () => {
          const r = await signInWithGoogle();
          if (r) setErr(r);
        }}
      >
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>
        Continue with Google
      </button>
      <div className="or">or</div>
      <label className="stack-field">
        <span>Email</span>
        <input id="signin-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
      </label>
      {err && <p className="field-err">{err}</p>}
      <button className="btn primary" type="submit" disabled={busy || !/.+@.+\..+/.test(email)}>
        {busy ? 'Sending…' : 'Email me a sign-in link'}
      </button>
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
  const [qr, setQr] = useState(true);
  useEffect(() => {
    myPayments().then(setList);
    refreshProfile();
  }, [done]);
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
            const r = await submitPayment(plan, ref);
            if (r) setErr(r);
            else setDone(true);
          }}
        >
          <div className="pay-box">
            <div>
              <strong>1. Pay RM {PRICES[plan].toFixed(2)} by DuitNow</strong>
              <p className="muted small">
                To {DUITNOW.name}
                {DUITNOW.id && (
                  <>
                    , DuitNow ID <span className="mono">{DUITNOW.id}</span>
                  </>
                )}
                . Scan the QR code with any Malaysian banking app or e-wallet.
              </p>
            </div>
            {qr && <img src="./duitnow-qr.png" alt="DuitNow QR code" className="qr" onError={() => setQr(false)} />}
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
  const [tab, setTab] = useState<'payments' | 'users'>('payments');
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [pays, setPays] = useState<PaymentRequest[]>([]);
  const [users, setUsers] = useState<Profile[]>([]);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => {
    if (tab === 'payments') adminPayments(filter).then(setPays);
    else adminUsers(q).then(setUsers);
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
      </div>
      {msg && <p className="field-err">{msg}</p>}
      {tab === 'payments' ? (
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
