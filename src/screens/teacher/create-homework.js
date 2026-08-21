import { render, escapeHtml, showToast } from '../../lib/dom.js';
import { navigate } from '../../lib/router.js';
import { createHomeworkDraft, addQuestion, publishHomework } from '../../db/teacher-schema.js';

// In-memory question list while building — nothing is written to IndexedDB
// until Save Draft or Publish, so an abandoned half-filled form never
// leaves partial data behind.
let draftQuestions = [];

export function renderCreateHomework(ctx, { classId }) {
  draftQuestions = [{ questionText: '', questionType: 'short', marks: 1, options: [''] }];

  renderScreen(ctx, classId);
}

function renderScreen(ctx, classId) {
  render(`
    <button class="back-link" id="btn-back">‹ Back</button>
    <div class="screen-header"><h1>New homework</h1></div>

    <div class="field"><label for="title">Title</label>
      <input id="title" required placeholder="e.g. Fractions Practice" /></div>
    <div class="field"><label for="subject">Subject</label>
      <input id="subject" placeholder="e.g. Maths" /></div>
    <div class="field"><label for="instructions">Instructions</label>
      <textarea id="instructions" placeholder="What should learners do?"></textarea></div>
    <div class="btn-row" style="margin-top:0;">
      <div class="field" style="flex:1;"><label for="dueDate">Due date</label><input id="dueDate" type="date" /></div>
      <div class="field" style="flex:1;"><label for="dueTime">Due time</label><input id="dueTime" type="time" /></div>
    </div>

    <h2 class="heading" style="font-size:var(--text-lg);">Questions</h2>
    <div id="questions-list"></div>
    <button class="btn btn-secondary btn-block" id="btn-add-question">+ Add question</button>

    <div class="btn-row">
      <button class="btn btn-secondary" id="btn-save-draft">Save draft</button>
      <button class="btn btn-primary" id="btn-publish">Publish</button>
    </div>
  `);

  document.getElementById('btn-back').addEventListener('click', () => navigate(`/classes/${classId}`));
  document.getElementById('btn-add-question').addEventListener('click', () => {
    draftQuestions.push({ questionText: '', questionType: 'short', marks: 1, options: [''] });
    renderQuestions(classId);
  });
  document.getElementById('btn-save-draft').addEventListener('click', () => saveHomework(ctx, classId, false));
  document.getElementById('btn-publish').addEventListener('click', () => saveHomework(ctx, classId, true));

  renderQuestions(classId);
}

function renderQuestions(classId) {
  const list = document.getElementById('questions-list');
  list.innerHTML = draftQuestions
    .map(
      (q, i) => `
    <div class="question-card" data-index="${i}">
      <div class="field"><label>Question ${i + 1}</label>
        <input class="q-text" value="${escapeHtml(q.questionText)}" placeholder="Question text" /></div>
      <div class="btn-row" style="margin-top:0;">
        <div class="field" style="flex:2;">
          <select class="q-type">
            <option value="short" ${q.questionType === 'short' ? 'selected' : ''}>Short answer</option>
            <option value="long" ${q.questionType === 'long' ? 'selected' : ''}>Long answer</option>
            <option value="mcq" ${q.questionType === 'mcq' ? 'selected' : ''}>Multiple choice</option>
            <option value="truefalse" ${q.questionType === 'truefalse' ? 'selected' : ''}>True / False</option>
          </select>
        </div>
        <div class="field" style="flex:1;">
          <input class="q-marks" type="number" min="0" value="${q.marks}" placeholder="Marks" />
        </div>
      </div>
      ${
        q.questionType === 'mcq'
          ? `<div class="field"><label>Options (comma separated)</label>
              <input class="q-options" value="${escapeHtml(q.options.join(', '))}" placeholder="e.g. 1/2, 1/4, 3/4" /></div>`
          : ''
      }
      ${draftQuestions.length > 1 ? `<button type="button" class="link-remove" data-remove="${i}">Remove question</button>` : ''}
    </div>
  `
    )
    .join('');

  list.querySelectorAll('.question-card').forEach((card) => {
    const i = Number(card.dataset.index);
    card.querySelector('.q-text').addEventListener('input', (e) => (draftQuestions[i].questionText = e.target.value));
    card.querySelector('.q-type').addEventListener('change', (e) => {
      draftQuestions[i].questionType = e.target.value;
      renderQuestions(classId);
    });
    card.querySelector('.q-marks').addEventListener('input', (e) => (draftQuestions[i].marks = Number(e.target.value) || 0));
    card.querySelector('.q-options')?.addEventListener('input', (e) => {
      draftQuestions[i].options = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
    });
  });
  list.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      draftQuestions.splice(Number(btn.dataset.remove), 1);
      renderQuestions(classId);
    });
  });
}

async function saveHomework(ctx, classId, publish) {
  const title = document.getElementById('title').value.trim();
  if (!title) {
    showToast('Please add a title before saving.');
    return;
  }
  const validQuestions = draftQuestions.filter((q) => q.questionText.trim());
  if (publish && validQuestions.length === 0) {
    showToast("Add at least one question before publishing.");
    return;
  }

  const homework = await createHomeworkDraft(ctx.db, {
    classId,
    subject: document.getElementById('subject').value.trim(),
    title,
    instructions: document.getElementById('instructions').value.trim(),
    dueDate: document.getElementById('dueDate').value || null,
    dueTime: document.getElementById('dueTime').value || null,
  });

  for (let i = 0; i < validQuestions.length; i++) {
    const q = validQuestions[i];
    await addQuestion(ctx.db, {
      homeworkId: homework.homeworkId,
      questionText: q.questionText.trim(),
      questionType: q.questionType,
      options: q.questionType === 'mcq' ? q.options : null,
      marks: q.marks,
      order: i,
    });
  }

  if (publish) {
    await publishHomework(ctx.db, homework.homeworkId);
    showToast('Homework published — learners can now see it.');
  } else {
    showToast('Draft saved.');
  }

  navigate(`/classes/${classId}/homework/${homework.homeworkId}`);
}
