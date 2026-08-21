import { render, showToast } from '../../lib/dom.js';
import { navigate } from '../../lib/router.js';
import { createTeacher } from '../../db/teacher-schema.js';

export function renderTeacherSetup(ctx) {
  render(`
    <div class="screen-header"><h1>Set up your account</h1></div>
    <p style="color:var(--muted);margin-top:-8px;">Stored only on this device — no email or password needed.</p>
    <form id="setup-form">
      <div class="field">
        <label for="teacherName">Your name</label>
        <input id="teacherName" required autocomplete="name" placeholder="e.g. Ms. Adeyemi" />
      </div>
      <div class="field">
        <label for="schoolName">School name (optional)</label>
        <input id="schoolName" placeholder="e.g. Riverside Primary" />
      </div>
      <button type="submit" class="btn btn-primary btn-block">Continue</button>
    </form>
  `);

  document.getElementById('setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const teacherName = document.getElementById('teacherName').value.trim();
    const schoolName = document.getElementById('schoolName').value.trim();
    if (!teacherName) return;
    await createTeacher(ctx.db, { teacherName, schoolName });
    showToast('Welcome! Your account is set up.');
    navigate('/dashboard');
  });
}
