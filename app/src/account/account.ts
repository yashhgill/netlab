import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';
import { isDesktop } from '../platform';

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Where the AI endpoint lives. Same origin on the web; the hosted site from the desktop app. */
export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? (isDesktop ? 'https://netlab.harnova.my' : '');

export const PRICES = {
  monthly: Number(import.meta.env.VITE_PRICE_MONTHLY ?? 9.9),
  yearly: Number(import.meta.env.VITE_PRICE_YEARLY ?? 79),
};

export const DUITNOW = {
  id: (import.meta.env.VITE_DUITNOW_ID as string | undefined) ?? '',
  name: (import.meta.env.VITE_DUITNOW_NAME as string | undefined) ?? 'HarNova Technology',
};

/** Payment details the admin sets from the Admin panel (stored in Supabase). */
export interface PaymentSettings {
  name: string;
  duitnow_id: string;
  /** QR image as a data URL. */
  qr: string;
  monthly: number;
  yearly: number;
}

export const DEFAULT_PAYMENT: PaymentSettings = { name: DUITNOW.name, duitnow_id: DUITNOW.id, qr: '', monthly: PRICES.monthly, yearly: PRICES.yearly };

export async function loadPaymentSettings(): Promise<PaymentSettings> {
  if (!supabase) return DEFAULT_PAYMENT;
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'payment').maybeSingle();
  const v = (data?.value ?? {}) as Partial<PaymentSettings>;
  return {
    name: v.name || DEFAULT_PAYMENT.name,
    duitnow_id: v.duitnow_id ?? DEFAULT_PAYMENT.duitnow_id,
    qr: v.qr ?? '',
    monthly: Number(v.monthly) > 0 ? Number(v.monthly) : DEFAULT_PAYMENT.monthly,
    yearly: Number(v.yearly) > 0 ? Number(v.yearly) : DEFAULT_PAYMENT.yearly,
  };
}

export async function savePaymentSettings(v: PaymentSettings): Promise<string | null> {
  if (!supabase) return 'Not configured';
  const { error } = await supabase.from('app_settings').upsert({ key: 'payment', value: v, updated_at: new Date().toISOString() });
  return error ? error.message : null;
}

export const supabase: SupabaseClient | null = URL && KEY ? createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }) : null;

export const accountsEnabled = !!supabase;

export interface Profile {
  id: string;
  email: string | null;
  pro_until: string | null;
  is_admin: boolean;
}

export interface PaymentRequest {
  id: number;
  user_id: string;
  email: string | null;
  plan: 'monthly' | 'yearly';
  amount_rm: number;
  reference: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  decided_at: string | null;
}

interface AccountState {
  ready: boolean;
  session: Session | null;
  profile: Profile | null;
  dialog: 'signin' | 'upgrade' | 'admin' | null;
}

let state: AccountState = { ready: !supabase, session: null, profile: null, dialog: null };
const subs = new Set<() => void>();

function set(p: Partial<AccountState>) {
  state = { ...state, ...p };
  for (const s of subs) s();
}

export function useAccount<T>(sel: (s: AccountState) => T): T {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => sel(state),
  );
}

export function getAccount() {
  return state;
}

export function openAccountDialog(d: AccountState['dialog']) {
  set({ dialog: d });
}

export function isPro(p: Profile | null = state.profile): boolean {
  return !!p && (p.is_admin || (!!p.pro_until && new Date(p.pro_until) > new Date()));
}

export async function refreshProfile() {
  if (!supabase || !state.session) return set({ profile: null });
  const { data } = await supabase.from('profiles').select('id,email,pro_until,is_admin').eq('id', state.session.user.id).maybeSingle();
  set({ profile: (data as Profile) ?? null });
}

if (supabase) {
  supabase.auth.getSession().then(({ data }) => {
    set({ session: data.session, ready: true });
    refreshProfile();
  });
  supabase.auth.onAuthStateChange((e, session) => {
    set({ session });
    refreshProfile();
    if (e === 'SIGNED_IN' && session && state.dialog === 'signin') set({ dialog: null });
  });
}

/** Friendlier wording for the errors Supabase returns while signing in. */
function authError(msg: string): string {
  if (/rate limit|too many|security purposes|only request this after/i.test(msg)) return 'Too many codes were asked for. Wait a minute, then try again.';
  if (/expired|invalid|token/i.test(msg)) return 'That code is wrong or has expired. Check the latest email, or ask for a new code.';
  if (/signups? not allowed/i.test(msg)) return 'New accounts are switched off right now.';
  if (/error sending|smtp|email/i.test(msg)) return 'The sign-in email could not be sent. Try again in a few minutes.';
  return msg;
}

/**
 * Step 1 of signing in: email a one-time code. New emails get an account automatically.
 * The email holds only the code (no link), so it works the same on any device.
 */
export async function sendSignInCode(email: string): Promise<string | null> {
  if (!supabase) return 'Accounts are not set up on this copy of NetLab.';
  const { error } = await supabase.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: true } });
  return error ? authError(error.message) : null;
}

/** Step 2: check the code from the email. A new account's first code arrives as a sign-up confirmation. */
export async function verifySignInCode(email: string, code: string): Promise<string | null> {
  if (!supabase) return 'Accounts are not set up on this copy of NetLab.';
  const e = email.trim().toLowerCase();
  const token = code.replace(/\D/g, '');
  let { error } = await supabase.auth.verifyOtp({ email: e, token, type: 'email' });
  if (error && /expired|invalid/i.test(error.message)) {
    // codes sent to a brand-new address are sign-up confirmations
    const r = await supabase.auth.verifyOtp({ email: e, token, type: 'signup' });
    if (!r.error) error = null;
  }
  return error ? authError(error.message) : null;
}

export async function signOut() {
  await supabase?.auth.signOut();
  set({ profile: null, session: null });
  // the web version goes back to the NetLab home page; the desktop app stays put
  if (!isDesktop) location.assign('/');
}

export async function myPayments(): Promise<PaymentRequest[]> {
  if (!supabase || !state.session) return [];
  const { data } = await supabase.from('payment_requests').select('*').eq('user_id', state.session.user.id).order('created_at', { ascending: false }).limit(10);
  return (data as PaymentRequest[]) ?? [];
}

export async function submitPayment(plan: 'monthly' | 'yearly', reference: string, amount: number): Promise<string | null> {
  if (!supabase || !state.session) return 'Sign in first.';
  const { error } = await supabase.from('payment_requests').insert({
    user_id: state.session.user.id,
    email: state.session.user.email,
    plan,
    amount_rm: amount,
    reference: reference.trim(),
  });
  return error ? error.message : null;
}

// ---------------- admin ----------------
export async function adminPayments(status: 'pending' | 'all'): Promise<PaymentRequest[]> {
  if (!supabase) return [];
  let q = supabase.from('payment_requests').select('*').order('created_at', { ascending: false }).limit(100);
  if (status === 'pending') q = q.eq('status', 'pending');
  const { data } = await q;
  return (data as PaymentRequest[]) ?? [];
}

export async function adminDecide(id: number, approve: boolean): Promise<string | null> {
  if (!supabase) return 'Not configured';
  const { error } = await supabase.rpc('decide_payment', { request_id: id, approve });
  return error ? error.message : null;
}

export async function adminUsers(search: string): Promise<Profile[]> {
  if (!supabase) return [];
  let q = supabase.from('profiles').select('id,email,pro_until,is_admin').order('created_at', { ascending: false }).limit(50);
  if (search.trim()) q = q.ilike('email', `%${search.trim()}%`);
  const { data } = await q;
  return (data as Profile[]) ?? [];
}

export async function adminSetPro(id: string, until: string | null): Promise<string | null> {
  if (!supabase) return 'Not configured';
  const { error } = await supabase.rpc('set_pro_until', { target: id, until });
  return error ? error.message : null;
}

/** Give Pro to an email until a date (null removes it). Works before the person has signed up. */
export async function adminGrantPro(email: string, until: string | null, note?: string): Promise<{ error: string | null; result?: string }> {
  if (!supabase) return { error: 'Not configured' };
  const { data, error } = await supabase.rpc('grant_pro_by_email', { target_email: email, until, note: note ?? null });
  return error ? { error: /function .*does not exist|schema cache/i.test(error.message) ? 'Run supabase/migrations/0004_pro_grants.sql in Supabase first.' : error.message } : { error: null, result: String(data) };
}

export interface ProGrant {
  email: string;
  pro_until: string;
  note: string | null;
}

/** Pro grants waiting for people who haven't signed up yet. */
export async function adminGrants(): Promise<ProGrant[]> {
  if (!supabase) return [];
  const { data } = await supabase.from('pro_grants').select('email,pro_until,note').order('created_at', { ascending: false }).limit(50);
  return (data as ProGrant[]) ?? [];
}

export async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
