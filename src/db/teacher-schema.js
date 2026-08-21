// Teacher IndexedDB — full read/write database. Store shapes and indexes
// match §8.1 of homework-pwa-architecture.md exactly. This file owns
// schema + CRUD only; sync-queue *processing* logic lives in src/sync
// (Phase 6/7) — this module just knows how to write TO the queue store.

import {
  openDb, put, putAll, get, getAll, getAllByIndex, remove, generateId, nowIso,
} from './idb-helpers.js';

export const TEACHER_DB_NAME = 'teacher_db';
export const TEACHER_DB_VERSION = 1;

function upgrade(db, oldVersion) {
  if (oldVersion < 1) {
    // Single-record store; always read/written under key 'singleton'.
    db.createObjectStore('teacher', { keyPath: 'teacherId' });

    const classes = db.createObjectStore('classes', { keyPath: 'classId' });
    classes.createIndex('subject', 'subject');
    classes.createIndex('updatedAt', 'updatedAt');
    classes.createIndex('syncStatus', 'syncStatus');

    const learners = db.createObjectStore('learners', { keyPath: 'learnerId' });
    learners.createIndex('classId', 'classId');
    learners.createIndex('classId_learnerCode', ['classId', 'learnerCode'], { unique: true });
    learners.createIndex('syncStatus', 'syncStatus');

    const homework = db.createObjectStore('homework', { keyPath: 'homeworkId' });
    homework.createIndex('classId', 'classId');
    homework.createIndex('status', 'status');
    homework.createIndex('dueDate', 'dueDate');
    homework.createIndex('syncStatus', 'syncStatus');

    const questions = db.createObjectStore('questions', { keyPath: 'questionId' });
    questions.createIndex('homeworkId', 'homeworkId');

    const submissions = db.createObjectStore('submissions', { keyPath: 'submissionId' });
    submissions.createIndex('homeworkId', 'homeworkId');
    submissions.createIndex('learnerId', 'learnerId');
    submissions.createIndex('homeworkId_learnerId', ['homeworkId', 'learnerId'], { unique: true });
    submissions.createIndex('syncStatus', 'syncStatus');

    const syncQueue = db.createObjectStore('syncQueue', { keyPath: 'queueId', autoIncrement: true });
    syncQueue.createIndex('nextAttemptAt', 'nextAttemptAt');
    syncQueue.createIndex('entityType', 'entityType');

    db.createObjectStore('syncMetadata', { keyPath: 'id' });
  }
}

export function openTeacherDb() {
  return openDb(TEACHER_DB_NAME, TEACHER_DB_VERSION, upgrade);
}

// ---- Teacher record (setup, once) ----

export async function getTeacher(db) {
  const all = await getAll(db, 'teacher');
  return all[0] ?? null;
}

export async function createTeacher(db, { teacherName, schoolName }) {
  const teacher = {
    teacherId: generateId(),
    teacherName,
    schoolName: schoolName ?? '',
    settings: {},
    syncSecret: generateId() + generateId(), // long random secret, see architecture §10
    createdAt: nowIso(),
  };
  await put(db, 'teacher', teacher);
  return teacher;
}

// ---- Classes ----

export async function createClass(db, { className, grade, subject }) {
  const record = {
    classId: generateId(),
    className,
    grade: grade ?? '',
    subject: subject ?? '',
    status: 'active',
    classCode: generateClassCode(),
    version: 1,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    syncStatus: 'local',
  };
  await put(db, 'classes', record);
  await enqueueSync(db, 'class', record.classId, 'create', record);
  return record;
}

function generateClassCode() {
  // Same unambiguous alphabet as learner codes (architecture §10 security
  // note): no 0/O, 1/I/l. Slightly longer than a learner code since it's
  // shared more widely (written on a board, read aloud to a class).
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

export async function updateClass(db, classId, changes) {
  const existing = await get(db, 'classes', classId);
  if (!existing) throw new Error(`Class ${classId} not found`);
  const updated = {
    ...existing,
    ...changes,
    version: existing.version + 1,
    updatedAt: nowIso(),
    syncStatus: 'local',
  };
  await put(db, 'classes', updated);
  await enqueueSync(db, 'class', classId, 'update', updated);
  return updated;
}

export async function deleteClass(db, classId) {
  // Hard delete cannot propagate through the sync engine safely (no
  // tombstone to sync) — resolved here as a proper soft-delete instead
  // of the placeholder throw from Phase 3.
  return archiveClass(db, classId);
}

export async function archiveClass(db, classId) {
  const existing = await get(db, 'classes', classId);
  if (!existing) throw new Error(`Class ${classId} not found`);
  const updated = {
    ...existing,
    status: 'archived',
    version: existing.version + 1,
    updatedAt: nowIso(),
    syncStatus: 'local',
  };
  await put(db, 'classes', updated);
  await enqueueSync(db, 'class', classId, 'update', updated);
  return updated;
}

export async function listClasses(db, { includeArchived = false } = {}) {
  const all = await getAll(db, 'classes');
  return includeArchived ? all : all.filter((c) => c.status !== 'archived');
}

// ---- Learners ----

export async function addLearner(db, { classId, firstName, surname, learnerCode }) {
  const record = {
    learnerId: generateId(),
    classId,
    firstName,
    surname: surname ?? '',
    learnerCode: learnerCode ?? generateLearnerCode(),
    version: 1,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    syncStatus: 'local',
  };
  await put(db, 'learners', record);
  await enqueueSync(db, 'learner', record.learnerId, 'create', record);
  return record;
}

export async function updateLearner(db, learnerId, changes) {
  const existing = await get(db, 'learners', learnerId);
  if (!existing) throw new Error(`Learner ${learnerId} not found`);
  const updated = {
    ...existing, ...changes,
    version: existing.version + 1,
    updatedAt: nowIso(),
    syncStatus: 'local',
  };
  await put(db, 'learners', updated);
  await enqueueSync(db, 'learner', learnerId, 'update', updated);
  return updated;
}

export async function listLearnersForClass(db, classId) {
  return getAllByIndex(db, 'learners', 'classId', classId);
}

function generateLearnerCode() {
  // Unambiguous alphabet: no 0/O, 1/I/l — per architecture §10 security note.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

// ---- Homework + Questions ----

export async function createHomeworkDraft(db, { classId, subject, title, instructions, dueDate, dueTime }) {
  const record = {
    homeworkId: generateId(),
    classId, subject: subject ?? '', title, instructions: instructions ?? '',
    dueDate: dueDate ?? null, dueTime: dueTime ?? null,
    status: 'draft',
    version: 1,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    syncStatus: 'local',
  };
  await put(db, 'homework', record);
  // Drafts are NOT queued for sync — only published homework should ever
  // leave the device, per the architecture's publish-triggers-sync flow.
  return record;
}

export async function addQuestion(db, { homeworkId, questionText, questionType, options, marks, order }) {
  const record = {
    questionId: generateId(),
    homeworkId, questionText, questionType,
    options: options ?? null,
    marks: marks ?? 0,
    order: order ?? 0,
  };
  await put(db, 'questions', record);
  return record;
}

export async function publishHomework(db, homeworkId) {
  const existing = await get(db, 'homework', homeworkId);
  if (!existing) throw new Error(`Homework ${homeworkId} not found`);
  const questions = await getAllByIndex(db, 'questions', 'homeworkId', homeworkId);
  if (questions.length === 0) {
    throw new Error('Cannot publish homework with no questions');
  }
  const updated = {
    ...existing,
    status: 'published',
    version: existing.version + 1,
    updatedAt: nowIso(),
    syncStatus: 'local',
  };
  await put(db, 'homework', updated);
  // Publishing is the sync trigger — bundle homework + its questions in one
  // queue payload so the Worker can insert both atomically server-side.
  await enqueueSync(db, 'homework', homeworkId, 'update', { ...updated, questions });
  return updated;
}

export async function listHomeworkForClass(db, classId) {
  return getAllByIndex(db, 'homework', 'classId', classId);
}

export async function getQuestionsForHomework(db, homeworkId) {
  return getAllByIndex(db, 'questions', 'homeworkId', homeworkId);
}

// ---- Submissions (teacher side: read + mark, never originates answers) ----

export async function listSubmissionsForHomework(db, homeworkId) {
  return getAllByIndex(db, 'submissions', 'homeworkId', homeworkId);
}

export async function markSubmission(db, submissionId, { marks, teacherFeedback }) {
  const existing = await get(db, 'submissions', submissionId);
  if (!existing) throw new Error(`Submission ${submissionId} not found`);
  const updated = {
    ...existing,
    marks, teacherFeedback,
    updatedAt: nowIso(),
    syncStatus: 'local',
  };
  await put(db, 'submissions', updated);
  await enqueueSync(db, 'submission', submissionId, 'update', updated);
  return updated;
}

// ---- Sync queue + metadata (written here, processed by src/sync in Phase 6/7) ----

export async function enqueueSync(db, entityType, entityId, operation, payload) {
  const entry = {
    entityType, entityId, operation, payload,
    attempts: 0,
    nextAttemptAt: nowIso(),
    createdAt: nowIso(),
  };
  const result = await put(db, 'syncQueue', entry);
  // Let the running sync loop (and the shell banner) know immediately,
  // rather than waiting for the next periodic cycle — matches the
  // architecture's "if internet exists, it synchronises immediately"
  // publish workflow. Found missing during Phase 6 testing: the banner
  // was silently stale until the next 60s tick without this.
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
  return existing ?? { id: 'singleton', lastFullSyncAt: null, lastSubmissionsPullAt: null, deviceId: generateId() };
}

export async function updateSyncMetadata(db, changes) {
  const existing = await getSyncMetadata(db);
  const updated = { ...existing, ...changes };
  await put(db, 'syncMetadata', updated);
  return updated;
}
