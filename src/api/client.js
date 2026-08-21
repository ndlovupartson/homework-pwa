// Talks to the Cloudflare Worker API (architecture §16). The Worker itself
// is still a stub until Phase 7, so every call here will genuinely fail
// right now — that's correct and intentional, not a bug to paper over.
// Screens that call this must handle failure as a real, expected case,
// not an edge case.

const API_BASE = '/api';

class ApiError extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind; // 'offline' | 'not_found' | 'server' | 'network'
  }
}

async function post(path, body) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new ApiError(
      navigator.onLine
        ? "Couldn't reach the server. Try again in a moment."
        : "You're offline — connect to the internet to join a class the first time.",
      navigator.onLine ? 'network' : 'offline'
    );
  }
  if (response.status === 404) throw new ApiError('Class code or learner code not recognized.', 'not_found');
  if (!response.ok) throw new ApiError('Something went wrong on the server. Try again shortly.', 'server');
  return response.json();
}

/** Builds auth headers from an { teacherId, secret } or { sessionToken } credential object. */
function authHeaders(auth) {
  if (!auth) return {};
  if (auth.sessionToken) return { authorization: `Bearer ${auth.sessionToken}` };
  if (auth.teacherId && auth.secret) return { authorization: `Bearer ${auth.secret}`, 'x-teacher-id': auth.teacherId };
  return {};
}

/**
 * Exchange a class code + learner code for a session token + learner record.
 */
export async function joinClass(classCode, learnerCode) {
  return post('/learner/join', { classCode, learnerCode });
}

/**
 * Push one queued entity to the server. Used by the sync engine for every
 * entityType (class/learner/homework/submission) — the payload shape
 * differs per type but the transport contract is the same.
 * @param {object} auth - { teacherId, secret } for teacher pushes, or { sessionToken } for learner pushes. Required — the server derives ownership from this, never from the payload (architecture §10).
 * Returns { version } on success. Throws ApiError on any failure
 * (network/offline/server) so the caller can schedule a retry; throws a
 * distinct 'stale' ApiError on a 409 version conflict.
 */
export async function pushSyncEntity(entityType, payload, auth) {
  let response;
  try {
    response = await fetch(`${API_BASE}/sync/${entityType}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(auth) },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new ApiError('Network unreachable', navigator.onLine ? 'network' : 'offline');
  }
  if (response.status === 401) throw new ApiError('Not signed in', 'auth');
  if (response.status === 409) {
    const body = await response.json().catch(() => ({}));
    const err = new ApiError('Server has a newer version', 'stale');
    err.serverVersion = body.version;
    throw err;
  }
  if (!response.ok) throw new ApiError(`Sync failed (${response.status})`, 'server');
  return response.json();
}

/** Pull homework for the signed-in learner. Throws ApiError on failure. */
export async function pullHomeworkForLearner(auth) {
  let response;
  try {
    response = await fetch(`${API_BASE}/homework/for-learner`, { headers: authHeaders(auth) });
  } catch (err) {
    throw new ApiError('Network unreachable', navigator.onLine ? 'network' : 'offline');
  }
  if (!response.ok) throw new ApiError(`Pull failed (${response.status})`, 'server');
  return response.json(); // expected: [{ homework, questions }, ...]
}

/** Pull new/changed submissions for the signed-in teacher since a timestamp. */
export async function pullSubmissionsSince(sinceIso, auth) {
  let response;
  try {
    response = await fetch(`${API_BASE}/submissions/since?since=${encodeURIComponent(sinceIso || '')}`, {
      headers: authHeaders(auth),
    });
  } catch (err) {
    throw new ApiError('Network unreachable', navigator.onLine ? 'network' : 'offline');
  }
  if (!response.ok) throw new ApiError(`Pull failed (${response.status})`, 'server');
  return response.json(); // expected: [submission, ...]
}

export { ApiError };
