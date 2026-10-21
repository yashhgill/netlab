-- Owner accounts that are admins from their first sign-in.
-- Only the database owner can read or change this list (RLS on, no policies).
create table if not exists public.admin_emails (
  email text primary key
);
alter table public.admin_emails enable row level security;

insert into public.admin_emails (email) values ('yashchaal99@gmail.com')
on conflict do nothing;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, is_admin)
  values (new.id, new.email, exists (select 1 from public.admin_emails a where a.email = lower(new.email)))
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Accounts that already exist.
update public.profiles p set is_admin = true
where lower(p.email) in (select email from public.admin_emails);
