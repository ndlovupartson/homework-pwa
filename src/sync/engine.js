// Sync engine — real implementation of the pseudocode in
// homework-pwa-architecture.md §9.2. Talks to the Worker API (still a
// stub until Phase 7), so right now every push/pull genuinely fails —
// that's correct: this phase's job is to make sure failure is handled
// safely (retry with backoff, no data loss, no duplicate rows), not to
// fake success.

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

/**
 * Runs one sync pass: push everything in the queue that's due for another
 * attempt, then pull whatever's relevant for the given role. Safe to call
 * repeatedly — every operation here is a no-op or a retry if nothing is
 * due yet, never a duplicate push (queue entries are only removed on
 * success or a definitive server-side rejection).
 *
 * @param {'teacher'|'learner'} role
 * @param {object} schema - the teacher-schema.js or learner-schema.js module, injected so this file has no import-time dependency on either
 * @param {IDBDatabase} db
 * @param {(count:number) => void} [onQueueChange] - wired to the shell's pending-sync banner
 * @param {(entityType:string, entityId:string, label?:string) => void} [onConflictNotice] - called when a homework update arrives while the learner has unsynced local answers (architecture §9.2)
 */
export async function runSyncCycle(role, schema, db, onQueueChange, onConflictNotice) {
  if (!navigator.onLine) {
    onQueueChange?.((await schema.getSyncQueue(db)).length);
    return;
  }

  const auth = await resolveAuth(role, schema, db);
  if (!auth) {
    // Not signed in yet (teacher hasn't finished setup / learner hasn't
    // joined a class) — nothing to sync against, and pushing without
    // credentials would just fail with 401. Skip this cycle quietly.
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
        // Server has a newer version than we thought — surface it rather
        // than silently dropping or silently overwriting, per architecture §9.2.
        onConflictNotice?.(item.entityType, item.entityId);
        await schema.removeSyncQueueEntry(db, item.queueId);
        continue;
      }
      await scheduleRetry(db, item);
      break; // very likely offline/unreachable — stop rather than hammer the rest of the queue
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

/** Learner side: pull homework, warn (don't silently overwrite) if the
 * learner has in-progress local answers for something that changed. */
async function pullHomeworkUpdates(schema, db, auth, onConflictNotice) {
  let items;
  try {
    items = await pullHomeworkForLearner(auth);
  } catch (err) {
    return; // offline/unreachable this cycle — not an error worth surfacing, next cycle will retry
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

/** Teacher side: pull new/changed submissions since the last successful pull. */
async function pullNewSubmissions(schema, db, auth) {
  const meta = await schema.getSyncMetadata(db);
  let submissions;
  try {
    submissions = await pullSubmissionsSince(meta.lastSubmissionsPullAt, auth);
  } catch (err) {
    return;
  }
  for (const sub of submissions) {
    await idbPut(db, 'submissions', sub); // put = insert-or-overwrite by primary key, naturally dedupes
  }
  await schema.updateSyncMetadata(db, { lastSubmissionsPullAt: nowIso() });
}

/**
 * Starts the recurring sync loop: runs once immediately, again on every
 * 'online' transition, and on a periodic timer while online. Returns a
 * stop() function. This is the primary delivery mechanism — the
 * architecture doc explicitly treats the Background Sync API as a bonus,
 * not something to depend on, since browser support/scheduling isn't reliable.
 */
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
