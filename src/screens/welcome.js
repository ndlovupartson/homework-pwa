import { render } from '../lib/dom.js';
import { navigate } from '../lib/router.js';

export function renderWelcome() {
  render(`
    <div class="state-block">
      <h2>Welcome</h2>
      <p>Homework works fully offline once set up — no accounts, no internet required to use it day to day.</p>
      <div class="btn-row" style="max-width:360px;margin:var(--space-4) auto 0;">
        <button class="btn btn-primary btn-block" id="btn-teacher">I'm a Teacher</button>
        <button class="btn btn-secondary btn-block" id="btn-learner">I'm a Learner</button>
      </div>
    </div>
  `);
  document.getElementById('btn-teacher').addEventListener('click', () => navigate('/teacher/setup'));
  document.getElementById('btn-learner').addEventListener('click', () => navigate('/learner/join'));
}
