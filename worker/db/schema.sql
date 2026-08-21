-- D1 schema (durable backstop). Mirrors teacher IndexedDB stores.
-- Applied via: wrangler d1 migrations apply homework_db
-- Every table keyed by a client-generated UUID (never server auto-increment),
-- so offline-created records from any device never collide.

CREATE TABLE IF NOT EXISTS teachers (
  teacherId       TEXT PRIMARY KEY,
  teacherName     TEXT NOT NULL,
  schoolName      TEXT,
  syncSecretHash  TEXT NOT NULL,   -- hash of the teacher's local syncSecret, never the raw secret
  settings        TEXT,            -- JSON blob
  createdAt       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS classes (
  classId     TEXT PRIMARY KEY,
  teacherId   TEXT NOT NULL REFERENCES teachers(teacherId),
  className   TEXT NOT NULL,
  grade       TEXT,
  subject     TEXT,
  classCode   TEXT NOT NULL UNIQUE,  -- shared secret learners use to join
  status      TEXT NOT NULL DEFAULT 'active', -- active | archived — added Phase 7 after discovering schema drift from the Phase 4 client-side soft-delete feature
  version     INTEGER NOT NULL DEFAULT 1,
  createdAt   TEXT NOT NULL,
  updatedAt   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_classes_teacher ON classes(teacherId);

CREATE TABLE IF NOT EXISTS learners (
  learnerId    TEXT PRIMARY KEY,
  classId      TEXT NOT NULL REFERENCES classes(classId),
  firstName    TEXT NOT NULL,
  surname      TEXT,
  learnerCode  TEXT NOT NULL,       -- unique within class, enforced at write time
  version      INTEGER NOT NULL DEFAULT 1,
  createdAt    TEXT NOT NULL,
  updatedAt    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learners_class ON learners(classId);
CREATE UNIQUE INDEX IF NOT EXISTS idx_learners_class_code ON learners(classId, learnerCode);

CREATE TABLE IF NOT EXISTS homework (
  homeworkId    TEXT PRIMARY KEY,
  classId       TEXT NOT NULL REFERENCES classes(classId),
  subject       TEXT,
  title         TEXT NOT NULL,
  instructions  TEXT,
  dueDate       TEXT,
  dueTime       TEXT,
  status        TEXT NOT NULL DEFAULT 'draft', -- draft | published | closed
  version       INTEGER NOT NULL DEFAULT 1,
  createdAt     TEXT NOT NULL,
  updatedAt     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_homework_class ON homework(classId);
CREATE INDEX IF NOT EXISTS idx_homework_status ON homework(status);

CREATE TABLE IF NOT EXISTS questions (
  questionId    TEXT PRIMARY KEY,
  homeworkId    TEXT NOT NULL REFERENCES homework(homeworkId),
  questionText  TEXT NOT NULL,
  questionType  TEXT NOT NULL,   -- short | long | mcq | truefalse
  options       TEXT,            -- JSON array, mcq only
  marks         INTEGER NOT NULL DEFAULT 0,
  "order"       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_questions_homework ON questions(homeworkId);

CREATE TABLE IF NOT EXISTS submissions (
  submissionId    TEXT PRIMARY KEY,   -- client-generated once; upserts make double-submit safe
  homeworkId      TEXT NOT NULL REFERENCES homework(homeworkId),
  learnerId       TEXT NOT NULL REFERENCES learners(learnerId),
  answers         TEXT NOT NULL,       -- JSON array of {questionId, value}
  status          TEXT NOT NULL DEFAULT 'in_progress', -- in_progress | submitted
  marks           INTEGER,
  teacherFeedback TEXT,
  version         INTEGER NOT NULL DEFAULT 1,
  submittedAt     TEXT,
  updatedAt       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_submissions_homework ON submissions(homeworkId);
CREATE INDEX IF NOT EXISTS idx_submissions_learner ON submissions(learnerId);
CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_hw_learner ON submissions(homeworkId, learnerId);
