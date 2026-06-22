// Shared Supabase client helper for Netlify Functions.
// Creates a service-role Supabase client from environment variables.

const { createClient } = require('@supabase/supabase-js');

/**
 * Create and return a Supabase client using the service-role key.
 * Throws a clear error if required environment variables are missing.
 *
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      'Missing Supabase configuration: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.'
    );
  }

  // The service-role key bypasses RLS, so this client is for trusted
  // server-side use only (never expose it to the browser).
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

module.exports = { getSupabase };
