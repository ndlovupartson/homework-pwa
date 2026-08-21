export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function render(html) {
  const content = document.getElementById('app-content');
  content.innerHTML = html;
  content.scrollTop = 0;
}

export function showToast(message) {
  const existing = document.getElementById('toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.id = 'toast';
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

export function formatDate(iso) {
  if (!iso) return 'No due date';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
