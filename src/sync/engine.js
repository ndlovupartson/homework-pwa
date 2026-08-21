// Sync engine — pushes queued changes to the server and pulls updates
// back down. Runs automatically in the background.

import { pushSyncEntity, pullHomeworkForLearner, pullSubmissionsSince, ApiError } from '../api/client.js';
import { put as idbPut } from '../db/idb-helpers.js';

const BASE_DELAY_MS = 5000;
const MAX_DELAY_MS = 5 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

async function scheduleRetry(db, item) {
  const attempts = item.attempts + 1;
  const delay = Math.min(BASE_DELAY_MS * 2 ** attempts, MAX_DELAY_MS);
  await idbPut(db, 'syncQueue', { ...item, attempts, nextAttemptAt: new Date(Date.now() + delay).toISOString() });
}

export async function runSyncCycle(role, schema, db, onQueueChange, onConflictNotice) {
  if (!navigator.onLine) {
    onQueueChange?.((await schema.getSyncQueue(db)).length);
    return;
  }

  const auth = await resolveAuth(role, schema, db);
  if (!auth) {
    onQueueChange?.((await schema.getSyncQueue(db)).length);
    return;
  }

  const queue = await schema.getSyncQueue(db);
  const pending = queue.filter((item) => item.nextAttemptAt <= nowIso());

  for (const item of pending) {
    try {
      await pushSyncEntity(item.entityType, item.payload, auth);
      await schema.removeSyncQueueEntry(db, item.queueId);
    } catch (err) {
      if (err instanceof ApiError && err.kind === 'stale') {
        onConflictNotice?.(item.entityType, item.entityId);
        await schema.removeSyncQueueEntry(db, item.queueId);
        continue;
      }
      await scheduleRetry(db, item);
      break;
    }
  }

  if (role === 'learner') {
    await pullHomeworkUpdates(schema, db, auth, onConflictNotice);
  } else if (role === 'teacher') {
    await pullNewSubmissions(schema, db, auth);
  }

  onQueueChange?.((await schema.getSyncQueue(db)).length);
}

async function resolveAuth(role, schema, db) {
  if (role === 'teacher') {
    const teacher = await schema.getTeacher(db);
    return teacher ? { teacherId: teacher.teacherId, secret: teacher.syncSecret } : null;
  }
  const identity = await schema.getLearnerIdentity(db);
  return identity ? { sessionToken: identity.sessionToken } : null;
}

async function pullHomeworkUpdates(schema, db, auth, onConflictNotice) {
  let items;
  try {
    items = await pullHomeworkForLearner(auth);
  } catch (err) {
    return;
  }
  for (const { homework, questions, submission } of items) {
    const local = await schema.getHomework(db, homework.homeworkId);
    if (!local || homework.version > local.version) {
      const mySubmissions = await schema.listMySubmissions(db);
      const hasInProgress = mySubmissions.some(
        (s) => s.homeworkId === homework.homeworkId && s.status === 'in_progress' && s.answers?.length > 0
      );
      if (local && hasInProgress) {
        onConflictNotice?.('homework', homework.homeworkId, homework.title);
      }
      await schema.upsertHomeworkFromServer(db, homework);
      await schema.upsertQuestionsFromServer(db, questions);
    }
    if (submission) {
      await schema.applyServerSubmissionUpdate(db, submission);
    }
  }
}

// FIX: the cutoff for "what's new" now comes from the newest submission
// actually seen in the results, never from the teacher device's own
// clock. A device with a slightly wrong clock could previously cause
// submissions to be silently skipped forever.
async function pullNewSubmissions(schema, db, auth) {
  const meta = await schema.getSyncMetadata(db);
  let submissions;
  try {
    submissions = await pullSubmissionsSince(meta.lastSubmissionsPullAt, auth);
  } catch (err) {
    return;
  }
  let latestSeen = meta.lastSubmissionsPullAt;
  for (const sub of submissions) {
    await idbPut(db, 'submissions', sub);
    if (!latestSeen || sub.updatedAt > latestSeen) {
      latestSeen = sub.updatedAt;
    }
  }
  if (latestSeen && latestSeen !== meta.lastSubmissionsPullAt) {
    await schema.updateSyncMetadata(db, { lastSubmissionsPullAt: latestSeen });
  }
}

export function startSyncLoop({ role, schema, db, intervalMs = 60000, onQueueChange, onConflictNotice, onCycleError }) {
  let stopped = false;

  async function cycle() {
    if (stopped) return;
    try {
      await runSyncCycle(role, schema, db, onQueueChange, onConflictNotice);
    } catch (err) {
      onCycleError?.(err);
    }
  }

  const onlineHandler = () => cycle();
  window.addEventListener('online', onlineHandler);
  cycle();
  const timer = setInterval(cycle, intervalMs);

  return function stop() {
    stopped = true;
    clearInterval(timer);
    window.removeEventListener('online', onlineHandler);
  };
}
