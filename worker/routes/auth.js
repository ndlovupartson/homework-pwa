// POST /api/learner/join — exchanges a class code + learner code for a
// signed session token, per architecture §10. Never reveals which part
// (class code vs learner code) was wrong — a single generic "not found"
// avoids leaking which half of the pair to brute-force.

import { signLearnerToken } from '../lib/auth.js';

export async function handleLearnerJoin(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400 });
  }
  const { classCode, learnerCode } = body;
  if (!classCode || !learnerCode) {
    return new Response(JSON.stringify({ error: 'classCode and learnerCode are required' }), { status: 400 });
  }

  const cls = await env.DB.prepare('SELECT classId FROM classes WHERE classCode = ? AND status = ?')
    .bind(classCode, 'active')
    .first();
  if (!cls) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });

  const learner = await env.DB.prepare('SELECT learnerId, firstName FROM learners WHERE classId = ? AND learnerCode = ?')
    .bind(cls.classId, learnerCode)
    .first();
  if (!learner) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });

  const sessionToken = await signLearnerToken({ learnerId: learner.learnerId, classId: cls.classId }, env);

  return new Response(
    JSON.stringify({ learnerId: learner.learnerId, classId: cls.classId, firstName: learner.firstName, sessionToken }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}
