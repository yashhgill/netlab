import { useEffect, useState } from 'react';
import { UiIcon } from '../ui/icons';
import { askConfirm, getState } from '../ui/store';
import {
  accountsEnabled,
  adminDecide,
  adminPayments,
  adminSetPro,
  adminUsers,
  DEFAULT_PAYMENT,
  GOOGLE_ENABLED,
  isPro,
  loadPaymentSettings,
  savePaymentSettings,
  sendPasswordReset,
  setNewPassword,
  signInWithPassword,
  signUpWithPassword,
  type PaymentSettings,
  myPayments,
  openAccountDialog,
  refreshProfile,
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
          <h2>{dialog === 'signin' ? 'Sign in to NetLab' : dialog === 'upgrade' ? 'NetLab Pro' : dialog === 'newpassword' ? 'Choose a new password' : 'Admin'}</h2>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <UiIcon.close />
          </button>
        </div>
        {dialog === 'signin' && <SignIn />}
        {dialog === 'upgrade' && <Upgrade />}
        {dialog === 'admin' && <Admin />}
        {dialog === 'newpassword' && <NewPassword />}
      </div>
    </div>
  );
}

const GoogleLogo = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
);

function SignIn() {
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailOk = /.+@.+\..+/.test(email);
  const go = (m: typeof mode) => {
    setMode(m);
    setErr(null);
    setNote(null);
  };
  if (note) {
    return (
      <div className="stack">
        <p>{note}</p>
        <p className="muted small">No email after a minute? Check your spam folder.</p>
        <button className="btn" onClick={() => go('signin')}>
          Back to sign in
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
        setErr(null);
        if (mode === 'signin') setErr(await signInWithPassword(email, pw));
        else if (mode === 'signup') {
          const r = await signUpWithPassword(email, pw);
          if (r.error) setErr(r.error);
          else if (r.confirm) setNote(`We sent a confirmation link to ${email}. Open it to finish creating your account.`);
        } else {
          const r = await sendPasswordReset(email);
          if (r) setErr(r);
          else setNote(`If ${email} has an account, a link to choose a new password is on its way.`);
        }
        setBusy(false);
      }}
    >
      <div className="seg" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'on' : ''} onClick={() => go('signin')}>
          Sign in
        </button>
        <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'on' : ''} onClick={() => go('signup')}>
          Create account
        </button>
      </div>
      <p className="muted small">Your topologies stay on this device. An account is needed for the AI assistant.</p>
      {GOOGLE_ENABLED && mode !== 'forgot' && (
        <>
          <button
            type="button"
            className="btn google"
            onClick={async () => {
              const r = await signInWithGoogle();
              if (r) setErr(r);
            }}
          >
            <GoogleLogo />
            Continue with Google
          </button>
          <div className="or">or</div>
        </>
      )}
      <label className="stack-field">
        <span>Email</span>
        <input id="signin-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
      </label>
      {mode !== 'forgot' && (
        <label className="stack-field">
          <span>Password</span>
          <input
            id="signin-password"
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            required
            minLength={mode === 'signup' ? 8 : 1}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder={mode === 'signup' ? 'At least 8 characters' : ''}
          />
        </label>
      )}
      {err && <p className="field-err">{err}</p>}
      <button className="btn primary" type="submit" disabled={busy || !emailOk || (mode === 'signup' && pw.length < 8) || (mode === 'signin' && !pw)}>
        {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Email me a reset link'}
      </button>
      {mode === 'signin' && (
        <button type="button" className="link-btn" onClick={() => go('forgot')}>
          Forgot your password?
        </button>
      )}
      {mode === 'forgot' && (
        <button type="button" className="link-btn" onClick={() => go('signin')}>
          Back to sign in
        </button>
      )}
    </form>
  );
}

function NewPassword() {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await setNewPassword(pw);
        if (r) setErr(r);
        else openAccountDialog(null);
      }}
    >
      <label className="stack-field">
        <span>New password</span>
        <input id="new-password" type="password" autoComplete="new-password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 8 characters" />
      </label>
      {err && <p className="field-err">{err}</p>}
      <button className="btn primary" type="submit" disabled={pw.length < 8}>
        Save password
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
