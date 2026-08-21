import { render, escapeHtml, formatDate, showToast } from '../../lib/dom.js';
import { navigate } from '../../lib/router.js';
import { get } from '../../db/idb-helpers.js';
import {
  listLearnersForClass, addLearner, listHomeworkForClass, archiveClass,
} from '../../db/teacher-schema.js';

let activeTab = 'homework';

export async function renderClassDetail(ctx, { classId }) {
  const cls = await get(ctx.db, 'classes', classId);
  if (!cls) {
    render(`<div class="state-block"><h2>Class not found</h2><button class="btn btn-secondary" id="btn-back">Back to classes</button></div>`);
    document.getElementById('btn-back').addEventListener('click', () => navigate('/classes'));
    return;
  }

  const learners = await listLearnersForClass(ctx.db, classId);
  const homework = await listHomeworkForClass(ctx.db, classId);

  render(`
    <button class="back-link" id="btn-back">‹ Classes</button>
    <div class="screen-header"><h1>${escapeHtml(cls.className)}</h1></div>
    <p class="card-sub" style="margin-top:-12px;margin-bottom:var(--space-3);">${escapeHtml(cls.subject || 'No subject')}</p>
    <div class="card" style="background:var(--success-bg);border-color:var(--success);">
      <div class="card-title">Class code</div>
      <div class="card-sub">Give this to learners so they can join — along with their own learner code from the Learners tab.</div>
      <p class="class-code-display" style="margin:var(--space-2) 0 0;font-size:var(--text-xl);font-weight:700;font-family:var(--font-code);letter-spacing:0.08em;">${escapeHtml(cls.classCode)}</p>
    </div>

    <div class="tabs" role="tablist">
      <button class="tab-btn" data-tab="homework" aria-selected="${activeTab === 'homework'}">Homework</button>
      <button class="tab-btn" data-tab="learners" aria-selected="${activeTab === 'learners'}">Learners</button>
    </div>

    <div id="tab-panel"></div>

    <div style="margin-top:var(--space-6);">
      <button class="btn btn-secondary btn-block" id="btn-archive">Archive this class</button>
    </div>
  `);

  document.getElementById('btn-back').addEventListener('click', () => navigate('/classes'));
  document.getElementById('btn-archive').addEventListener('click', async () => {
    if (!confirm(`Archive "${cls.className}"? You can still see it via Settings, but it won't show in your class list.`)) return;
    await archiveClass(ctx.db, classId);
    showToast('Class archived');
    navigate('/classes');
  });

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      activeTab = btn.dataset.tab;
      await renderClassDetail(ctx, { classId });
    });
  });

  renderTabPanel(ctx, classId, learners, homework);
}

function renderTabPanel(ctx, classId, learners, homework) {
  const panel = document.getElementById('tab-panel');
  if (activeTab === 'homework') {
    panel.innerHTML = `
      <button class="btn btn-primary btn-block" id="btn-new-hw" style="margin-bottom:var(--space-4);">+ New homework</button>
      ${
        homework.length === 0
          ? `<div class="state-block"><p>No homework yet for this class.</p></div>`
          : `<div class="card">${homework
              .map(
                (h) => `
              <div class="list-row" data-id="${h.homeworkId}" role="button">
                <div>
                  <div class="card-title">${escapeHtml(h.title)}</div>
                  <div class="card-sub">${formatDate(h.dueDate)}</div>
                </div>
                <span class="pill pill-${h.status}">${h.status}</span>
              </div>`
              )
              .join('')}</div>`
      }
    `;
    document.getElementById('btn-new-hw').addEventListener('click', () => navigate(`/classes/${classId}/homework/new`));
    panel.querySelectorAll('.list-row[data-id]').forEach((row) => {
      row.addEventListener('click', () => navigate(`/classes/${classId}/homework/${row.dataset.id}`));
    });
  } else {
    panel.innerHTML = `
      <div class="card">
        <form id="learner-form">
          <div class="btn-row" style="margin-top:0;gap:var(--space-2);">
            <input id="firstName" placeholder="First name" required style="flex:1;min-height:var(--tap-min);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0 var(--space-3);" />
            <input id="surname" placeholder="Surname (optional)" style="flex:1;min-height:var(--tap-min);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0 var(--space-3);" />
            <button type="submit" class="btn btn-primary">Add</button>
          </div>
        </form>
      </div>
      ${
        learners.length === 0
          ? `<div class="state-block"><p>No learners added yet.</p></div>`
          : `<div class="card">${learners
              .map(
                (l) => `
              <div class="list-row">
                <div>
                  <div class="card-title">${escapeHtml(l.firstName)} ${escapeHtml(l.surname)}</div>
                  <div class="card-sub">Class code: <span class="code-display">${escapeHtml(l.learnerCode)}</span></div>
                </div>
              </div>`
              )
              .join('')}</div>`
      }
    `;
    document.getElementById('learner-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const firstName = document.getElementById('firstName').value.trim();
      const surname = document.getElementById('surname').value.trim();
      if (!firstName) return;
      await addLearner(ctx.db, { classId, firstName, surname });
      await renderClassDetail(ctx, { classId });
    });
  }
}
