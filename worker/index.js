// Cloudflare Worker entry point — the sync/delivery API described in the
// architecture doc §16. Real implementation as of Phase 7, replacing the
// Phase 1 placeholder stub.

import { handleLearnerJoin } from './routes/auth.js';
import { handleSync } from './routes/sync.js';
import { handleHomeworkForLearner } from './routes/homework.js';
import { handleSubmissionsSince } from './routes/submissions.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    try {
      if (method === 'POST' && pathname === '/api/learner/join') {
        return await handleLearnerJoin(request, env);
      }

      const syncMatch = pathname.match(/^\/api\/sync\/([a-zA-Z]+)$/);
      if (method === 'POST' && syncMatch) {
        return await handleSync(syncMatch[1], request, env);
      }

      if (method === 'GET' && pathname === '/api/homework/for-learner') {
        return await handleHomeworkForLearner(request, env);
      }

      if (method === 'GET' && pathname === '/api/submissions/since') {
        return await handleSubmissionsSince(request, env);
      }

      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    } catch (err) {
      // Never leak internals; log server-side (visible in `wrangler tail`)
      // and return a generic 500 the client's retry/backoff already handles.
      console.error('[worker] unhandled error', err);
      return new Response(JSON.stringify({ error: 'Internal error' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
  },
};
