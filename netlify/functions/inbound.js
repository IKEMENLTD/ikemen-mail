// POST /.netlify/functions/inbound
// Inbound email webhook (optional feature). Accepts a generic email payload,
// maps the recipient address to a user via the `profiles` table, and stores
// the message in that user's "inbox" folder.

const { getAdminClient } = require('./_supabase');

// Standard JSON response headers.
const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * Build a JSON Netlify Function response.
 */
function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  };
}

/**
 * Type-guard: a non-empty trimmed string.
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

exports.handler = async (event) => {
  try {
    // Only POST is allowed.
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { ok: false, error: 'Method Not Allowed' });
    }

    // Inbound handling is disabled unless an INBOUND_SECRET is configured.
    const inboundSecret = process.env.INBOUND_SECRET;
    if (!inboundSecret) {
      return jsonResponse(503, { ok: false, error: 'Inbound disabled' });
    }

    // Authenticate the webhook via the shared secret header.
    const providedSecret =
      event.headers['x-inbound-secret'] || event.headers['X-Inbound-Secret'];
    if (providedSecret !== inboundSecret) {
      return jsonResponse(401, { ok: false, error: 'Unauthorized' });
    }

    // Parse the JSON body defensively.
    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch (err) {
      return jsonResponse(400, { ok: false, error: 'Invalid JSON body' });
    }

    payload = payload || {};
    const from = payload.from;
    const to = payload.to;
    const subject = payload.subject;
    // Accept the message body from any of these generic fields.
    const body = payload.text || payload.body || payload.html || '';

    // Validate the minimally required fields.
    if (!isNonEmptyString(from) || !isNonEmptyString(to)) {
      return jsonResponse(400, {
        ok: false,
        error: 'Fields "from" and "to" are required.',
      });
    }

    const fromEmail = from.trim();
    const toEmail = to.trim();

    const admin = getAdminClient();

    // Map the recipient address to a user (case-insensitive exact match).
    // Escape ILIKE wildcards (% and _) so an address like "john_doe@x.com"
    // is matched literally rather than as a pattern.
    const toEmailPattern = toEmail.replace(/([\\%_])/g, '\\$1');
    const { data: profile, error: lookupError } = await admin
      .from('profiles')
      .select('id')
      .ilike('email', toEmailPattern)
      .maybeSingle();

    if (lookupError) {
      console.error('Failed to look up recipient profile:', lookupError);
      return jsonResponse(500, { ok: false, error: 'Internal Server Error' });
    }

    if (!profile) {
      return jsonResponse(404, { ok: false, error: 'No matching user' });
    }

    // Store the inbound message in the recipient's inbox.
    const { data: inserted, error: dbError } = await admin
      .from('messages')
      .insert({
        user_id: profile.id,
        folder: 'inbox',
        from_email: fromEmail,
        to_email: toEmail,
        subject: subject || '',
        body,
        status: 'received',
        read: false,
      })
      .select('id')
      .single();

    if (dbError) {
      console.error('Failed to insert inbound message into Supabase:', dbError);
      return jsonResponse(500, { ok: false, error: 'Internal Server Error' });
    }

    return jsonResponse(200, { ok: true, id: inserted ? inserted.id : null });
  } catch (err) {
    // Unexpected error: log full details server-side, return a generic message.
    console.error('Unexpected error in inbound:', err);
    return jsonResponse(500, { ok: false, error: 'Internal Server Error' });
  }
};
