// backend/utils/codeBackup.js
//
// Source code backup — separate from the data backup system in backup.js
// (which backs up db.json/audit-log.json/postgres_backup.sql). This zips the
// project's actual source code (frontend/ + backend/ folders) so the codebase
// itself can be restored even if the working copy or git history is lost.
//
// Excluded at any depth: node_modules, .git, backups, uploads — these are
// either regenerable (node_modules), already versioned separately (.git),
// or runtime data (backups/uploads) that doesn't belong in a *code* backup
// and would otherwise bloat the zip or recursively include prior code
// backups themselves (backend/backups/code/ is inside backend/backups/).

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const CODE_BACKUPS_DIR = path.join(__dirname, '..', 'backups', 'code');
const SOURCE_FOLDERS = ['frontend', 'backend'];
const EXCLUDED_DIR_NAMES = new Set(['node_modules', '.git', 'backups', 'uploads']);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function timestampForFilename() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
}

// Recursively adds a directory's files to the archive, skipping any
// subdirectory whose name is in EXCLUDED_DIR_NAMES at any depth (not just
// top-level), since node_modules in particular can appear nested.
function addDirToArchive(archive, absDir, archivePath) {
  const entries = fs.readdirSync(absDir, { withFileTypes: true });
  entries.forEach((entry) => {
    if (EXCLUDED_DIR_NAMES.has(entry.name)) return;
    const absPath = path.join(absDir, entry.name);
    const entryArchivePath = path.join(archivePath, entry.name);
    if (entry.isDirectory()) {
      addDirToArchive(archive, absPath, entryArchivePath);
    } else if (entry.isFile()) {
      archive.file(absPath, { name: entryArchivePath });
    }
  });
}

async function createCodeBackup() {
  ensureDir(CODE_BACKUPS_DIR);
  const filename = `sihatuna_code_backup_${timestampForFilename()}.zip`;
  const outPath = path.join(CODE_BACKUPS_DIR, filename);

  try {
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(outPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);

      SOURCE_FOLDERS.forEach((topFolder) => {
        const abs = path.join(PROJECT_ROOT, topFolder);
        if (fs.existsSync(abs)) addDirToArchive(archive, abs, topFolder);
      });

      archive.finalize();
    });
  } catch (err) {
    // Remove the partial/empty zip file so a failed attempt doesn't leave a
    // broken 0-byte entry in the backup list.
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    throw err;
  }

  console.log(`Code backup created: backend/backups/code/${filename}`);
  return filename;
}

// Lists code backup zip files, newest first, with size and creation date —
// for display in Settings' Code Backup section.
function listCodeBackups() {
  if (!fs.existsSync(CODE_BACKUPS_DIR)) return [];
  return fs.readdirSync(CODE_BACKUPS_DIR)
    .filter((name) => name.endsWith('.zip'))
    .map((name) => {
      const stat = fs.statSync(path.join(CODE_BACKUPS_DIR, name));
      return { name, sizeBytes: stat.size, createdAt: stat.birthtime };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// Resolves a code backup filename to its absolute path for download, guarding
// against path traversal the same way restoreFromBackup() does in backup.js.
function getCodeBackupPath(name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(name)) {
    throw new Error('Invalid backup file name');
  }
  const filePath = path.join(CODE_BACKUPS_DIR, name);
  if (!filePath.startsWith(CODE_BACKUPS_DIR + path.sep)) {
    throw new Error('Invalid backup file name');
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`Code backup "${name}" not found`);
  }
  return filePath;
}

module.exports = { createCodeBackup, listCodeBackups, getCodeBackupPath, CODE_BACKUPS_DIR };
