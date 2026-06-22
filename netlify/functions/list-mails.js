// GET /.netlify/functions/list-mails
// Returns the 50 most recent email records from the Supabase `emails` table.

const { getSupabase } = require('./_supabase');

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

exports.handler = async (event) => {
  try {
    // Only GET is allowed.
    if (event.httpMethod !== 'GET') {
      return jsonResponse(405, { ok: false, error: 'Method Not Allowed' });
    }

    const supabase = getSupabase();

    // Fetch the most recent 50 email records, newest first.
    const { data, error } = await supabase
      .from('emails')
      .select('id,to_email,subject,body,status,error,created_at')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Failed to query emails from Supabase:', error);
      return jsonResponse(500, { ok: false, error: 'Failed to load emails.' });
    }

    return jsonResponse(200, { ok: true, mails: data || [] });
  } catch (err) {
    console.error('Unexpected error in list-mails:', err);
    return jsonResponse(500, { ok: false, error: 'Internal Server Error' });
  }
};
