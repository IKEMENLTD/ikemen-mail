// POST /.netlify/functions/send-mail
// Authenticates the caller, validates input, sends an email via the Resend
// HTTP API, and records the attempt (success or failure) in the `messages`
// table as a row in the sender's "sent" folder.

const { getAdminClient, getUserFromToken } = require('./_supabase');

// Standard JSON response headers.
const JSON_HEADERS = { 'Content-Type': 'application/json' };

// Simple email-shape validation (not RFC-perfect, just a sanity check).
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

    // Authenticate the caller via the Authorization header.
    const authHeader = event.headers.authorization || event.headers.Authorization;
    const user = await getUserFromToken(authHeader);
    if (!user) {
      return jsonResponse(401, { ok: false, error: 'Unauthorized' });
    }

    // Parse the JSON body defensively.
    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch (err) {
      return jsonResponse(400, { ok: false, error: 'Invalid JSON body' });
    }

    const { to, subject, body } = payload || {};

    // Validate required fields.
    if (!isNonEmptyString(to) || !isNonEmptyString(subject) || !isNonEmptyString(body)) {
      return jsonResponse(400, {
        ok: false,
        error: 'Fields "to", "subject" and "body" are required and must be non-empty strings.',
      });
    }

    // Validate that `to` looks like an email address.
    const toEmail = to.trim();
    if (!EMAIL_REGEX.test(toEmail)) {
      return jsonResponse(400, { ok: false, error: 'Field "to" must be a valid email address.' });
    }

    // Attempt to send the email via the Resend HTTP API.
    let sendOk = false;
    let detail = null;

    try {
      const resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.FROM_EMAIL,
          to: [toEmail],
          subject,
          text: body,
        }),
      });

      if (resendResponse.ok) {
        sendOk = true;
      } else {
        // Capture Resend's error detail for logging/storage.
        const errText = await resendResponse.text();
        detail = `Resend API error (${resendResponse.status}): ${errText}`;
      }
    } catch (err) {
      detail = `Failed to reach Resend API: ${err && err.message}`;
    }

    // Record the attempt in `messages` regardless of outcome (sent folder).
    const admin = getAdminClient();
    const { data: inserted, error: dbError } = await admin
      .from('messages')
      .insert({
        user_id: user.id,
        folder: 'sent',
        from_email: user.email,
        to_email: toEmail,
        subject,
        body,
        status: sendOk ? 'sent' : 'failed',
        error: sendOk ? null : detail,
        read: true,
      })
      .select('id')
      .single();

    if (dbError) {
      // The DB insert failed; log details server-side (never leak to client).
      console.error('Failed to insert message record into Supabase:', dbError);
    }

    // If sending failed, surface a 502 (the failure was still logged above).
    if (!sendOk) {
      console.error('Email send failed:', detail);
      return jsonResponse(502, { ok: false, error: detail || 'Failed to send email.' });
    }

    return jsonResponse(200, { ok: true, id: inserted ? inserted.id : null });
  } catch (err) {
    // Unexpected error: log full details server-side, return a generic message.
    console.error('Unexpected error in send-mail:', err);
    return jsonResponse(500, { ok: false, error: 'Internal Server Error' });
  }
};
