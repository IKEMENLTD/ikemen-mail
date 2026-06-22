// POST /.netlify/functions/send-mail
// Validates input, sends an email via the Resend HTTP API, and records
// the attempt (success or failure) in the Supabase `emails` table.

const { getSupabase } = require('./_supabase');

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
    if (!EMAIL_REGEX.test(to.trim())) {
      return jsonResponse(400, { ok: false, error: 'Field "to" must be a valid email address.' });
    }

    const toEmail = to.trim();
    const supabase = getSupabase();

    // Attempt to send the email via the Resend HTTP API.
    let sendOk = false;
    let sendError = null;

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
        sendError = `Resend API error (${resendResponse.status}): ${errText}`;
      }
    } catch (err) {
      sendError = `Failed to reach Resend API: ${err.message}`;
    }

    // Record the attempt in Supabase regardless of outcome.
    const { data: inserted, error: dbError } = await supabase
      .from('emails')
      .insert({
        to_email: toEmail,
        subject,
        body,
        status: sendOk ? 'sent' : 'failed',
        error: sendOk ? null : sendError,
      })
      .select('id')
      .single();

    if (dbError) {
      // The DB insert failed; log details server-side (never leak to client).
      console.error('Failed to insert email record into Supabase:', dbError);
    }

    // If sending failed, surface a 502 (but the failure was still logged above).
    if (!sendOk) {
      console.error('Email send failed:', sendError);
      return jsonResponse(502, { ok: false, error: sendError || 'Failed to send email.' });
    }

    return jsonResponse(200, { ok: true, id: inserted ? inserted.id : null });
  } catch (err) {
    // Unexpected error: log full details server-side, return a generic message.
    console.error('Unexpected error in send-mail:', err);
    return jsonResponse(500, { ok: false, error: 'Internal Server Error' });
  }
};
