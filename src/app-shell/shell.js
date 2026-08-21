// App shell runtime. Owns the chrome (header, bottom nav, offline banner,
// install prompt) that every screen lives inside. Does NOT own routing
// logic or screen content — those arrive in Phase 4 (teacher) / Phase 5
// (learner). Deliberately framework-free so it stays inspectable.

const NAV_CONFIG = {
  teacher: [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'classes', label: 'Classes' },
    { id: 'create', label: 'Create' },
    { id: 'submissions', label: 'Submissions' },
    { id: 'settings', label: 'Settings' },
  ],
  learner: [
    { id: 'home', label: 'Home' },
    { id: 'homework', label: 'Homework' },
    { id: 'done', label: 'Done' },
  ],
};

let deferredInstallPrompt = null;
let pendingSyncCount = 0; // wired up for real in Phase 6 (offline functionality)

export function initAppShell({ role, activeTab, onNavigate }) {
  renderHeader();
  renderSyncBanner();
  renderBottomNav(role, activeTab, onNavigate);
  wireConnectivityListeners();
  wireInstallPromptCapture();
}

function renderHeader() {
  const header = document.getElementById('app-header');
  if (!header) return;
  header.innerHTML = `
    <span class="app-title">Homework</span>
    <span class="status-pill" id="status-pill" data-state="${navigator.onLine ? 'online' : 'offline'}">
      ${navigator.onLine ? 'Online' : 'Offline — saved on this device'}
    </span>
  `;
}

function renderSyncBanner() {
  const banner = document.getElementById('sync-banner');
  if (!banner) return;
  updateSyncBanner();
}

export function updateSyncBanner() {
  const banner = document.getElementById('sync-banner');
  if (!banner) return;
  if (pendingSyncCount > 0) {
    banner.dataset.visible = 'true';
    banner.textContent = navigator.onLine
      ? `Syncing ${pendingSyncCount} item${pendingSyncCount === 1 ? '' : 's'}…`
      : `${pendingSyncCount} item${pendingSyncCount === 1 ? '' : 's'} waiting to sync when you're back online`;
  } else {
    banner.dataset.visible = 'false';
  }
}

// Called by the sync engine (Phase 6/7) whenever the queue length changes.
export function setPendingSyncCount(count) {
  pendingSyncCount = count;
  updateSyncBanner();
}

function renderBottomNav(role, activeTab, onNavigate) {
  const nav = document.getElementById('bottom-nav');
  if (!nav) return;
  const items = NAV_CONFIG[role] || [];
  nav.innerHTML = items
    .map(
      (item) => `
      <button class="nav-item" data-tab="${item.id}"
        aria-current="${item.id === activeTab ? 'page' : 'false'}">
        <span class="nav-icon" aria-hidden="true"></span>
        <span>${item.label}</span>
      </button>`
    )
    .join('');

  nav.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => onNavigate?.(btn.dataset.tab));
  });
}

function wireConnectivityListeners() {
  const update = () => {
    const pill = document.getElementById('status-pill');
    if (!pill) return;
    pill.dataset.state = navigator.onLine ? 'online' : 'offline';
    pill.textContent = navigator.onLine ? 'Online' : 'Offline — saved on this device';
    updateSyncBanner();
    if (navigator.onLine) {
      window.dispatchEvent(new CustomEvent('app:online-transition'));
    }
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
}

function wireInstallPromptCapture() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    window.dispatchEvent(new CustomEvent('app:install-available'));
  });
}

export async function promptInstall() {
  if (!deferredInstallPrompt) return { outcome: 'unavailable' };
  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  return choice; // { outcome: 'accepted' | 'dismissed' }
}

export function isInstallAvailable() {
  return deferredInstallPrompt !== null;
}
