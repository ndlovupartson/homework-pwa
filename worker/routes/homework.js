// GET /api/homework/for-learner — filtered strictly by the verified
// token's classId (architecture §10: never by a client-supplied param).

import { verifyLearnerAuth } from '../lib/auth.js';

export async function handleHomeworkForLearner(request, env) {
  const auth = await verifyLearnerAuth(request, env);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const homeworkRows = await env.DB.prepare('SELECT * FROM homework WHERE classId = ? AND status = ?')
    .bind(auth.classId, 'published')
    .all();

  const items = [];
  for (const homework of homeworkRows.results) {
    const questionRows = await env.DB.prepare('SELECT * FROM questions WHERE homeworkId = ? ORDER BY "order"')
      .bind(homework.homeworkId)
      .all();
    const questions = questionRows.results.map((q) => ({ ...q, options: q.options ? JSON.parse(q.options) : null }));

    // Include the learner's OWN submission (if any), so marks/feedback can
    // sync back to their device through this same delivery call — closes
    // a gap flagged in Phase 5: the original architecture never specified
    // how marks get back to the learner who submitted them.
    const submissionRow = await env.DB.prepare('SELECT * FROM submissions WHERE homeworkId = ? AND learnerId = ?')
      .bind(homework.homeworkId, auth.learnerId)
      .first();
    const submission = submissionRow ? { ...submissionRow, answers: JSON.parse(submissionRow.answers) } : null;

    items.push({ homework, questions, submission });
  }

  return new Response(JSON.stringify(items), { status: 200, headers: { 'content-type': 'application/json' } });
}
