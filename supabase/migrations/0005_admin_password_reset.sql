-- Let the NetLab admin set a new password for a user who forgot theirs
-- (NetLab sends no emails, so there is no "forgot password" email). Run once in the Supabase SQL editor.
create extension if not exists pgcrypto with schema extensions;

create or replace function public.admin_set_password(target_email text, new_password text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  n integer;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can reset passwords';
  end if;
  if length(coalesce(new_password, '')) < 8 then
    raise exception 'The new password needs at least 8 characters';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf')),
         email_confirmed_at = coalesce(email_confirmed_at, now()),
         updated_at = now()
   where lower(email) = lower(trim(target_email));
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'No account with that email';
  end if;
  return 'updated';
end;
$$;

revoke execute on function public.admin_set_password(text, text) from public, anon;
grant execute on function public.admin_set_password(text, text) to authenticated;

-- Accounts that were waiting for an email confirmation can sign in now.
update auth.users set email_confirmed_at = now() where email_confirmed_at is null;
