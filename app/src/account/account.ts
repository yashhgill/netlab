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

export const supabase: SupabaseClient | null = URL && KEY ? createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;

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
  supabase.auth.onAuthStateChange((_e, session) => {
    set({ session });
    refreshProfile();
    if (session && state.dialog === 'signin') set({ dialog: null });
  });
}

function redirectTo() {
  return `${location.origin}${location.pathname}`;
}

export async function signInWithEmail(email: string): Promise<string | null> {
  if (!supabase) return 'Accounts are not set up on this copy of NetLab.';
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo() } });
  return error ? error.message : null;
}

export async function signInWithGoogle(): Promise<string | null> {
  if (!supabase) return 'Accounts are not set up on this copy of NetLab.';
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectTo() } });
  return error ? error.message : null;
}

export async function signOut() {
  await supabase?.auth.signOut();
  set({ profile: null, session: null });
}

export async function myPayments(): Promise<PaymentRequest[]> {
  if (!supabase || !state.session) return [];
  const { data } = await supabase.from('payment_requests').select('*').eq('user_id', state.session.user.id).order('created_at', { ascending: false }).limit(10);
  return (data as PaymentRequest[]) ?? [];
}

export async function submitPayment(plan: 'monthly' | 'yearly', reference: string): Promise<string | null> {
  if (!supabase || !state.session) return 'Sign in first.';
  const { error } = await supabase.from('payment_requests').insert({
    user_id: state.session.user.id,
    email: state.session.user.email,
    plan,
    amount_rm: PRICES[plan],
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

export async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
