// Auth helpers for the Worker. Implements architecture §10: every route
// derives its data-access scope from a VERIFIED credential, never from a
// client-supplied id in the request body/query.
//
// Teacher auth: the client holds a long random `syncSecret` (generated
// locally at setup, never sent in the clear anywhere else). Requests carry
// it as `Authorization: Bearer <secret>` plus `X-Teacher-Id: <teacherId>`.
// Since the current client (Phase 3-6) never calls a separate /register
// endpoint before its first sync push, this verifies-or-auto-provisions on
// first sight: unknown teacherId -> create the row with a hash of the
// provided secret; known teacherId -> the hash must match.
//
// Learner auth: /api/learner/join exchanges a class code + learner code for
// a compact HMAC-signed session token scoped to {learnerId, classId}. Every
// subsequent learner-authenticated route verifies that signature and reads
// learnerId/classId only from the verified token payload.

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verifies (or auto-provisions) the teacher making this request.
 * @returns {Promise<{teacherId: string} | null>} null if unauthenticated/invalid
 */
export async function verifyTeacherAuth(request, env) {
  const teacherId = request.headers.get('x-teacher-id');
  const authHeader = request.headers.get('authorization');
  const secret = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!teacherId || !secret) return null;

  const secretHash = await sha256Hex(secret);
  const existing = await env.DB.prepare('SELECT teacherId, syncSecretHash FROM teachers WHERE teacherId = ?')
    .bind(teacherId)
    .first();

  if (!existing) {
    // First time this teacherId has synced anything — provision the row.
    // (A dedicated POST /api/teacher/register exists for forward
    // compatibility but the current client doesn't call it separately;
    // documented as a known gap in the README.)
    await env.DB.prepare(
      'INSERT INTO teachers (teacherId, teacherName, syncSecretHash, createdAt) VALUES (?, ?, ?, ?)'
    ).bind(teacherId, 'Unknown (auto-provisioned)', secretHash, new Date().toISOString()).run();
    return { teacherId };
  }

  if (existing.syncSecretHash !== secretHash) return null; // wrong secret for a known teacherId
  return { teacherId };
}

/** Builds the HMAC signing key from the Worker's TOKEN_SECRET env var. */
async function getSigningKey(env) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.TOKEN_SECRET || 'dev-only-insecure-default-secret'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

function base64urlEncode(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(str.length + ((4 - (str.length % 4)) % 4), '=');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** Issues a signed session token for a learner scoped to {learnerId, classId}. */
export async function signLearnerToken(payload, env) {
  const key = await getSigningKey(env);
  const body = JSON.stringify({ ...payload, iat: Date.now() });
  const bodyB64 = base64urlEncode(new TextEncoder().encode(body));
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(bodyB64));
  return `${bodyB64}.${base64urlEncode(sig)}`;
}

/**
 * Verifies a learner session token from the Authorization header.
 * @returns {Promise<{learnerId: string, classId: string} | null>}
 */
export async function verifyLearnerAuth(request, env) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  const [bodyB64, sigB64] = token.split('.');
  if (!bodyB64 || !sigB64) return null;

  const key = await getSigningKey(env);
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    base64urlDecode(sigB64),
    new TextEncoder().encode(bodyB64)
  );
  if (!valid) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(bodyB64)));
    if (!payload.learnerId || !payload.classId) return null;
    return { learnerId: payload.learnerId, classId: payload.classId };
  } catch {
    return null;
  }
}

export { sha256Hex };
