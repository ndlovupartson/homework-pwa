import { render, formatDate, escapeHtml } from '../../lib/dom.js';
import { navigate } from '../../lib/router.js';
import {
  listClasses, listLearnersForClass, listHomeworkForClass, getSyncQueue,
} from '../../db/teacher-schema.js';

export async function renderDashboard(ctx) {
  const classes = await listClasses(ctx.db);
  const learnerCounts = await Promise.all(classes.map((c) => listLearnersForClass(ctx.db, c.classId)));
  const totalLearners = learnerCounts.reduce((sum, arr) => sum + arr.length, 0);

  const homeworkLists = await Promise.all(classes.map((c) => listHomeworkForClass(ctx.db, c.classId)));
  const allHomework = homeworkLists.flat();
  const activeHomework = allHomework.filter((h) => h.status === 'published');
  const recent = [...allHomework].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);

  const queue = await getSyncQueue(ctx.db);

  const classById = Object.fromEntries(classes.map((c) => [c.classId, c]));

  render(`
    <div class="screen-header"><h1>Dashboard</h1></div>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-number">${classes.length}</div>
        <div class="stat-label">Classes</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${totalLearners}</div>
        <div class="stat-label">Learners</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${activeHomework.length}</div>
        <div class="stat-label">Active homework</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${queue.length}</div>
        <div class="stat-label">${queue.length === 1 ? 'Item' : 'Items'} waiting to sync</div>
      </div>
    </div>

    <h2 class="heading" style="font-size:var(--text-lg);">Recent homework</h2>
    ${
      recent.length === 0
        ? `<div class="state-block"><p>No homework yet.</p><button class="btn btn-primary" id="btn-create">Create your first homework</button></div>`
        : `<div class="card">${recent
            .map(
              (h) => `
            <div class="list-row" data-id="${h.homeworkId}" data-class="${h.classId}" role="button">
              <div>
                <div class="card-title">${escapeHtml(h.title)}</div>
                <div class="card-sub">${escapeHtml(classById[h.classId]?.className ?? '')} · ${formatDate(h.dueDate)}</div>
              </div>
              <span class="pill pill-${h.status}">${h.status}</span>
            </div>`
            )
            .join('')}</div>`
    }
  `);

  document.getElementById('btn-create')?.addEventListener('click', () => navigate('/classes'));
  document.querySelectorAll('#app-content .list-row[data-id]').forEach((row) => {
    row.addEventListener('click', () => navigate(`/classes/${row.dataset.class}/homework/${row.dataset.id}`));
  });
}
