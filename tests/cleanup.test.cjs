'use strict';

// Contract of the temporary-output cleanup: only the three fixed record shapes under
// artifacts are candidates, recent or cited records survive, and the background pass uses
// the same code as the command.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { cleanupTempFiles, startTempCleanup, stopTempCleanup,
    DEFAULT_RETENTION_HOURS, DEFAULT_SCRATCH_RETENTION_HOURS } = require('../dist/src/cleanup.js');
const { loadConfig } = require('../dist/src/config.js');

const HOUR = 60 * 60 * 1000;

function workspace(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cubase-cleanup-'));
    fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return root;
}

function touch(pathname, hoursAgo) {
    const when = new Date(Date.now() - hoursAgo * HOUR);
    fs.utimesSync(pathname, when, when);
}

function write(pathname, content, hoursAgo) {
    fs.mkdirSync(path.dirname(pathname), { recursive: true });
    fs.writeFileSync(pathname, content);
    if (hoursAgo !== undefined) touch(pathname, hoursAgo);
    return pathname;
}

// Files are written first; the directory timestamp is set last so it is not moved by the writes.
function requestDirectory(root, name, hoursAgo) {
    const directory = path.join(root, 'artifacts', name);
    write(path.join(directory, 'operation.json'), '{}', hoursAgo);
    write(path.join(directory, 'result.json'), '{"ok":true}', hoursAgo);
    touch(directory, hoursAgo);
    return directory;
}

test('stale request records, scratch entries and atomic backups are removed while evidence stays', async t => {
    const root = workspace(t), artifacts = path.join(root, 'artifacts');
    const stale = requestDirectory(root, `project-create-${'a'.repeat(32)}`, 30);
    const recent = requestDirectory(root, `project-create-${'b'.repeat(32)}`, 0.5);
    const odd = requestDirectory(root, 'project-create-not-a-request', 40);
    const managed = write(path.join(artifacts, 'managed-projects', 'session-34', 'Contracts34.cpr'), 'cpr', 48);
    const receipt = write(path.join(artifacts, 'runtime', 'cubase-launch.json'), '{}', 72);
    const oldBackup = write(path.join(artifacts, 'runtime', `cubase-launch.json.before-${'c'.repeat(32)}`), 'old', 40);
    const recentBackup = write(path.join(artifacts, 'runtime', `cubase-launch.json.before-${'d'.repeat(32)}`), 'new', 0.5);
    const staleScratch = write(path.join(artifacts, 'scratch-temp', 'compiler-1.o'), 'o', 10);
    const staleScratchDirectory = path.join(artifacts, 'scratch-temp', 'tmp-1');
    write(path.join(staleScratchDirectory, 'x.tmp'), 'x', 10);
    touch(staleScratchDirectory, 10);
    const recentScratch = write(path.join(artifacts, 'scratch-temp', 'live.tmp'), 'x', 0.5);

    const result = await cleanupTempFiles({ root, now: Date.now(), keepRecentLifecycle: 0 });

    assert.equal(result.dryRun, false);
    assert.equal(result.retentionHours, DEFAULT_RETENTION_HOURS);
    assert.equal(result.scratchRetentionHours, DEFAULT_SCRATCH_RETENTION_HOURS);
    assert.equal(result.failed, 0);
    assert.equal(result.removed, 4);
    assert.ok(result.bytesFreed > 0);
    for (const removed of [stale, staleScratch, staleScratchDirectory, oldBackup]) {
        assert.equal(fs.existsSync(removed), false, removed);
    }
    for (const kept of [recent, odd, managed, receipt, recentBackup, recentScratch]) {
        assert.equal(fs.existsSync(kept), true, kept);
    }
    assert.ok(result.removals.some(item => item.kind === 'lifecycle-request' && item.path === stale));
    assert.ok(result.removals.some(item => item.kind === 'scratch' && item.path === staleScratchDirectory));
    assert.ok(result.removals.some(item => item.kind === 'atomic-backup' && item.path === oldBackup));
});

test('a request record with newer nested content is kept even when its directory looks old', async t => {
    const root = workspace(t);
    const directory = path.join(root, 'artifacts', `project-create-${'e'.repeat(32)}`);
    write(path.join(directory, 'operation.json'), '{}', 30);
    write(path.join(directory, 'late-worker.log'), 'still writing', 0.05);
    touch(directory, 30);

    const result = await cleanupTempFiles({ root, keepRecentLifecycle: 0 });

    assert.equal(fs.existsSync(directory), true);
    assert.equal(result.matched, 0);
    assert.equal(result.skipped, 1);
});

test('a dry run reports the match without deleting anything', async t => {
    const root = workspace(t);
    const directory = requestDirectory(root, `project-create-${'1'.repeat(32)}`, 30);

    const result = await cleanupTempFiles({ root, dryRun: true, keepRecentLifecycle: 0 });

    assert.equal(result.dryRun, true);
    assert.equal(result.matched, 1);
    assert.equal(result.removed, 0);
    assert.equal(result.bytesFreed, 0);
    assert.ok(result.bytesMatched > 0);
    assert.equal(fs.existsSync(directory), true);
});

test('the keep manifest and the keep option protect named records', async t => {
    const root = workspace(t), artifacts = path.join(root, 'artifacts');
    const manifestName = `project-create-${'2'.repeat(32)}`;
    const fromManifest = requestDirectory(root, manifestName, 30);
    const fromOption = requestDirectory(root, `project-create-${'3'.repeat(32)}`, 30);
    const removed = requestDirectory(root, `project-create-${'4'.repeat(32)}`, 30);
    fs.writeFileSync(path.join(artifacts, 'temp-cleanup-keep.txt'), `# cited by a document\n${manifestName}\n`);

    const result = await cleanupTempFiles({ root, keep: [fromOption], keepRecentLifecycle: 0 });

    assert.equal(result.matched, 1);
    assert.equal(result.removed, 1);
    for (const kept of [fromManifest, fromOption]) assert.equal(fs.existsSync(kept), true, kept);
    assert.equal(fs.existsSync(removed), false);
});

test('a second pass finds nothing because the first one removed every stale entry', async t => {
    const root = workspace(t);
    requestDirectory(root, `project-create-${'5'.repeat(32)}`, 30);

    const first = await cleanupTempFiles({ root, keepRecentLifecycle: 0 });
    const second = await cleanupTempFiles({ root, keepRecentLifecycle: 0 });

    assert.equal(first.removed, 1);
    assert.equal(second.matched, 0);
    assert.equal(second.removed, 0);
    assert.equal(second.failed, 0);
});

test('the background schedule removes stale output after its delay', async t => {
    const root = workspace(t);
    const directory = requestDirectory(root, `project-create-${'6'.repeat(32)}`, 30);
    startTempCleanup({ root, delayMs: 10, intervalMs: 60 * 1000, keepRecentLifecycle: 0 });
    t.after(stopTempCleanup);
    const deadline = Date.now() + 5000;
    while (fs.existsSync(directory) && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(fs.existsSync(directory), false);
});

test('the newest request records are kept even when they are older than the retention window', async t => {
    const root = workspace(t);
    const oldest = requestDirectory(root, `project-create-${'7'.repeat(32)}`, 50);
    const middle = requestDirectory(root, `project-create-${'8'.repeat(32)}`, 40);
    const newest = requestDirectory(root, `project-create-${'9'.repeat(32)}`, 30);

    const result = await cleanupTempFiles({ root, keepRecentLifecycle: 2 });

    assert.equal(result.removed, 1);
    assert.equal(fs.existsSync(oldest), false);
    for (const kept of [middle, newest]) assert.equal(fs.existsSync(kept), true, kept);
});

test('the cleanup settings default to enabled with one-hour windows', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cubase-config-'));
    try {
        const file = path.join(directory, 'cubase.config.json');
        const configuration = {
            backend: 'midi',
            policy: { backgroundOnly: true, fallback: false, automaticRetry: false },
            target: { majorVersion: 16, edition: 'AI', installationDirectory: 'C:\\Cubase', installerDirectory: 'C:\\Installer' },
            midi: { input: 'CubaseAI MCP From Cubase', output: 'CubaseAI MCP To Cubase', timeoutMs: 8000 }
        };
        fs.writeFileSync(file, JSON.stringify(configuration));
        assert.deepEqual(loadConfig(file, {}).cleanup, { enabled: true, retentionHours: 1, scratchRetentionHours: 1 });

        fs.writeFileSync(file, JSON.stringify({ ...configuration, cleanup: { enabled: false, retentionHours: 2, scratchRetentionHours: 3 } }));
        assert.deepEqual(loadConfig(file, {}).cleanup, { enabled: false, retentionHours: 2, scratchRetentionHours: 3 });

        fs.writeFileSync(file, JSON.stringify({ ...configuration, cleanup: { enabled: true, retentionHours: 0, scratchRetentionHours: 1 } }));
        assert.throws(() => loadConfig(file, {}), /retentionHours/);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
