-- Standard Mailer — database schema
--
-- Overview of access model:
--   * Netlify Functions (send-mail, inbound) connect with the Supabase
--     SERVICE_ROLE key, which BYPASSES Row Level Security entirely. They are
--     trusted server code and write rows directly (e.g. recording a sent
--     message, or storing an inbound message into a user's inbox).
--   * The browser (public/) connects with the Supabase ANON key plus the
--     logged-in user's JWT session. All of its access is constrained by the
--     RLS policies below, so a user can only ever see / modify their OWN rows.
--
-- The script is written to be safe to re-run (idempotent-friendly).

-- ---------------------------------------------------------------------------
-- messages: every email row (inbox / sent / drafts) belongs to one auth user.
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  folder      text        not null check (folder in ('inbox', 'sent', 'drafts')),
  from_email  text,
  to_email    text,
  subject     text,
  body        text,
  status      text,
  read        boolean     not null default false,
  error       text,
  created_at  timestamptz not null default now()
);

-- List a user's folder contents, newest first.
create index if not exists messages_user_folder_created_idx
  on public.messages (user_id, folder, created_at desc);

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user, auto-created by the trigger below.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id    uuid primary key references auth.users (id) on delete cascade,
  email text
);

-- ---------------------------------------------------------------------------
-- Auto-create a profile row whenever a new auth user signs up.
-- SECURITY DEFINER lets this run with the function owner's privileges so it
-- can insert into public.profiles regardless of RLS. `on conflict do nothing`
-- keeps it safe if a profile already exists.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.messages enable row level security;
alter table public.profiles enable row level security;

-- Policies on public.messages.
-- The browser uses the anon key + user JWT, so every policy is keyed on
-- auth.uid() (the logged-in user). The service_role backend bypasses these.
drop policy if exists messages_select_own on public.messages;
create policy messages_select_own
  on public.messages
  for select
  using (auth.uid() = user_id);

drop policy if exists messages_insert_own on public.messages;
create policy messages_insert_own
  on public.messages
  for insert
  with check (auth.uid() = user_id);

drop policy if exists messages_update_own on public.messages;
create policy messages_update_own
  on public.messages
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists messages_delete_own on public.messages;
create policy messages_delete_own
  on public.messages
  for delete
  using (auth.uid() = user_id);

-- Policies on public.profiles.
-- Read-only for the owner. Inserts are performed by the SECURITY DEFINER
-- trigger above and by the service_role backend, both of which bypass RLS,
-- so no insert policy is required here.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles
  for select
  using (auth.uid() = id);
