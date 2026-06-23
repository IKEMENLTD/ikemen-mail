// POST /send-mail — send an email via Resend and log it to the 'sent' folder.
// Body: {to, subject, body, draftId?}

const { getAdminClient } = require('./_supabase');
const { requireAuth } = require('./_auth');

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const DEFAULT_FROM = 'kouda@ikemen.ltd';
// Pragmatic email validation — not RFC-exhaustive, but rejects obvious junk.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(statusCode, payload) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(payload) };
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }

  if (!requireAuth(event)) {
    return json(401, { ok: false, error: 'Unauthorized' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return json(400, { ok: false, error: 'Invalid JSON body' });
  }

  const { to, subject, body: text, draftId } = body || {};

  if (!isNonEmptyString(to) || !isNonEmptyString(subject) || !isNonEmptyString(text)) {
    return json(400, { ok: false, error: 'to, subject and body are required' });
  }
  if (!EMAIL_RE.test(to.trim())) {
    return json(400, { ok: false, error: 'Invalid recipient email address' });
  }

  const fromEmail = process.env.FROM_EMAIL || DEFAULT_FROM;

  try {
    const admin = getAdminClient();

    // Attempt the send via Resend's HTTP API.
    let sent = false;
    let errorText = null;
    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [to],
          subject,
          text,
        }),
      });

      if (resp.ok) {
        sent = true;
      } else {
        const detail = await resp.text();
        errorText = `Resend error ${resp.status}: ${detail}`;
        console.error('send-mail:', errorText);
      }
    } catch (sendErr) {
      errorText = `Resend request failed: ${sendErr && sendErr.message}`;
      console.error('send-mail:', errorText);
    }

    // Always log a row recording the attempt.
    const { data: inserted, error: insertError } = await admin
      .from('messages')
      .insert({
        folder: 'sent',
        from_email: fromEmail,
        to_email: to,
        subject,
        body: text,
        status: sent ? 'sent' : 'failed',
        error: errorText,
        read: true,
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('send-mail: failed to log message:', insertError.message);
      // If the send itself failed, surface that; otherwise this is a 500.
      if (!sent) {
        return json(502, { ok: false, error: 'Failed to send email' });
      }
      return json(500, { ok: false, error: 'Internal error' });
    }

    if (!sent) {
      return json(502, { ok: false, error: 'Failed to send email' });
    }

    // Clean up the draft this send originated from, if any.
    if (isNonEmptyString(draftId)) {
      const { error: delError } = await admin
        .from('messages')
        .delete()
        .eq('id', draftId)
        .eq('folder', 'drafts');
      if (delError) {
        // Non-fatal: the mail was sent and logged successfully.
        console.error('send-mail: failed to delete draft:', delError.message);
      }
    }

    return json(200, { ok: true, id: inserted.id });
  } catch (err) {
    console.error('send-mail: unexpected error:', err && err.message);
    return json(500, { ok: false, error: 'Internal error' });
  }
};
