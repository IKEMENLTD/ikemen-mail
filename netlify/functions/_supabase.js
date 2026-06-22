// Shared Supabase helpers for Netlify Functions.
// Provides an admin (service-role) client and a token -> user resolver.

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

/**
 * Resolve the authenticated user from an Authorization header.
 *
 * @param {string|undefined} authHeader - The "Bearer <token>" header value.
 * @returns {Promise<object|null>} The Supabase user object, or null if the
 *   header is missing/malformed or the token cannot be validated.
 */
async function getUserFromToken(authHeader) {
  if (!authHeader || typeof authHeader !== 'string') {
    return null;
  }

  // Expect the form "Bearer <token>" (case-insensitive scheme).
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const token = match[1].trim();
  if (!token) {
    return null;
  }

  try {
    const admin = getAdminClient();
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data || !data.user) {
      return null;
    }
    return data.user;
  } catch (err) {
    // Never leak internal errors to the caller; treat as unauthenticated.
    console.error('getUserFromToken failed:', err && err.message);
    return null;
  }
}

module.exports = { getAdminClient, getUserFromToken };
