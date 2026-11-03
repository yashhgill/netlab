-- Give Pro to an email address from the Admin panel, even before that person signs up
-- (for example a lecturer who will test the AI). Run once in the Supabase SQL editor.

-- Grants waiting for someone who hasn't signed up yet. Only admins can see them.
create table if not exists public.pro_grants (
  email text primary key,
  pro_until timestamptz not null,
  note text,
  created_at timestamptz not null default now()
);
alter table public.pro_grants enable row level security;
drop policy if exists "admins read grants" on public.pro_grants;
create policy "admins read grants" on public.pro_grants for select using (public.is_admin());

-- New sign-ups: admins from admin_emails, and any waiting Pro grant is applied.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.pro_grants;
begin
  select * into g from public.pro_grants where email = lower(new.email);
  insert into public.profiles (id, email, is_admin, pro_until)
  values (
    new.id,
    lower(new.email),
    exists (select 1 from public.admin_emails a where a.email = lower(new.email)),
    g.pro_until
  )
  on conflict (id) do nothing;
  if g.email is not null then
    delete from public.pro_grants where email = g.email;
  end if;
  return new;
end;
$$;

-- Admin: give Pro to an email until a date (null removes Pro).
-- Returns 'updated' when the account exists, 'waiting' when it will apply at sign-up.
create or replace function public.grant_pro_by_email(target_email text, until timestamptz, note text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  e text := lower(trim(target_email));
  n integer;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change Pro access';
  end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That is not an email address';
  end if;
  update public.profiles set pro_until = until where lower(email) = e;
  get diagnostics n = row_count;
  if n > 0 then
    delete from public.pro_grants where email = e;
    return 'updated';
  end if;
  if until is null then
    delete from public.pro_grants where email = e;
    return 'removed';
  end if;
  insert into public.pro_grants (email, pro_until, note) values (e, until, note)
  on conflict (email) do update set pro_until = excluded.pro_until, note = excluded.note;
  return 'waiting';
end;
$$;

revoke execute on function public.grant_pro_by_email(text, timestamptz, text) from public, anon;
grant execute on function public.grant_pro_by_email(text, timestamptz, text) to authenticated;

-- Make sure the owner account is an admin (it is also in admin_emails for future sign-ups).
insert into public.admin_emails (email) values ('yashchaal99@gmail.com') on conflict do nothing;
update public.profiles set is_admin = true where lower(email) = 'yashchaal99@gmail.com';
