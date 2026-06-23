// POST /update-message — toggle the read flag on a message.
// Body: {id, read}

const { getAdminClient } = require('./_supabase');
const { requireAuth } = require('./_auth');

const JSON_HEADERS = { 'Content-Type': 'application/json' };

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

  const { id, read } = body || {};
  if (!isNonEmptyString(id) || typeof read !== 'boolean') {
    return json(400, { ok: false, error: 'id (string) and read (boolean) are required' });
  }

  try {
    const admin = getAdminClient();
    const { error } = await admin
      .from('messages')
      .update({ read })
      .eq('id', id);

    if (error) {
      console.error('update-message: update failed:', error.message);
      return json(500, { ok: false, error: 'Internal error' });
    }
    return json(200, { ok: true });
  } catch (err) {
    console.error('update-message: unexpected error:', err && err.message);
    return json(500, { ok: false, error: 'Internal error' });
  }
};
