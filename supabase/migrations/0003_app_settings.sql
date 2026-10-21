-- Settings the admin edits from inside NetLab (payment QR, DuitNow ID, prices).
-- Everyone can read them (the upgrade screen shows them); only admins can change them.
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;

drop policy if exists "read settings" on public.app_settings;
create policy "read settings" on public.app_settings for select using (true);

drop policy if exists "admins write settings" on public.app_settings;
create policy "admins write settings" on public.app_settings for all
  using (public.is_admin()) with check (public.is_admin());

insert into public.app_settings (key, value)
values ('payment', '{"name": "HarNova Technology", "duitnow_id": "", "qr": "", "monthly": 9.9, "yearly": 79}'::jsonb)
on conflict (key) do nothing;
