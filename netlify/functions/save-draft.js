// POST /save-draft — create or update a draft in the 'drafts' folder.
// Body: {id?, to, subject, body} — any of to/subject/body may be empty.

const { getAdminClient } = require('./_supabase');
const { requireAuth } = require('./_auth');

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const DEFAULT_FROM = 'kouda@ikemen.ltd';

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

  const { id, to, subject, body: text } = body || {};
  const toEmail = typeof to === 'string' ? to : '';
  const subj = typeof subject === 'string' ? subject : '';
  const content = typeof text === 'string' ? text : '';
  const fromEmail = process.env.FROM_EMAIL || DEFAULT_FROM;

  try {
    const admin = getAdminClient();

    if (isNonEmptyString(id)) {
      // Update the existing draft row.
      const { data, error } = await admin
        .from('messages')
        .update({ to_email: toEmail, subject: subj, body: content })
        .eq('id', id)
        .eq('folder', 'drafts')
        .select('id')
        .single();

      if (error) {
        console.error('save-draft: update failed:', error.message);
        return json(500, { ok: false, error: 'Internal error' });
      }
      return json(200, { ok: true, id: data.id });
    }

    // Insert a new draft row.
    const { data, error } = await admin
      .from('messages')
      .insert({
        folder: 'drafts',
        from_email: fromEmail,
        to_email: toEmail,
        subject: subj,
        body: content,
        status: 'draft',
        read: true,
      })
      .select('id')
      .single();

    if (error) {
      console.error('save-draft: insert failed:', error.message);
      return json(500, { ok: false, error: 'Internal error' });
    }
    return json(200, { ok: true, id: data.id });
  } catch (err) {
    console.error('save-draft: unexpected error:', err && err.message);
    return json(500, { ok: false, error: 'Internal error' });
  }
};
