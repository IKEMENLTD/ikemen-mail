-- Ikemen Mail — database schema
-- Table of sent emails.

create table public.emails (
  id uuid primary key default gen_random_uuid(),
  to_email text not null,
  subject text not null,
  body text not null,
  status text not null default 'sent',
  error text,
  created_at timestamptz not null default now()
);

-- Index for listing recent emails first.
create index emails_created_at_desc_idx on public.emails (created_at desc);

-- Enable Row Level Security.
-- The Netlify functions connect with the Supabase service_role key, which
-- bypasses RLS entirely. Therefore no public policies are defined here.
-- This is safe-by-default: with RLS enabled and no policies, anon/public
-- access is denied. Do not add anon policies unless you intend public access.
alter table public.emails enable row level security;
