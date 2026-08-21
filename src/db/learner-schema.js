// Learner IndexedDB — deliberately smaller than the teacher schema.
// Filtered to exactly one learner/class. Shapes match §8.2 of
// homework-pwa-architecture.md. There is intentionally no API in this
// file that can write or read another learner's submission — every write
// function below takes learnerId only from learnerIdentity, never as a
// caller-supplied parameter, so a coding mistake elsewhere in the app
// can't accidentally cross learner boundaries on this device.

import {
  openDb, put, get, getAll, getAllByIndex, generateId, nowIso, remove,
} from './idb-helpers.js';

export const LEARNER_DB_NAME = 'learner_db';
export const LEARNER_DB_VERSION = 1;

function upgrade(db, oldVersion) {
  if (oldVersion < 1) {
    db.createObjectStore('learnerIdentity', { keyPath: 'learnerId' });

    const homework = db.createObjectStore('homework', { keyPath: 'homeworkId' });
    homework.createIndex('status', 'status');
    homework.createIndex('dueDate', 'dueDate');

    const questions = db.createObjectStore('questions', { keyPath: 'questionId' });
    questions.createIndex('homeworkId', 'homeworkId');

    const submissions = db.createObjectStore('mySubmissions', { keyPath: 'submissionId' });
    submissions.createIndex('homeworkId', 'homeworkId', { unique: true });
    submissions.createIndex('syncStatus', 'syncStatus');

    const syncQueue = db.createObjectStore('syncQueue', { keyPath: 'queueId', autoIncrement: true });
    syncQueue.createIndex('nextAttemptAt', 'nextAttemptAt');

    db.createObjectStore('syncMetadata', { keyPath: 'id' });
  }
}

export function openLearnerDb() {
  return openDb(LEARNER_DB_NAME, LEARNER_DB_VERSION, upgrade);
}

// ---- Identity (join class, once) ----

export async function getLearnerIdentity(db) {
  const all = await getAll(db, 'learnerIdentity');
  return all[0] ?? null;
}

/**
 * Called after /api/learner/join succeeds (Phase 7). This module never
 * verifies the class/learner code itself — that's the Worker's job
 * (architecture §10). This function only persists what the server confirmed.
 */
export async function saveLearnerIdentity(db, { learnerId, classId, firstName, learnerCode, sessionToken }) {
  const record = {
    learnerId, classId, firstName, learnerCode, sessionToken,
    deviceId: generateId(),
    joinedAt: nowIso(),
  };
  await put(db, 'learnerIdentity', record);
  return record;
}

// ---- Homework (read-mostly mirror; written by sync engine, Phase 7) ----

export async function upsertHomeworkFromServer(db, homeworkRecord) {
  // downloadedAt distinguishes "server updated it" from "we first saw it"
  const existing = await get(db, 'homework', homeworkRecord.homeworkId);
  await put(db, 'homework', {
    ...homeworkRecord,
    downloadedAt: existing?.downloadedAt ?? nowIso(),
  });
}

export async function upsertQuestionsFromServer(db, questions) {
  for (const q of questions) await put(db, 'questions', q);
}

export async function listHomework(db) {
  return getAll(db, 'homework');
}

export async function getHomework(db, homeworkId) {
  return get(db, 'homework', homeworkId);
}

export async function getQuestionsForHomework(db, homeworkId) {
  return getAllByIndex(db, 'questions', 'homeworkId', homeworkId);
}

// ---- My submissions only ----

/** Get or create this learner's (and only this learner's) submission for a homework item. */
export async function getOrCreateSubmission(db, homeworkId) {
  const identity = await getLearnerIdentity(db);
  if (!identity) throw new Error('No learner identity — must join a class first');

  const existing = (await getAllByIndex(db, 'mySubmissions', 'homeworkId', homeworkId))[0];
  if (existing) return existing;

  const record = {
    submissionId: generateId(), // generated once, reused on every update — makes double-submit safe (architecture §9)
    homeworkId,
    learnerId: identity.learnerId, // always from identity, never a parameter
    answers: [],
    status: 'in_progress',
    version: 1,
    submittedAt: null,
    updatedAt: nowIso(),
    marks: null,
    teacherFeedback: null,
    syncStatus: 'local',
  };
  await put(db, 'mySubmissions', record);
  return record;
}

export async function saveProgress(db, homeworkId, answers) {
  const submission = await getOrCreateSubmission(db, homeworkId);
  const updated = {
    ...submission,
    answers,
    updatedAt: nowIso(),
    syncStatus: 'local',
  };
  await put(db, 'mySubmissions', updated);
  // Progress saves are local-only by default (no need to sync every
  // keystroke) — queued for sync only on submit, per architecture §9.
  return updated;
}

export async function submitHomework(db, homeworkId, finalAnswers) {
  const submission = await getOrCreateSubmission(db, homeworkId);
  const updated = {
    ...submission,
    answers: finalAnswers,
    status: 'submitted',
    submittedAt: nowIso(),
    updatedAt: nowIso(),
    version: submission.version + 1,
    syncStatus: 'local',
  };
  await put(db, 'mySubmissions', updated);
  await enqueueSync(db, 'submission', updated.submissionId, 'update', updated);
  return updated;
}

export async function listMySubmissions(db) {
  return getAll(db, 'mySubmissions');
}

/**
 * Applies marks/feedback that arrived from the server (via the homework
 * delivery pull — see worker/routes/homework.js) directly to the local
 * record, WITHOUT enqueueing a sync push — this is data flowing IN from
 * the server, re-queuing it would create a pointless round-trip. Never
 * touches locally-authoritative fields (answers/status) if the local
 * record is newer; the server is only ever authoritative for marks/feedback
 * here, matching the field-scoped merge the Worker itself enforces.
 */
export async function applyServerSubmissionUpdate(db, serverSubmission) {
  const local = await get(db, 'mySubmissions', serverSubmission.submissionId);
  if (!local) {
    // Learner's own submission exists server-side but not locally (e.g.
    // after a reinstall/data loss) — adopt it as-is.
    await put(db, 'mySubmissions', { ...serverSubmission, syncStatus: 'synced' });
    return;
  }
  if (local.marks === serverSubmission.marks && local.teacherFeedback === serverSubmission.teacherFeedback) {
    return; // nothing changed, avoid an unnecessary write
  }
  await put(db, 'mySubmissions', {
    ...local,
    marks: serverSubmission.marks,
    teacherFeedback: serverSubmission.teacherFeedback,
  });
}

// ---- Sync queue + metadata ----

export async function enqueueSync(db, entityType, entityId, operation, payload) {
  const entry = {
    entityType, entityId, operation, payload,
    attempts: 0,
    nextAttemptAt: nowIso(),
    createdAt: nowIso(),
  };
  const result = await put(db, 'syncQueue', entry);
  window.dispatchEvent(new CustomEvent('app:sync-queue-changed'));
  return result;
}

export async function getSyncQueue(db) {
  return getAll(db, 'syncQueue');
}

export async function removeSyncQueueEntry(db, queueId) {
  return remove(db, 'syncQueue', queueId);
}

export async function getSyncMetadata(db) {
  const existing = await get(db, 'syncMetadata', 'singleton');
  return existing ?? { id: 'singleton', lastFullSyncAt: null, deviceId: generateId() };
}

export async function updateSyncMetadata(db, changes) {
  const existing = await getSyncMetadata(db);
  const updated = { ...existing, ...changes };
  await put(db, 'syncMetadata', updated);
  return updated;
}
