// POST /api/sync/:entityType — receives one queued push from a device
// (architecture §9). Every handler here derives ownership from the
// VERIFIED auth credential, never from the request body, and every write
// is idempotent (safe to retry blindly) via INSERT ... ON CONFLICT DO UPDATE
// keyed on the entity's client-generated UUID.

import { verifyTeacherAuth, verifyLearnerAuth } from '../lib/auth.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export async function handleSync(entityType, request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  switch (entityType) {
    case 'class':
      return syncClass(payload, request, env);
    case 'learner':
      return syncLearner(payload, request, env);
    case 'homework':
      return syncHomework(payload, request, env);
    case 'submission':
      return syncSubmission(payload, request, env);
    default:
      return json({ error: `Unknown entity type: ${entityType}` }, 400);
  }
}

async function syncClass(payload, request, env) {
  const auth = await verifyTeacherAuth(request, env);
  if (!auth) return json({ error: 'Unauthorized' }, 401);

  const existing = await env.DB.prepare('SELECT version FROM classes WHERE classId = ?').bind(payload.classId).first();
  if (existing && existing.version > payload.version) return json({ version: existing.version }, 409);

  const newVersion = existing ? existing.version + 1 : 1;
  await env.DB.prepare(`
    INSERT INTO classes (classId, teacherId, className, grade, subject, classCode, status, version, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(classId) DO UPDATE SET
      className = excluded.className, grade = excluded.grade, subject = excluded.subject,
      status = excluded.status, version = excluded.version, updatedAt = excluded.updatedAt
  `).bind(
    payload.classId, auth.teacherId, payload.className, payload.grade || '', payload.subject || '',
    payload.classCode, payload.status || 'active', newVersion, payload.createdAt, payload.updatedAt
  ).run();

  return json({ version: newVersion });
}

async function syncLearner(payload, request, env) {
  const auth = await verifyTeacherAuth(request, env);
  if (!auth) return json({ error: 'Unauthorized' }, 401);

  // Ownership check: the class this learner belongs to must be this
  // teacher's own class — never trust the payload's classId blindly.
  const cls = await env.DB.prepare('SELECT classId FROM classes WHERE classId = ? AND teacherId = ?')
    .bind(payload.classId, auth.teacherId).first();
  if (!cls) return json({ error: 'Referenced class not found (it may not have synced yet — will retry)' }, 400);

  const existing = await env.DB.prepare('SELECT version FROM learners WHERE learnerId = ?').bind(payload.learnerId).first();
  if (existing && existing.version > payload.version) return json({ version: existing.version }, 409);

  const newVersion = existing ? existing.version + 1 : 1;
  await env.DB.prepare(`
    INSERT INTO learners (learnerId, classId, firstName, surname, learnerCode, version, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(learnerId) DO UPDATE SET
      firstName = excluded.firstName, surname = excluded.surname,
      version = excluded.version, updatedAt = excluded.updatedAt
  `).bind(
    payload.learnerId, payload.classId, payload.firstName, payload.surname || '',
    payload.learnerCode, newVersion, payload.createdAt, payload.updatedAt
  ).run();

  return json({ version: newVersion });
}

async function syncHomework(payload, request, env) {
  const auth = await verifyTeacherAuth(request, env);
  if (!auth) return json({ error: 'Unauthorized' }, 401);

  const cls = await env.DB.prepare('SELECT classId FROM classes WHERE classId = ? AND teacherId = ?')
    .bind(payload.classId, auth.teacherId).first();
  if (!cls) return json({ error: 'Referenced class not found (it may not have synced yet — will retry)' }, 400);

  const existing = await env.DB.prepare('SELECT version FROM homework WHERE homeworkId = ?').bind(payload.homeworkId).first();
  if (existing && existing.version > payload.version) return json({ version: existing.version }, 409);

  const newVersion = existing ? existing.version + 1 : 1;
  await env.DB.prepare(`
    INSERT INTO homework (homeworkId, classId, subject, title, instructions, dueDate, dueTime, status, version, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(homeworkId) DO UPDATE SET
      subject = excluded.subject, title = excluded.title, instructions = excluded.instructions,
      dueDate = excluded.dueDate, dueTime = excluded.dueTime, status = excluded.status,
      version = excluded.version, updatedAt = excluded.updatedAt
  `).bind(
    payload.homeworkId, payload.classId, payload.subject || '', payload.title,
    payload.instructions || '', payload.dueDate ?? null, payload.dueTime ?? null, payload.status,
    newVersion, payload.createdAt, payload.updatedAt
  ).run();

  // Full replace of questions — simplest correct approach for an edited
  // question set (avoids reconciling adds/removes/reorders individually).
  await env.DB.prepare('DELETE FROM questions WHERE homeworkId = ?').bind(payload.homeworkId).run();
  for (const q of payload.questions || []) {
    await env.DB.prepare(`
      INSERT INTO questions (questionId, homeworkId, questionText, questionType, options, marks, "order")
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      q.questionId, payload.homeworkId, q.questionText, q.questionType,
      q.options ? JSON.stringify(q.options) : null, q.marks, q.order
    ).run();
  }

  return json({ version: newVersion });
}

// The one entity type pushed by BOTH roles with different authoritative
// fields: learners write {answers, status, submittedAt}, teachers write
// {marks, teacherFeedback}. A naive full-row overwrite from either side
// would silently destroy the other's data — found while building this
// route, not part of the original architecture doc, and worth flagging
// clearly rather than fixing quietly. Handled here with field-scoped
// updates based on which credential type is actually presented.
async function syncSubmission(payload, request, env) {
  const learnerAuth = await verifyLearnerAuth(request, env);
  const teacherAuth = learnerAuth ? null : await verifyTeacherAuth(request, env);
  if (!learnerAuth && !teacherAuth) return json({ error: 'Unauthorized' }, 401);

  const existing = await env.DB.prepare('SELECT * FROM submissions WHERE submissionId = ?')
    .bind(payload.submissionId).first();

  if (learnerAuth) {
    if (payload.learnerId !== learnerAuth.learnerId) return json({ error: 'Forbidden' }, 401);
    const homework = await env.DB.prepare('SELECT classId FROM homework WHERE homeworkId = ?')
      .bind(payload.homeworkId).first();
    if (!homework || homework.classId !== learnerAuth.classId) {
      return json({ error: 'Referenced homework not found for your class' }, 400);
    }
    if (existing && existing.version > payload.version) return json({ version: existing.version }, 409);
    const newVersion = existing ? existing.version + 1 : 1;

    await env.DB.prepare(`
      INSERT INTO submissions (submissionId, homeworkId, learnerId, answers, status, version, submittedAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(submissionId) DO UPDATE SET
        answers = excluded.answers, status = excluded.status,
        version = excluded.version, submittedAt = excluded.submittedAt, updatedAt = excluded.updatedAt
    `).bind(
      payload.submissionId, payload.homeworkId, payload.learnerId,
      JSON.stringify(payload.answers || []), payload.status, newVersion,
      payload.submittedAt, payload.updatedAt
    ).run();

    return json({ version: newVersion });
  }

  // Teacher push (marking): only touches marks/teacherFeedback, never the
  // learner's answers/status — and only for a submission that already
  // exists under a homework this teacher actually owns.
  if (!existing) return json({ error: 'No such submission yet (learner may not have synced their submission)' }, 400);
  const homework = await env.DB.prepare(`
    SELECT h.classId FROM homework h
    JOIN classes c ON h.classId = c.classId
    WHERE h.homeworkId = ? AND c.teacherId = ?
  `).bind(existing.homeworkId, teacherAuth.teacherId).first();
  if (!homework) return json({ error: 'Forbidden' }, 401);

  await env.DB.prepare(`
    UPDATE submissions SET marks = ?, teacherFeedback = ?, updatedAt = ? WHERE submissionId = ?
  `).bind(payload.marks ?? null, payload.teacherFeedback ?? null, payload.updatedAt, payload.submissionId).run();

  return json({ version: existing.version });
}
