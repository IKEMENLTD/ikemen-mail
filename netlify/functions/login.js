// POST /login — single-password gate.
// Body: {password}. On success returns a signed session token.

const crypto = require('crypto');
const { signToken, DEFAULT_TTL_MS } = require('./_auth');

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function json(statusCode, payload) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(payload) };
}

/** Constant-time string comparison that guards against length leaks/throws. */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }

  const loginPassword = process.env.LOGIN_PASSWORD;
  if (!loginPassword) {
    return json(503, { ok: false, error: 'Login not configured' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return json(400, { ok: false, error: 'Invalid JSON body' });
  }

  const password = body && body.password;
  if (typeof password !== 'string' || !safeEqual(password, loginPassword)) {
    return json(401, { ok: false, error: 'パスワードが違います' });
  }

  try {
    const token = signToken();
    const expiresAt = Date.now() + DEFAULT_TTL_MS;
    return json(200, { ok: true, token, expiresAt });
  } catch (err) {
    console.error('login: failed to sign token:', err && err.message);
    return json(500, { ok: false, error: 'Internal error' });
  }
};
