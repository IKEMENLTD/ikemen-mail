// POST /inbound — inbound email webhook for the single shared mailbox.
// Requires the x-inbound-secret header to match INBOUND_SECRET.
// Body: {from, to, subject, text|body|html}

const { getAdminClient } = require('./_supabase');

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function json(statusCode, payload) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(payload) };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }

  const inboundSecret = process.env.INBOUND_SECRET;
  if (!inboundSecret) {
    return json(503, { ok: false, error: 'Inbound disabled' });
  }

  const headers = event.headers || {};
  const provided = headers['x-inbound-secret'] || headers['X-Inbound-Secret'];
  if (provided !== inboundSecret) {
    return json(401, { ok: false, error: 'Unauthorized' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return json(400, { ok: false, error: 'Invalid JSON body' });
  }

  const { from, to, subject, text, html } = body || {};
  if (!from || !to) {
    return json(400, { ok: false, error: 'from and to are required' });
  }

  // Prefer plain text, then a raw body field, then HTML.
  const content = text || body.body || html || '';

  try {
    const admin = getAdminClient();
    const { data, error } = await admin
      .from('messages')
      .insert({
        folder: 'inbox',
        from_email: from,
        to_email: to,
        subject: subject || '',
        body: content,
        status: 'received',
        read: false,
      })
      .select('id')
      .single();

    if (error) {
      console.error('inbound: insert failed:', error.message);
      return json(500, { ok: false, error: 'Internal error' });
    }
    return json(200, { ok: true, id: data.id });
  } catch (err) {
    console.error('inbound: unexpected error:', err && err.message);
    return json(500, { ok: false, error: 'Internal error' });
  }
};
