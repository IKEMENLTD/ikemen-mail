// Single-password gate: stateless signed-token helpers.
//
// A token is `<base64url(payload)>.<base64url(hmacSHA256(payload, secret))>`
// where payload is JSON like {"exp": <epoch ms>}. The token is verified by
// recomputing the HMAC with the shared secret and checking the expiry.

const crypto = require('crypto');

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * The HMAC signing secret. Prefer SESSION_SECRET, fall back to LOGIN_PASSWORD.
 * @returns {string|undefined}
 */
function getSecret() {
  return process.env.SESSION_SECRET || process.env.LOGIN_PASSWORD;
}

/** base64url-encode a Buffer or string. */
function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Compute the HMAC-SHA256 signature of a payload string, as a Buffer. */
function sign(payloadB64, secret) {
  return crypto.createHmac('sha256', secret).update(payloadB64).digest();
}

/**
 * Create a signed session token.
 * @param {number} [ttlMs] - lifetime in ms (default 7 days).
 * @returns {string} the token.
 */
function signToken(ttlMs = DEFAULT_TTL_MS) {
  const secret = getSecret();
  if (!secret) {
    throw new Error('Cannot sign token: no SESSION_SECRET or LOGIN_PASSWORD configured.');
  }
  const exp = Date.now() + ttlMs;
  const payloadB64 = base64url(JSON.stringify({ exp }));
  const sigB64 = base64url(sign(payloadB64, secret));
  return `${payloadB64}.${sigB64}`;
}

/**
 * Verify a token taken from an Authorization header.
 * Robust to malformed input: returns false, never throws.
 *
 * @param {string|undefined} authHeader - the "Bearer <token>" header value.
 * @returns {boolean}
 */
function verifyToken(authHeader) {
  try {
    if (!authHeader || typeof authHeader !== 'string') {
      return false;
    }

    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return false;
    }
    const token = match[1].trim();

    const parts = token.split('.');
    if (parts.length !== 2) {
      return false;
    }
    const [payloadB64, sigB64] = parts;
    if (!payloadB64 || !sigB64) {
      return false;
    }

    const secret = getSecret();
    if (!secret) {
      return false;
    }

    // Recompute the expected signature and compare in constant time.
    const expectedSig = sign(payloadB64, secret);
    const providedSig = Buffer.from(sigB64, 'base64');
    if (providedSig.length !== expectedSig.length) {
      return false;
    }
    if (!crypto.timingSafeEqual(providedSig, expectedSig)) {
      return false;
    }

    // Signature is valid — now check expiry.
    const payloadJson = Buffer.from(payloadB64, 'base64').toString('utf8');
    const payload = JSON.parse(payloadJson);
    if (!payload || typeof payload.exp !== 'number') {
      return false;
    }
    if (Date.now() >= payload.exp) {
      return false;
    }

    return true;
  } catch (err) {
    // Any parsing/decoding error means the token is not valid.
    return false;
  }
}

/**
 * Convenience guard for handlers: true if the request carries a valid token.
 * @param {object} event - the Netlify Functions event.
 * @returns {boolean}
 */
function requireAuth(event) {
  const headers = (event && event.headers) || {};
  // Header names may be lower-cased by the platform.
  const authHeader = headers.authorization || headers.Authorization;
  return verifyToken(authHeader);
}

module.exports = { getSecret, signToken, verifyToken, requireAuth, DEFAULT_TTL_MS };
