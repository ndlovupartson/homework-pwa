import { initAppShell, setPendingSyncCount } from './app-shell/shell.js';
import { registerRoute, startRouter, navigate } from './lib/router.js';
import { openTeacherDb, getTeacher } from './db/teacher-schema.js';
import * as teacherSchema from './db/teacher-schema.js';
import { openLearnerDb, getLearnerIdentity } from './db/learner-schema.js';
import * as learnerSchema from './db/learner-schema.js';
import { startSyncLoop } from './sync/engine.js';
import { showToast } from './lib/dom.js';

import { renderWelcome } from './screens/welcome.js';
import { renderTeacherSetup } from './screens/teacher/setup.js';
import { renderDashboard } from './screens/teacher/dashboard.js';
import { renderClasses } from './screens/teacher/classes.js';
import { renderClassDetail } from './screens/teacher/class-detail.js';
import { renderCreateHomework } from './screens/teacher/create-homework.js';
import { renderHomeworkDetail } from './screens/teacher/homework-detail.js';
import { renderSubmissionsOverview } from './screens/teacher/submissions-overview.js';
import { renderSettings } from './screens/teacher/settings.js';

import { renderJoin } from './screens/learner/join.js';
import { renderLearnerHome, renderLearnerHomeworkTab, renderLearnerDoneTab } from './screens/learner/dashboard.js';
import { renderLearnerHomework } from './screens/learner/homework-answer.js';
import { renderConfirmation } from './screens/learner/confirmation.js';

const NO_GUARD = new Set(['/', '/teacher/setup', '/learner/join']);

async function boot() {
  const db = await openTeacherDb();
  const learnerDb = await openLearnerDb();
  const ctx = { db, learnerDb };

  const TEACHER_TAB_FOR_PATH = [
    [/^\/dashboard/, 'dashboard'],
    [/^\/classes/, 'classes'],
    [/^\/submissions/, 'submissions'],
    [/^\/settings/, 'settings'],
  ];
  const LEARNER_TAB_FOR_PATH = [
    [/^\/learner\/home$/, 'home'],
    [/^\/learner\/homework/, 'homework'],
    [/^\/learner\/done/, 'done'],
  ];

  function syncNav(path) {
    if (path.startsWith('/learner/')) {
      const match = LEARNER_TAB_FOR_PATH.find(([re]) => re.test(path));
      initAppShell({
        role: 'learner',
        activeTab: match ? match[1] : 'home',
        onNavigate: (tab) => navigate(`/learner/${tab}`),
      });
    } else {
      const match = TEACHER_TAB_FOR_PATH.find(([re]) => re.test(path));
      initAppShell({
        role: 'teacher',
        activeTab: match ? match[1] : 'dashboard',
        onNavigate: (tab) => navigate(tab === 'create' ? '/classes' : `/${tab}`),
      });
    }
  }

  async function guarded(path, role, renderFn) {
    if (!NO_GUARD.has(path)) {
      if (role === 'teacher' && !(await getTeacher(db))) return navigate('/');
      if (role === 'learner' && !(await getLearnerIdentity(learnerDb))) return navigate('/');
    }
    syncNav(path);
    await renderFn();
  }

  registerRoute('/', () =>
    guarded('/', null, async () => {
      // If this device already has an identity, skip the role-select
      // screen and go straight in — Welcome is for first-time setup only.
      // A returning teacher landing on '/' (e.g. after a restore, or any
      // navigation that resets to the root) shouldn't be asked "are you a
      // teacher or a learner?" again. Found while testing Phase 9 restore.
      const existingTeacher = await getTeacher(db);
      if (existingTeacher) return navigate('/dashboard');
      const existingLearner = await getLearnerIdentity(learnerDb);
      if (existingLearner) return navigate('/learner/home');
      await renderWelcome();
    })
  );
  registerRoute('/teacher/setup', () => guarded('/teacher/setup', 'teacher', () => renderTeacherSetup(ctx)));
  registerRoute('/dashboard', () => guarded('/dashboard', 'teacher', () => renderDashboard(ctx)));
  registerRoute('/classes', () => guarded('/classes', 'teacher', () => renderClasses(ctx)));
  registerRoute('/classes/:classId', (p) => guarded(`/classes/${p.classId}`, 'teacher', () => renderClassDetail(ctx, p)));
  registerRoute('/classes/:classId/homework/new', (p) =>
    guarded(`/classes/${p.classId}/homework/new`, 'teacher', () => renderCreateHomework(ctx, p))
  );
  registerRoute('/classes/:classId/homework/:homeworkId', (p) =>
    guarded(`/classes/${p.classId}/homework/${p.homeworkId}`, 'teacher', () => renderHomeworkDetail(ctx, p))
  );
  registerRoute('/submissions', () => guarded('/submissions', 'teacher', () => renderSubmissionsOverview(ctx)));
  registerRoute('/settings', () => guarded('/settings', 'teacher', () => renderSettings(ctx)));

  registerRoute('/learner/join', () => guarded('/learner/join', null, () => renderJoin(ctx)));
  registerRoute('/learner/home', () => guarded('/learner/home', 'learner', () => renderLearnerHome(ctx)));
  registerRoute('/learner/homework', () => guarded('/learner/homework', 'learner', () => renderLearnerHomeworkTab(ctx)));
  registerRoute('/learner/done', () => guarded('/learner/done', 'learner', () => renderLearnerDoneTab(ctx)));
  registerRoute('/learner/homework/:homeworkId', (p) =>
    guarded(`/learner/homework/${p.homeworkId}`, 'learner', () => renderLearnerHomework(ctx, p))
  );
  registerRoute('/learner/homework/:homeworkId/confirmation', (p) =>
    guarded(`/learner/homework/${p.homeworkId}/confirmation`, 'learner', () => renderConfirmation(ctx, p))
  );

  startRouter('/');

  // Sync loop: real retry/backoff logic, running against the real (still
  // Phase-7-pending) API — see architecture §9.2 and src/sync/engine.js.
  // A separate loop per role so a device that's only ever used as one role
  // doesn't spend cycles on the other's queue.
  startSyncLoop({
    role: 'teacher',
    schema: teacherSchema,
    db,
    onQueueChange: (count) => {
      if (!window.location.hash.startsWith('#/learner')) setPendingSyncCount(count);
    },
  });
  startSyncLoop({
    role: 'learner',
    schema: learnerSchema,
    db: learnerDb,
    onQueueChange: (count) => {
      if (window.location.hash.startsWith('#/learner')) setPendingSyncCount(count);
    },
    onConflictNotice: (entityType, entityId, label) => {
      if (entityType === 'homework') {
        showToast(`"${label ?? 'A homework item'}" was updated by your teacher.`);
      }
    },
  });

  // Immediately reflect a newly-queued item in the banner rather than
  // waiting for the next periodic tick — see the comment in
  // teacher-schema.js / learner-schema.js enqueueSync for why this exists.
  window.addEventListener('app:sync-queue-changed', async () => {
    const isLearner = window.location.hash.startsWith('#/learner');
    const count = (await (isLearner ? learnerSchema : teacherSchema).getSyncQueue(isLearner ? learnerDb : db)).length;
    setPendingSyncCount(count);
  });

  // Register the service worker directly rather than waiting for the
  // 'load' event: boot() is async (several awaits above for opening both
  // IndexedDB databases), so by the time execution reaches this point the
  // page's 'load' event has often already fired and completed — a
  // window.addEventListener('load', ...) here would silently never run.
  // Found by testing, not assumed: see README Phase 6 notes.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').catch((err) => {
      console.error('[app] service worker registration failed', err);
    });
  }
}

boot();
