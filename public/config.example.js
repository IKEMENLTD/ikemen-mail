// Example PUBLIC client configuration for Ikemen Mail.
// Copy this file to config.js and fill in your project's values.
//
// NOTE: anonKey is the PUBLIC Supabase anon key. It is safe to expose in
// the browser — all data access is protected by Row Level Security (RLS),
// so each user can only read/write their own rows. NEVER put the
// service_role key here or anywhere in the frontend.
window.SUPABASE_CONFIG = {
  url: "https://YOUR-PROJECT-ref.supabase.co",
  anonKey: "YOUR-PUBLIC-ANON-KEY"
};
