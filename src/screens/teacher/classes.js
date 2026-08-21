import { render, escapeHtml } from '../../lib/dom.js';
import { navigate } from '../../lib/router.js';
import { listClasses, createClass, listLearnersForClass } from '../../db/teacher-schema.js';

export async function renderClasses(ctx) {
  const classes = await listClasses(ctx.db);
  const counts = await Promise.all(classes.map((c) => listLearnersForClass(ctx.db, c.classId)));

  render(`
    <div class="screen-header">
      <h1>Classes</h1>
      <button class="btn btn-primary" id="btn-new-class">+ New class</button>
    </div>

    <div id="new-class-form" style="display:none;" class="card">
      <form id="class-form">
        <div class="field"><label for="className">Class name</label>
          <input id="className" required placeholder="e.g. Grade 4A" /></div>
        <div class="field"><label for="subject">Subject</label>
          <input id="subject" placeholder="e.g. Maths" /></div>
        <div class="field"><label for="grade">Grade (optional)</label>
          <input id="grade" placeholder="e.g. Grade 4" /></div>
        <div class="btn-row">
          <button type="button" class="btn btn-secondary" id="btn-cancel">Cancel</button>
          <button type="submit" class="btn btn-primary">Create class</button>
        </div>
      </form>
    </div>

    ${
      classes.length === 0
        ? `<div class="state-block"><h2>No classes yet</h2><p>Create a class to start adding learners and homework.</p></div>`
        : `<div class="card">${classes
            .map(
              (c, i) => `
            <div class="list-row" data-id="${c.classId}" role="button">
              <div>
                <div class="card-title">${escapeHtml(c.className)}</div>
                <div class="card-sub">${escapeHtml(c.subject || 'No subject')} · ${counts[i].length} learner${counts[i].length === 1 ? '' : 's'}</div>
              </div>
              <span aria-hidden="true">›</span>
            </div>`
            )
            .join('')}</div>`
    }
  `);

  const form = document.getElementById('new-class-form');
  document.getElementById('btn-new-class').addEventListener('click', () => {
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
  });
  document.getElementById('btn-cancel').addEventListener('click', () => (form.style.display = 'none'));

  document.getElementById('class-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const className = document.getElementById('className').value.trim();
    if (!className) return;
    const subject = document.getElementById('subject').value.trim();
    const grade = document.getElementById('grade').value.trim();
    const created = await createClass(ctx.db, { className, subject, grade });
    navigate(`/classes/${created.classId}`);
  });

  document.querySelectorAll('#app-content .list-row[data-id]').forEach((row) => {
    row.addEventListener('click', () => navigate(`/classes/${row.dataset.id}`));
  });
}
