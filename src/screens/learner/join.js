import { render, showToast } from '../../lib/dom.js';
import { navigate } from '../../lib/router.js';
import { joinClass, ApiError } from '../../api/client.js';
import { saveLearnerIdentity } from '../../db/learner-schema.js';

export function renderJoin(ctx) {
  render(`
    <div class="screen-header"><h1>Join your class</h1></div>
    <p style="color:var(--muted);margin-top:-8px;">Ask your teacher for these two codes.</p>
    <form id="join-form">
      <div class="field"><label for="classCode">Class code</label>
        <input id="classCode" required autocapitalize="characters" class="code-display" placeholder="e.g. MATHS4A" /></div>
      <div class="field"><label for="learnerCode">Your code</label>
        <input id="learnerCode" required autocapitalize="characters" class="code-display" placeholder="e.g. KX7QM" /></div>
      <div id="join-error" style="display:none;color:var(--error);margin-bottom:var(--space-3);"></div>
      <button type="submit" class="btn btn-primary btn-block" id="join-submit">Join</button>
    </form>
  `);

  document.getElementById('join-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const classCode = document.getElementById('classCode').value.trim().toUpperCase();
    const learnerCode = document.getElementById('learnerCode').value.trim().toUpperCase();
    const errorBox = document.getElementById('join-error');
    const submitBtn = document.getElementById('join-submit');
    errorBox.style.display = 'none';
    submitBtn.textContent = 'Joining…';
    submitBtn.disabled = true;

    try {
      const result = await joinClass(classCode, learnerCode);
      await saveLearnerIdentity(ctx.learnerDb, {
        learnerId: result.learnerId,
        classId: result.classId,
        firstName: result.firstName,
        learnerCode,
        sessionToken: result.sessionToken,
      });
      showToast(`Welcome, ${result.firstName}!`);
      navigate('/learner/home');
    } catch (err) {
      errorBox.textContent = err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
      errorBox.style.display = 'block';
    } finally {
      submitBtn.textContent = 'Join';
      submitBtn.disabled = false;
    }
  });
}
