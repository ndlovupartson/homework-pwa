// Backup & restore, per architecture §11. Export produces a single JSON
// file the teacher controls (move to a new phone, keep an offline copy);
// import is idempotent (safe to run twice) and re-queues everything for
// sync so a restore-after-data-loss eventually reaches the D1 backstop
// again, not just the local device.

import { getAll, put } from '../db/idb-helpers.js';
import { getTeacher, enqueueSync } from '../db/teacher-schema.js';

const SCHEMA_VERSION = 1;
const STORES = ['classes', 'learners', 'homework', 'questions', 'submissions'];

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function exportBackup(db) {
  const teacher = await getTeacher(db);
  if (!teacher) throw new Error('No teacher set up on this device — nothing to export');

  const data = { teacher };
  for (const store of STORES) {
    data[store] = await getAll(db, store);
  }

  const dataJson = JSON.stringify(data);
  const checksum = await sha256Hex(dataJson);

  const backup = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    teacherId: teacher.teacherId,
    checksum,
    data,
  };

  return JSON.stringify(backup, null, 2);
}

/** Triggers a browser file download of the export — no server round-trip, purely local. */
export function downloadBackupFile(jsonText, filename) {
  const blob = new Blob([jsonText], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `homework-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function migrate(backup) {
  // No migrations needed yet — SCHEMA_VERSION has only ever been 1. This
  // function exists so a future schema change has a place to land
  // (`if (backup.schemaVersion < 2) { ...transform... }`) rather than
  // requiring readers to invent the pattern under time pressure later.
  return backup;
}

/**
 * Validates and applies a backup. Throws with a clear message on any
 * problem — corrupted file, unrecognized format, or (deliberately, for
 * MVP safety) an attempt to import a different teacher's data onto a
 * device that already has its own identity set up. See README Phase 9
 * notes for why that last case is refused rather than merged.
 */
export async function importBackup(db, jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('This file is not valid JSON — it may be corrupted or not a homework backup at all.');
  }

  if (!parsed || typeof parsed !== 'object' || !parsed.data || !parsed.checksum || !parsed.schemaVersion) {
    throw new Error("This doesn't look like a homework backup file.");
  }

  const recomputed = await sha256Hex(JSON.stringify(parsed.data));
  if (recomputed !== parsed.checksum) {
    throw new Error('This backup file appears to be corrupted or was edited — checksum does not match. Restore was NOT applied.');
  }

  if (parsed.schemaVersion > SCHEMA_VERSION) {
    throw new Error('This backup was made with a newer version of the app. Update the app before restoring it.');
  }

  const backup = migrate(parsed);

  const existingTeacher = await getTeacher(db);
  if (existingTeacher && existingTeacher.teacherId !== backup.teacherId) {
    throw new Error(
      "This backup belongs to a different teacher account than the one set up on this device. " +
      "Importing it here would mix two different teachers' data, so it's refused rather than merged. " +
      "Restore onto a fresh install instead if you're moving to a new device."
    );
  }

  if (!existingTeacher) {
    // Fresh device (e.g. after a phone loss/replacement) — adopt this identity.
    await put(db, 'teacher', backup.data.teacher);
  }

  const counts = {};
  for (const store of STORES) {
    const records = backup.data[store] || [];
    for (const record of records) {
      await put(db, store, record);
    }
    counts[store] = records.length;
  }

  // Re-queue everything for sync — harmless if the server already has it
  // (idempotent upsert-by-UUID, per architecture §9/§16), essential if
  // this restore is recovering data that was lost before it ever synced.
  for (const cls of backup.data.classes || []) {
    await enqueueSync(db, 'class', cls.classId, 'update', cls);
  }
  for (const learner of backup.data.learners || []) {
    await enqueueSync(db, 'learner', learner.learnerId, 'update', learner);
  }
  for (const hw of backup.data.homework || []) {
    if (hw.status !== 'published') continue; // only published homework is meant to leave the device
    const questions = (backup.data.questions || []).filter((q) => q.homeworkId === hw.homeworkId);
    await enqueueSync(db, 'homework', hw.homeworkId, 'update', { ...hw, questions });
  }
  for (const sub of backup.data.submissions || []) {
    if (sub.marks == null && !sub.teacherFeedback) continue; // nothing teacher-authored to recover
    // Re-queued under the teacher's own sync — the Worker's field-scoped
    // merge (architecture finding, Phase 7) means this only ever touches
    // marks/teacherFeedback server-side, never a learner's answers. Note:
    // if the corresponding submission was never synced by the LEARNER'S
    // device either, the server has no row to attach these marks to yet,
    // and this push will fail until the learner's own device syncs first
    // — a real, known limitation of recovering from backup alone.
    await enqueueSync(db, 'submission', sub.submissionId, 'update', sub);
  }

  return counts;
}
