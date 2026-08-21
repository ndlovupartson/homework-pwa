import { render, escapeHtml, formatDate, showToast } from '../../lib/dom.js';
import { navigate } from '../../lib/router.js';
import {
  getHomework, getQuestionsForHomework, getOrCreateSubmission, saveProgress, submitHomework,
} from '../../db/learner-schema.js';

export async function renderLearnerHomework(ctx, { homeworkId }) {
  const homework = await getHomework(ctx.learnerDb, homeworkId);
  if (!homework) {
    render(`<div class="state-block"><h2>Homework not found</h2></div>`);
    return;
  }
  const questions = await getQuestionsForHomework(ctx.learnerDb, homeworkId);
  const submission = await getOrCreateSubmission(ctx.learnerDb, homeworkId);
  const answerByQ = Object.fromEntries((submission.answers || []).map((a) => [a.questionId, a.value]));

  const readOnly = submission.status === 'submitted';

  render(`
    <button class="back-link" id="btn-back">‹ Back</button>
    <div class="screen-header"><h1>${escapeHtml(homework.title)}</h1></div>
    <p class="card-sub" style="margin-top:-12px;">${escapeHtml(homework.subject || '')} · due ${formatDate(homework.dueDate)}</p>
    ${homework.instructions ? `<p>${escapeHtml(homework.instructions)}</p>` : ''}

    ${
      readOnly
        ? `<div class="card" style="background:var(--success-bg);border-color:var(--success);">
            <div class="card-title">Submitted</div>
            <div class="card-sub">${new Date(submission.submittedAt).toLocaleString()}</div>
            ${submission.marks != null ? `<p style="margin-bottom:0;"><strong>${submission.marks} marks.</strong> ${escapeHtml(submission.teacherFeedback || '')}</p>` : `<p style="margin-bottom:0;">Not marked yet.</p>`}
          </div>`
        : ''
    }

    <form id="answer-form">
      ${questions
        .map((q, i) => {
          const value = answerByQ[q.questionId] ?? '';
          let input;
          if (q.questionType === 'mcq') {
            input = (q.options || [])
              .map(
                (opt) => `
              <label style="display:flex;align-items:center;gap:8px;min-height:var(--tap-min);">
                <input type="radio" name="q-${q.questionId}" value="${escapeHtml(opt)}" ${value === opt ? 'checked' : ''} ${readOnly ? 'disabled' : ''} />
                ${escapeHtml(opt)}
              </label>`
              )
              .join('');
          } else if (q.questionType === 'truefalse') {
            input = ['True', 'False']
              .map(
                (opt) => `
              <label style="display:flex;align-items:center;gap:8px;min-height:var(--tap-min);">
                <input type="radio" name="q-${q.questionId}" value="${opt}" ${value === opt ? 'checked' : ''} ${readOnly ? 'disabled' : ''} />
                ${opt}
              </label>`
              )
              .join('');
          } else if (q.questionType === 'long') {
            input = `<textarea data-qid="${q.questionId}" ${readOnly ? 'disabled' : ''}>${escapeHtml(value)}</textarea>`;
          } else {
            input = `<input data-qid="${q.questionId}" value="${escapeHtml(value)}" ${readOnly ? 'disabled' : ''} />`;
          }
          return `
          <div class="field">
            <label>${i + 1}. ${escapeHtml(q.questionText)} <span class="card-sub">(${q.marks} mark${q.marks === 1 ? '' : 's'})</span></label>
            ${input}
          </div>`;
        })
        .join('')}
      ${
        readOnly
          ? ''
          : `<div class="btn-row">
              <button type="button" class="btn btn-secondary" id="btn-save">Save progress</button>
              <button type="button" class="btn btn-primary" id="btn-submit">Submit</button>
            </div>`
      }
    </form>
  `);

  document.getElementById('btn-back').addEventListener('click', () => navigate('/learner/home'));

  function collectAnswers() {
    return questions.map((q) => {
      let value = '';
      if (q.questionType === 'mcq' || q.questionType === 'truefalse') {
        const checked = document.querySelector(`input[name="q-${q.questionId}"]:checked`);
        value = checked ? checked.value : '';
      } else {
        value = document.querySelector(`[data-qid="${q.questionId}"]`)?.value ?? '';
      }
      return { questionId: q.questionId, value };
    });
  }

  document.getElementById('btn-save')?.addEventListener('click', async () => {
    await saveProgress(ctx.learnerDb, homeworkId, collectAnswers());
    showToast('Progress saved.');
  });

  document.getElementById('btn-submit')?.addEventListener('click', async () => {
    const answers = collectAnswers();
    const answeredCount = answers.filter((a) => a.value.trim() !== '').length;
    const unansweredCount = answers.length - answeredCount;
    if (unansweredCount > 0) {
      const proceed = confirm(`You have ${unansweredCount} unanswered question${unansweredCount === 1 ? '' : 's'}. Submit anyway?`);
      if (!proceed) return;
    }
    await submitHomework(ctx.learnerDb, homeworkId, answers);
    navigate(`/learner/homework/${homeworkId}/confirmation`);
  });
}
