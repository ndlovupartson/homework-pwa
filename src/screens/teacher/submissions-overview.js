import { render, escapeHtml, formatDate } from '../../lib/dom.js';
import { navigate } from '../../lib/router.js';
import { listClasses, listHomeworkForClass, listSubmissionsForHomework, listLearnersForClass } from '../../db/teacher-schema.js';

export async function renderSubmissionsOverview(ctx) {
  const classes = await listClasses(ctx.db);
  const rows = [];
  for (const cls of classes) {
    const homework = (await listHomeworkForClass(ctx.db, cls.classId)).filter((h) => h.status === 'published');
    const learners = await listLearnersForClass(ctx.db, cls.classId);
    for (const h of homework) {
      const submissions = await listSubmissionsForHomework(ctx.db, h.homeworkId);
      const submittedCount = submissions.filter((s) => s.status === 'submitted').length;
      rows.push({ classId: cls.classId, className: cls.className, homework: h, submittedCount, totalLearners: learners.length });
    }
  }
  rows.sort((a, b) => (a.homework.dueDate || '').localeCompare(b.homework.dueDate || ''));

  render(`
    <div class="screen-header"><h1>Submissions</h1></div>
    ${
      rows.length === 0
        ? `<div class="state-block"><h2>Nothing published yet</h2><p>Once you publish homework, submissions will show up here.</p></div>`
        : `<div class="card">${rows
            .map(
              (r) => `
          <div class="list-row" data-class="${r.classId}" data-hw="${r.homework.homeworkId}" role="button">
            <div>
              <div class="card-title">${escapeHtml(r.homework.title)}</div>
              <div class="card-sub">${escapeHtml(r.className)} · due ${formatDate(r.homework.dueDate)}</div>
            </div>
            <span class="pill ${r.submittedCount === r.totalLearners && r.totalLearners > 0 ? 'pill-published' : 'pill-draft'}">${r.submittedCount}/${r.totalLearners}</span>
          </div>`
            )
            .join('')}</div>`
    }
  `);

  document.querySelectorAll('.list-row[data-hw]').forEach((row) => {
    row.addEventListener('click', () => navigate(`/classes/${row.dataset.class}/homework/${row.dataset.hw}`));
  });
}
