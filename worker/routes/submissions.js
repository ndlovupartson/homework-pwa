// GET /api/submissions/since — filtered strictly by the verified teacher
// token's own classes (architecture §10), never a client-supplied teacherId.

import { verifyTeacherAuth } from '../lib/auth.js';

export async function handleSubmissionsSince(request, env) {
  const auth = await verifyTeacherAuth(request, env);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const url = new URL(request.url);
  const since = url.searchParams.get('since') || '1970-01-01T00:00:00.000Z';

  const rows = await env.DB.prepare(`
    SELECT s.* FROM submissions s
    JOIN homework h ON s.homeworkId = h.homeworkId
    JOIN classes c ON h.classId = c.classId
    WHERE c.teacherId = ? AND s.updatedAt > ?
    ORDER BY s.updatedAt ASC
  `).bind(auth.teacherId, since).all();

  const submissions = rows.results.map((s) => ({ ...s, answers: JSON.parse(s.answers) }));

  return new Response(JSON.stringify(submissions), { status: 200, headers: { 'content-type': 'application/json' } });
}
