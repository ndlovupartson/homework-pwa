import { render, escapeHtml, showToast } from '../../lib/dom.js';
import { getTeacher, listClasses } from '../../db/teacher-schema.js';
import { exportBackup, downloadBackupFile, importBackup } from '../../lib/backup.js';

export async function renderSettings(ctx) {
  const teacher = await getTeacher(ctx.db);
  const archived = await listClasses(ctx.db, { includeArchived: true });
  const archivedCount = archived.filter((c) => c.status === 'archived').length;

  render(`
    <div class="screen-header"><h1>Settings</h1></div>
    <div class="card">
      <div class="card-title">${escapeHtml(teacher?.teacherName ?? '')}</div>
      <div class="card-sub">${escapeHtml(teacher?.schoolName || 'No school set')}</div>
    </div>

    <div class="card">
      <div class="card-title">Backup & restore</div>
      <div class="card-sub">Save a copy of everything on this device — classes, learners, homework, and submissions — as a file you control. Also re-queues anything that never made it to the cloud sync.</div>
      <button class="btn btn-primary btn-block" id="btn-export" style="margin-top:var(--space-3);">Export backup</button>

      <div style="margin-top:var(--space-4);border-top:1px solid var(--border);padding-top:var(--space-3);">
        <div class="card-sub" style="margin-bottom:var(--space-2);">Restore from a backup file. This adds to what's already on this device — it won't remove anything.</div>
        <input type="file" id="import-file" accept="application/json" style="display:none;" />
        <button class="btn btn-secondary btn-block" id="btn-import">Choose backup file to restore</button>
        <div id="import-status" style="margin-top:var(--space-2);font-size:var(--text-sm);"></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Archived classes</div>
      <div class="card-sub">${archivedCount} archived. Un-archiving isn't built yet — flagging honestly rather than adding a button that doesn't work.</div>
    </div>
  `);

  document.getElementById('btn-export').addEventListener('click', async () => {
    try {
      const json = await exportBackup(ctx.db);
      downloadBackupFile(json);
      showToast('Backup downloaded.');
    } catch (err) {
      showToast(err.message);
    }
  });

  const fileInput = document.getElementById('import-file');
  const statusBox = document.getElementById('import-status');
  document.getElementById('btn-import').addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (!confirm('Restore this backup onto this device? Existing data will be kept; the backup will be added on top.')) {
      fileInput.value = '';
      return;
    }
    statusBox.textContent = 'Restoring…';
    try {
      const text = await file.text();
      const counts = await importBackup(ctx.db, text);
      statusBox.textContent = '';
      showToast(
        `Restored: ${counts.classes} classes, ${counts.learners} learners, ${counts.homework} homework, ${counts.submissions} submissions.`
      );
      await renderSettings(ctx);
    } catch (err) {
      statusBox.textContent = err.message;
    } finally {
      fileInput.value = '';
    }
  });
}
