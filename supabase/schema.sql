-- Standard Mailer — database schema
--
-- Access model (single-password gate, single shared mailbox):
--   * There is NO Supabase Auth and NO per-user rows. The app is gated by a
--     single shared password (LOGIN_PASSWORD env var); functions issue a
--     signed (HMAC) session token.
--   * ALL database access is performed by Netlify Functions using the Supabase
--     SERVICE_ROLE key, which BYPASSES Row Level Security entirely.
--   * The browser NEVER connects to Supabase directly — it only calls Netlify
--     Functions over HTTP. There is no anon key in the browser.
--
-- This script is written to be safe to re-run (idempotent-friendly) and to
-- migrate cleanly from the previous Supabase-Auth-based design.

-- ---------------------------------------------------------------------------
-- Clean up the previous Auth-based design (profiles table + signup trigger).
-- These are no-ops on a fresh database.
-- ---------------------------------------------------------------------------
drop table if exists public.profiles cascade;
drop function if exists public.handle_new_user() cascade;

-- ---------------------------------------------------------------------------
-- Migrate an existing public.messages table from the old per-user design.
-- `create table if not exists` (below) will NOT alter an already-existing
-- table, so we explicitly drop the old user-scoped policies and the user_id
-- column here. These statements are no-ops if the table does not yet exist
-- or was never created with the old shape.
-- ---------------------------------------------------------------------------
drop policy if exists messages_select_own on public.messages;
drop policy if exists messages_insert_own on public.messages;
drop policy if exists messages_update_own on public.messages;
drop policy if exists messages_delete_own on public.messages;

alter table public.messages drop column if exists user_id;

-- ---------------------------------------------------------------------------
-- messages: every email row (inbox / sent / drafts) in the single mailbox.
-- No user_id — there is exactly one shared mailbox.
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id          uuid        primary key default gen_random_uuid(),
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

-- List a folder's contents, newest first.
create index if not exists messages_folder_created_idx
  on public.messages (folder, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security.
--
-- RLS is ENABLED but NO policies are defined. With RLS enabled and zero
-- policies, all direct anon/public access is DENIED — nothing reachable with
-- the anon key (or any non-service role) can read or write this table.
--
-- This is intentional: the only thing that ever touches public.messages is the
-- Netlify Functions backend using the service_role key, which bypasses RLS
-- completely. Because the browser never connects to Supabase directly, no
-- policies are needed and none are defined on purpose.
-- ---------------------------------------------------------------------------
alter table public.messages enable row level security;
