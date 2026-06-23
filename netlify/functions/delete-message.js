// POST /delete-message — delete a message by id.
// Body: {id}

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

  const { id } = body || {};
  if (!isNonEmptyString(id)) {
    return json(400, { ok: false, error: 'id is required' });
  }

  try {
    const admin = getAdminClient();
    const { error } = await admin
      .from('messages')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('delete-message: delete failed:', error.message);
      return json(500, { ok: false, error: 'Internal error' });
    }
    return json(200, { ok: true });
  } catch (err) {
    console.error('delete-message: unexpected error:', err && err.message);
    return json(500, { ok: false, error: 'Internal error' });
  }
};
