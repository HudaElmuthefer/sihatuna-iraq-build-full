// backend/utils/gitUpdate.js
//
// Git-based differential update system (Stage 4) — lets an admin update only
// the files that changed since the last release, instead of a full reinstall,
// pulling from EITHER a local/offline git remote (a bare repo on a USB flash
// drive or a shared network folder — no internet required) OR a real GitHub
// remote when internet is available. See docs/UPDATE_WORKFLOW.md for the
// release workflow this is designed around.
//
// Design notes:
//
// 1. The git remote itself IS the source of truth for the configured update
//    source (a dedicated remote named "update-source", kept entirely separate
//    from "origin" — the developer's real GitHub remote must never be
//    touched by this feature). Configuring the source is literally
//    `git remote add/set-url update-source <path-or-url>`; reading it back is
//    `git remote get-url update-source`. No parallel copy of this value is
//    kept in system_settings, so there's no way for the two to drift apart.
//    Only metadata git doesn't track itself (last-checked time, the commit
//    recorded before the last install, for rollback) lives in system_settings
//    — see routes/gitUpdateRoutes.js.
//
// 2. Every function here takes an optional `projectRoot` parameter (defaults
//    to the real project root) instead of hardcoding it, the same way
//    codeBackup.js could — but specifically here it matters for testability:
//    the live end-to-end test for this feature runs these exact functions
//    against an isolated temporary clone, never touching the real working
//    directory's git history. Production routes call these with no second
//    argument and get the real project root.
//
// 3. Fetch + MERGE, not fetch + reset --hard. A hard reset is tempting for a
//    production deploy (deterministic, no merge commits) but it is a silent,
//    irreversible force-overwrite of anything uncommitted — exactly what
//    this feature is required NOT to do. `installUpdate()` instead runs an
//    explicit pre-flight `git status --porcelain` check and refuses up front
//    (naming the conflicting files) if the working tree isn't clean, then
//    merges. On the expected, normal production server (nobody hand-edits
//    files there — that's the whole point of this feature existing) the
//    working tree is always clean, so `git merge` fast-forwards exactly like
//    `reset --hard` would — the same end state, but it never has the chance
//    to destroy something silently in the abnormal case.
//
// 4. PM2 process restart is deliberately NOT done inside installUpdate() —
//    it's triggered by the route handler after the HTTP response is already
//    sent (see gitUpdateRoutes.js), so that restarting the very process that
//    is answering this request doesn't cut the response off. Keeping it out
//    of this module also means the live test can call installUpdate()
//    directly without ever touching the real PM2-managed dev servers.

const { execFile } = require('child_process');
const path = require('path');

const DEFAULT_PROJECT_ROOT = path.join(__dirname, '..', '..');
const REMOTE_NAME = 'update-source';

function runGit(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = (stdout || '').trim();
        err.stderr = stripTrailingNewline(stderr);
        return reject(err);
      }
      resolve({ stdout: stripTrailingNewline(stdout), stderr: stripTrailingNewline(stderr) });
    });
  });
}

// Strips only the trailing newline(s) git commands always emit — NOT a full
// trim(). This matters specifically for `git status --porcelain`, whose
// per-line format is always exactly two status characters then a literal
// leading space before the path (e.g. " M backend/package.json"); a blanket
// .trim() on the whole string eats that meaningful leading space whenever
// there's only a single status line, silently corrupting the fixed-width
// slice(3) used to parse the file path back out below.
function stripTrailingNewline(str) {
  return (str || '').replace(/\r?\n+$/, '');
}

// Translates git's raw stderr for common "can't reach it" cases into a
// message a non-technical admin can act on, instead of a raw git error dump.
function friendlyRemoteError(err) {
  const msg = ((err.stderr || '') + ' ' + (err.message || '')).toLowerCase();
  if (msg.includes('does not appear to be a git repository') || msg.includes('repository not found') || msg.includes('could not read from remote repository')) {
    return 'Update source is unreachable. If it is a USB flash drive, check that it is plugged in. If it is a network folder, check that it is accessible. If it is GitHub, check your internet connection.';
  }
  if (msg.includes('no such file or directory') || msg.includes('cannot stat') || msg.includes("doesn't exist")) {
    return 'Update source path was not found. A flash drive letter or a network path can change between insertions — reconfigure the update source with its current path.';
  }
  if (msg.includes('permission denied') || msg.includes('could not resolve host')) {
    return 'Could not reach the update source (permission denied or host unresolvable). Check the path/URL and your network connection.';
  }
  return `Could not reach the update source: ${err.stderr || err.message}`;
}

async function remoteExists(projectRoot) {
  try {
    await runGit(['remote', 'get-url', REMOTE_NAME], projectRoot);
    return true;
  } catch {
    return false;
  }
}

// Configures (or re-points) the "update-source" remote. Safe to call
// repeatedly — e.g. when a flash drive gets a new letter after being
// re-plugged, the admin just reconfigures with the new path.
async function configureUpdateSource(sourcePath, projectRoot = DEFAULT_PROJECT_ROOT) {
  if (typeof sourcePath !== 'string' || !sourcePath.trim()) {
    const err = new Error('Update source path is required.');
    err.code = 'INVALID_SOURCE';
    throw err;
  }
  const trimmed = sourcePath.trim();
  if (await remoteExists(projectRoot)) {
    await runGit(['remote', 'set-url', REMOTE_NAME, trimmed], projectRoot);
  } else {
    await runGit(['remote', 'add', REMOTE_NAME, trimmed], projectRoot);
  }
  return { remoteName: REMOTE_NAME, sourcePath: trimmed };
}

async function getUpdateSource(projectRoot = DEFAULT_PROJECT_ROOT) {
  try {
    const { stdout } = await runGit(['remote', 'get-url', REMOTE_NAME], projectRoot);
    return stdout;
  } catch {
    return null;
  }
}

async function getCurrentCommit(projectRoot = DEFAULT_PROJECT_ROOT) {
  const { stdout } = await runGit(['rev-parse', 'HEAD'], projectRoot);
  return stdout;
}

async function getCurrentBranch(projectRoot = DEFAULT_PROJECT_ROOT) {
  const { stdout } = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], projectRoot);
  return stdout;
}

// Fetches from update-source and compares the local branch to it — reports
// whether an update is available, how many commits behind, and a short
// changelog. Does not change any files.
async function checkForUpdates(projectRoot = DEFAULT_PROJECT_ROOT) {
  const source = await getUpdateSource(projectRoot);
  if (!source) {
    const err = new Error('No update source configured yet. Configure one first.');
    err.code = 'NO_SOURCE';
    throw err;
  }

  const branch = await getCurrentBranch(projectRoot);
  try {
    await runGit(['fetch', REMOTE_NAME, branch], projectRoot);
  } catch (err) {
    const friendly = new Error(friendlyRemoteError(err));
    friendly.code = 'UNREACHABLE';
    throw friendly;
  }

  const localCommit = await getCurrentCommit(projectRoot);
  const remoteRef = `${REMOTE_NAME}/${branch}`;
  const { stdout: remoteCommit } = await runGit(['rev-parse', remoteRef], projectRoot);

  if (localCommit === remoteCommit) {
    return { updateAvailable: false, commitsBehind: 0, commitsAhead: 0, changelog: [], localCommit, remoteCommit, branch, source };
  }

  const { stdout: behindStr } = await runGit(['rev-list', '--count', `${localCommit}..${remoteCommit}`], projectRoot);
  const { stdout: aheadStr } = await runGit(['rev-list', '--count', `${remoteCommit}..${localCommit}`], projectRoot);
  const { stdout: logStr } = await runGit(['log', '--pretty=format:%h %s', `${localCommit}..${remoteCommit}`], projectRoot);

  return {
    updateAvailable: parseInt(behindStr, 10) > 0,
    commitsBehind: parseInt(behindStr, 10) || 0,
    commitsAhead: parseInt(aheadStr, 10) || 0,
    changelog: logStr ? logStr.split('\n') : [],
    localCommit, remoteCommit, branch, source,
  };
}

function runNpmInstall(cwd) {
  return new Promise((resolve) => {
    execFile('npm', ['install'], { cwd, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, error: err ? (stderr || err.message) : null });
    });
  });
}

// Pulls only the changed files from update-source (fetch + merge — see the
// module comment above for why not reset --hard), after taking a full source
// code backup as a rollback point. Refuses up front if the working tree has
// uncommitted changes that would conflict, naming the files rather than
// forcing through silently.
async function installUpdate(projectRoot = DEFAULT_PROJECT_ROOT) {
  const { createCodeBackup } = require('./codeBackup'); // required lazily to avoid a require cycle risk if codeBackup ever needs this module

  const source = await getUpdateSource(projectRoot);
  if (!source) {
    const err = new Error('No update source configured yet. Configure one first.');
    err.code = 'NO_SOURCE';
    throw err;
  }

  // Pre-flight: refuse if the working tree isn't clean, naming the files —
  // this is the actual safety check (see module comment #3), not just a
  // hopeful merge attempt.
  const { stdout: statusOut } = await runGit(['status', '--porcelain'], projectRoot);
  if (statusOut) {
    const files = statusOut.split('\n').map((line) => line.slice(3).trim());
    // The file list is embedded directly in the message (not just a separate
    // `files` field) because the frontend's shared api.js error handling only
    // ever surfaces `err.message` from a failed request — see api.js's
    // apiRequest(), which deliberately keeps its error shape narrow. Baking
    // the list into the message itself means the toast the admin sees is
    // already complete, with no special-case handling needed on the frontend.
    const err = new Error(`Local changes would conflict with the update — commit, stash, or discard them first: ${files.join(', ')}`);
    err.code = 'DIRTY_TREE';
    err.files = files;
    throw err;
  }

  const branch = await getCurrentBranch(projectRoot);
  const beforeCommit = await getCurrentCommit(projectRoot);

  try {
    await runGit(['fetch', REMOTE_NAME, branch], projectRoot);
  } catch (err) {
    const friendly = new Error(friendlyRemoteError(err));
    friendly.code = 'UNREACHABLE';
    throw friendly;
  }

  const remoteRef = `${REMOTE_NAME}/${branch}`;
  const { stdout: remoteCommit } = await runGit(['rev-parse', remoteRef], projectRoot);

  if (beforeCommit === remoteCommit) {
    return { alreadyUpToDate: true, beforeCommit, afterCommit: beforeCommit, filesChanged: [], backupFilename: null, npmInstallRan: { backend: false, frontend: false } };
  }

  // Backup BEFORE touching any files — this is the rollback point.
  const backupFilename = await createCodeBackup();

  const { stdout: filesChangedStr } = await runGit(['diff', '--name-only', beforeCommit, remoteCommit], projectRoot);
  const filesChanged = filesChangedStr ? filesChangedStr.split('\n') : [];

  try {
    await runGit(['merge', remoteRef, '--no-edit'], projectRoot);
  } catch (err) {
    // Leave the repo in a clean, known state rather than half-merged.
    await runGit(['merge', '--abort'], projectRoot).catch(() => {});
    const friendly = new Error(`Merge failed and was rolled back automatically: ${err.stderr || err.message}`);
    friendly.code = 'MERGE_FAILED';
    throw friendly;
  }

  const afterCommit = await getCurrentCommit(projectRoot);

  // Only run npm install for the side(s) whose package.json actually
  // changed — not on every update, per the requirement.
  const backendPkgChanged = filesChanged.includes('backend/package.json') || filesChanged.includes('backend/package-lock.json');
  const frontendPkgChanged = filesChanged.includes('frontend/package.json') || filesChanged.includes('frontend/package-lock.json');
  const npmInstallRan = { backend: backendPkgChanged, frontend: frontendPkgChanged };
  if (backendPkgChanged) {
    const result = await runNpmInstall(path.join(projectRoot, 'backend'));
    if (!result.ok) console.error('⚠️  npm install failed for backend after update:', result.error);
  }
  if (frontendPkgChanged) {
    const result = await runNpmInstall(path.join(projectRoot, 'frontend'));
    if (!result.ok) console.error('⚠️  npm install failed for frontend after update:', result.error);
  }

  return { alreadyUpToDate: false, beforeCommit, afterCommit, filesChanged, backupFilename, npmInstallRan };
}

// Rolls back to a specific commit (the commit recorded before the last
// install — see routes/gitUpdateRoutes.js, which persists it in
// system_settings so it survives the restart the install itself triggers).
// This is a git-native undo of the update, not a re-extraction of the zip
// backup — a `reset --hard` to a known-good commit correctly handles files
// that were added or removed by the bad update, which a naive zip overwrite
// would not. The zip backup created before install remains available for
// manual/disaster recovery via the existing Code Backup UI regardless.
async function rollbackToCommit(commitHash, projectRoot = DEFAULT_PROJECT_ROOT) {
  if (typeof commitHash !== 'string' || !/^[0-9a-f]{7,40}$/i.test(commitHash)) {
    const err = new Error('Invalid commit hash.');
    err.code = 'INVALID_COMMIT';
    throw err;
  }
  try {
    await runGit(['cat-file', '-e', commitHash], projectRoot);
  } catch {
    const err = new Error(`Commit ${commitHash} was not found in this repository.`);
    err.code = 'COMMIT_NOT_FOUND';
    throw err;
  }

  const beforeRollbackCommit = await getCurrentCommit(projectRoot);
  const { stdout: filesChangedStr } = await runGit(['diff', '--name-only', commitHash, beforeRollbackCommit], projectRoot);
  const filesChanged = filesChangedStr ? filesChangedStr.split('\n') : [];

  await runGit(['reset', '--hard', commitHash], projectRoot);

  const backendPkgChanged = filesChanged.includes('backend/package.json') || filesChanged.includes('backend/package-lock.json');
  const frontendPkgChanged = filesChanged.includes('frontend/package.json') || filesChanged.includes('frontend/package-lock.json');
  const npmInstallRan = { backend: backendPkgChanged, frontend: frontendPkgChanged };
  if (backendPkgChanged) {
    const result = await runNpmInstall(path.join(projectRoot, 'backend'));
    if (!result.ok) console.error('⚠️  npm install failed for backend after rollback:', result.error);
  }
  if (frontendPkgChanged) {
    const result = await runNpmInstall(path.join(projectRoot, 'frontend'));
    if (!result.ok) console.error('⚠️  npm install failed for frontend after rollback:', result.error);
  }

  return { rolledBackTo: commitHash, previousCommit: beforeRollbackCommit, filesChanged, npmInstallRan };
}

module.exports = {
  REMOTE_NAME,
  DEFAULT_PROJECT_ROOT,
  configureUpdateSource,
  getUpdateSource,
  getCurrentCommit,
  getCurrentBranch,
  checkForUpdates,
  installUpdate,
  rollbackToCommit,
};
