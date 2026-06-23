// Shared Supabase helper for Netlify Functions.
// Provides an admin (service-role) client. All DB access goes through the
// service_role key — the browser never talks to Supabase directly.

const { createClient } = require('@supabase/supabase-js');

/**
 * Create a Supabase client using the service-role key.
 * This client bypasses Row Level Security and must only be used server-side
 * (never expose the service-role key to the browser).
 *
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 * @throws {Error} if required environment variables are missing.
 */
function getAdminClient() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      'Missing Supabase configuration: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.'
    );
  }

  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

module.exports = { getAdminClient };
