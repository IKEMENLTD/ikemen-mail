// GET /list-messages?folder=inbox|sent|drafts
// Returns the messages in a folder for the single shared mailbox.

const { getAdminClient } = require('./_supabase');
const { requireAuth } = require('./_auth');

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const VALID_FOLDERS = ['inbox', 'sent', 'drafts'];

function json(statusCode, payload) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(payload) };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }

  if (!requireAuth(event)) {
    return json(401, { ok: false, error: 'Unauthorized' });
  }

  const params = event.queryStringParameters || {};
  const folder = params.folder;
  if (!VALID_FOLDERS.includes(folder)) {
    return json(400, { ok: false, error: 'Invalid folder' });
  }

  try {
    const admin = getAdminClient();
    const { data, error } = await admin
      .from('messages')
      .select('*')
      .eq('folder', folder)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      console.error('list-messages: query failed:', error.message);
      return json(500, { ok: false, error: 'Internal error' });
    }

    return json(200, { ok: true, messages: data || [] });
  } catch (err) {
    console.error('list-messages: unexpected error:', err && err.message);
    return json(500, { ok: false, error: 'Internal error' });
  }
};
