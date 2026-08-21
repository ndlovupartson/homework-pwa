import { render, escapeHtml, formatDate, showToast } from '../../lib/dom.js';
import { navigate } from '../../lib/router.js';
import { get } from '../../db/idb-helpers.js';
import {
  getQuestionsForHomework, publishHomework, listLearnersForClass,
  listSubmissionsForHomework, markSubmission,
} from '../../db/teacher-schema.js';

export async function renderHomeworkDetail(ctx, { classId, homeworkId }) {
  const homework = await get(ctx.db, 'homework', homeworkId);
  if (!homework) {
    render(`<div class="state-block"><h2>Homework not found</h2></div>`);
    return;
  }
  const questions = await getQuestionsForHomework(ctx.db, homeworkId);
  const learners = await listLearnersForClass(ctx.db, classId);
  const submissions = await listSubmissionsForHomework(ctx.db, homeworkId);
  const submissionByLearner = Object.fromEntries(submissions.map((s) => [s.learnerId, s]));

  render(`
    <button class="back-link" id="btn-back">‹ ${escapeHtml('Back')}</button>
    <div class="screen-header">
      <h1>${escapeHtml(homework.title)}</h1>
      <span class="pill pill-${homework.status}">${homework.status}</span>
    </div>
    <p class="card-sub" style="margin-top:-12px;">${escapeHtml(homework.subject || '')} · ${formatDate(homework.dueDate)}</p>
    ${homework.instructions ? `<p>${escapeHtml(homework.instructions)}</p>` : ''}

    <h2 class="heading" style="font-size:var(--text-lg);">Questions (${questions.length})</h2>
    <div class="card">
      ${questions
        .map(
          (q, i) => `
        <div class="list-row">
          <div>
            <div class="card-title">${i + 1}. ${escapeHtml(q.questionText)}</div>
            <div class="card-sub">${q.questionType} · ${q.marks} mark${q.marks === 1 ? '' : 's'}</div>
          </div>
        </div>`
        )
        .join('')}
    </div>

    ${
      homework.status === 'draft'
        ? `<button class="btn btn-primary btn-block" id="btn-publish">Publish to learners</button>`
        : `
        <h2 class="heading" style="font-size:var(--text-lg);">Submissions (${submissions.filter((s) => s.status === 'submitted').length}/${learners.length})</h2>
        <div class="card">
          ${
            learners.length === 0
              ? `<div class="state-block"><p>No learners in this class yet.</p></div>`
              : learners
                  .map((l) => {
                    const sub = submissionByLearner[l.learnerId];
                    const status = !sub ? 'not started' : sub.status === 'submitted' ? 'submitted' : 'in progress';
                    return `
                <div class="list-row" data-learner="${l.learnerId}" ${sub && sub.status === 'submitted' ? 'role="button"' : ''}>
                  <div>
                    <div class="card-title">${escapeHtml(l.firstName)} ${escapeHtml(l.surname)}</div>
                    <div class="card-sub">${status}${sub?.marks != null ? ` · ${sub.marks} marks given` : ''}</div>
                  </div>
                  <span aria-hidden="true">${sub && sub.status === 'submitted' ? '›' : ''}</span>
                </div>`;
                  })
                  .join('')
          }
        </div>`
    }

    <div id="marking-panel"></div>
  `);

  document.getElementById('btn-back').addEventListener('click', () => navigate(`/classes/${classId}`));
  document.getElementById('btn-publish')?.addEventListener('click', async () => {
    try {
      await publishHomework(ctx.db, homeworkId);
      showToast('Published — learners can now see this homework.');
      renderHomeworkDetail(ctx, { classId, homeworkId });
    } catch (err) {
      showToast(err.message);
    }
  });

  document.querySelectorAll('.list-row[data-learner]').forEach((row) => {
    const sub = submissionByLearner[row.dataset.learner];
    if (!sub || sub.status !== 'submitted') return;
    row.addEventListener('click', () => renderMarkingPanel(ctx, sub, questions, classId, homeworkId));
  });
}

function renderMarkingPanel(ctx, submission, questions, classId, homeworkId) {
  const panel = document.getElementById('marking-panel');
  const answerByQ = Object.fromEntries(submission.answers.map((a) => [a.questionId, a.value]));

  panel.innerHTML = `
    <div class="card" style="margin-top:var(--space-4);">
      <h3 class="heading">Answers</h3>
      ${questions
        .map(
          (q) => `
        <div class="field">
          <label>${escapeHtml(q.questionText)}</label>
          <p style="margin:0;">${escapeHtml(answerByQ[q.questionId] ?? '(no answer)')}</p>
        </div>`
        )
        .join('')}
      <div class="field"><label for="marks-input">Marks</label>
        <input id="marks-input" type="number" min="0" value="${submission.marks ?? ''}" /></div>
      <div class="field"><label for="feedback-input">Feedback</label>
        <textarea id="feedback-input">${escapeHtml(submission.teacherFeedback ?? '')}</textarea></div>
      <button class="btn btn-primary btn-block" id="btn-save-marks">Save marks & feedback</button>
    </div>
  `;

  document.getElementById('btn-save-marks').addEventListener('click', async () => {
    const marks = Number(document.getElementById('marks-input').value) || 0;
    const teacherFeedback = document.getElementById('feedback-input').value.trim();
    await markSubmission(ctx.db, submission.submissionId, { marks, teacherFeedback });
    showToast('Saved.');
    renderHomeworkDetail(ctx, { classId, homeworkId });
  });
}
