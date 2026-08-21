import { render, escapeHtml, formatDate } from '../../lib/dom.js';
import { navigate } from '../../lib/router.js';
import { listHomework, listMySubmissions } from '../../db/learner-schema.js';

async function categorize(db) {
  const homework = await listHomework(db);
  const submissions = await listMySubmissions(db);
  const subByHomework = Object.fromEntries(submissions.map((s) => [s.homeworkId, s]));
  const now = new Date();

  const published = homework.filter((h) => h.status === 'published');
  const buckets = { new: [], inProgress: [], overdue: [], submitted: [] };

  for (const h of published) {
    const sub = subByHomework[h.homeworkId];
    const isOverdue = h.dueDate && new Date(h.dueDate) < now;
    if (sub?.status === 'submitted') {
      buckets.submitted.push({ h, sub });
    } else if (sub && sub.answers?.length > 0) {
      (isOverdue ? buckets.overdue : buckets.inProgress).push({ h, sub });
    } else if (isOverdue) {
      buckets.overdue.push({ h, sub });
    } else {
      buckets.new.push({ h, sub });
    }
  }
  return buckets;
}

function section(title, items) {
  if (items.length === 0) return '';
  return `
    <h2 class="heading" style="font-size:var(--text-lg);">${title}</h2>
    <div class="card">
      ${items
        .map(
          ({ h, sub }) => `
        <div class="list-row" data-id="${h.homeworkId}" role="button">
          <div>
            <div class="card-title">${escapeHtml(h.title)}</div>
            <div class="card-sub">${escapeHtml(h.subject || '')} · due ${formatDate(h.dueDate)}</div>
          </div>
          ${sub?.marks != null ? `<span class="pill pill-published">${sub.marks} marks</span>` : ''}
        </div>`
        )
        .join('')}
    </div>
  `;
}

export async function renderLearnerHome(ctx) {
  const buckets = await categorize(ctx.learnerDb);
  const nothing = Object.values(buckets).every((arr) => arr.length === 0);
  render(`
    <div class="screen-header"><h1>My homework</h1></div>
    ${nothing ? `<div class="state-block"><h2>No homework yet</h2><p>Check back once your teacher publishes something.</p></div>` : ''}
    ${section('Overdue', buckets.overdue)}
    ${section('New', buckets.new)}
    ${section('In progress', buckets.inProgress)}
    ${section('Submitted', buckets.submitted)}
  `);
  wireRows(ctx);
}

export async function renderLearnerHomeworkTab(ctx) {
  const buckets = await categorize(ctx.learnerDb);
  const pending = [...buckets.overdue, ...buckets.new, ...buckets.inProgress];
  render(`
    <div class="screen-header"><h1>Homework</h1></div>
    ${pending.length === 0 ? `<div class="state-block"><h2>All caught up</h2></div>` : ''}
    ${section('Overdue', buckets.overdue)}
    ${section('New', buckets.new)}
    ${section('In progress', buckets.inProgress)}
  `);
  wireRows(ctx);
}

export async function renderLearnerDoneTab(ctx) {
  const buckets = await categorize(ctx.learnerDb);
  render(`
    <div class="screen-header"><h1>Done</h1></div>
    ${buckets.submitted.length === 0 ? `<div class="state-block"><h2>Nothing submitted yet</h2></div>` : ''}
    ${section('Submitted', buckets.submitted)}
  `);
  wireRows(ctx);
}

function wireRows(ctx) {
  document.querySelectorAll('.list-row[data-id]').forEach((row) => {
    row.addEventListener('click', () => navigate(`/learner/homework/${row.dataset.id}`));
  });
}
