-- NetLab accounts, Pro access and AI usage.
-- Run once in the Supabase SQL editor (or with `supabase db push`).

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  pro_until timestamptz,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.payment_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text,
  plan text not null check (plan in ('monthly', 'yearly')),
  amount_rm numeric(10, 2) not null,
  reference text not null check (char_length(reference) between 3 and 80),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default (now() at time zone 'utc')::date,
  count integer not null default 0,
  primary key (user_id, day)
);

-- Create a profile for every new sign-up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helpers
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- Admin approves or rejects a payment. Approving extends Pro by 1 or 12 months.
create or replace function public.decide_payment(request_id bigint, approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.payment_requests;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can approve payments';
  end if;
  select * into r from public.payment_requests where id = request_id for update;
  if r.id is null then
    raise exception 'Payment request not found';
  end if;
  if r.status <> 'pending' then
    raise exception 'This request was already %', r.status;
  end if;
  update public.payment_requests
    set status = case when approve then 'approved' else 'rejected' end, decided_at = now()
    where id = request_id;
  if approve then
    update public.profiles
      set pro_until = greatest(coalesce(pro_until, now()), now())
        + case when r.plan = 'yearly' then interval '12 months' else interval '1 month' end
      where id = r.user_id;
  end if;
end;
$$;

-- Admin can also grant or remove Pro directly.
create or replace function public.set_pro_until(target uuid, until timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change Pro access';
  end if;
  update public.profiles set pro_until = until where id = target;
end;
$$;

-- Called by the server (service role) for each AI request; returns today's count.
create or replace function public.bump_ai_usage(uid uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  insert into public.ai_usage (user_id, day, count)
    values (uid, (now() at time zone 'utc')::date, 1)
    on conflict (user_id, day) do update set count = public.ai_usage.count + 1
    returning count into n;
  return n;
end;
$$;

revoke execute on function public.bump_ai_usage(uuid) from public, anon, authenticated;

-- Row level security
alter table public.profiles enable row level security;
alter table public.payment_requests enable row level security;
alter table public.ai_usage enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select using (id = auth.uid() or public.is_admin());

drop policy if exists "read own payments" on public.payment_requests;
create policy "read own payments" on public.payment_requests for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "create own payment" on public.payment_requests;
create policy "create own payment" on public.payment_requests for insert
  with check (user_id = auth.uid() and status = 'pending');

drop policy if exists "read own usage" on public.ai_usage;
create policy "read own usage" on public.ai_usage for select using (user_id = auth.uid() or public.is_admin());

-- After you sign up on NetLab, make yourself the admin (replace the email):
-- update public.profiles set is_admin = true where email = 'you@example.com';
