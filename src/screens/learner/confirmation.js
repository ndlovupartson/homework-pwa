import { render, escapeHtml } from '../../lib/dom.js';
import { navigate } from '../../lib/router.js';
import { getHomework, getQuestionsForHomework, getOrCreateSubmission } from '../../db/learner-schema.js';

export async function renderConfirmation(ctx, { homeworkId }) {
  const homework = await getHomework(ctx.learnerDb, homeworkId);
  const questions = await getQuestionsForHomework(ctx.learnerDb, homeworkId);
  const submission = await getOrCreateSubmission(ctx.learnerDb, homeworkId);
  const answeredCount = (submission.answers || []).filter((a) => a.value?.trim()).length;

  render(`
    <div class="state-block">
      <h2>Submitted!</h2>
      <p>${escapeHtml(homework?.title ?? '')}</p>
      <div class="card" style="text-align:left;max-width:320px;margin:var(--space-4) auto;">
        <div class="list-row"><span>Answered</span><strong>${answeredCount} / ${questions.length}</strong></div>
        <div class="list-row"><span>Submitted at</span><strong>${new Date(submission.submittedAt).toLocaleTimeString()}</strong></div>
        <div class="list-row"><span>Status</span><span class="pill pill-published">Submitted</span></div>
      </div>
      <button class="btn btn-primary" id="btn-home">Back to my homework</button>
    </div>
  `);

  document.getElementById('btn-home').addEventListener('click', () => navigate('/learner/home'));
}
