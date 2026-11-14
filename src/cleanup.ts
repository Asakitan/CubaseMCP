import { lstat, readFile, readdir, rm } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';

const workspaceRoot = resolve(__dirname, '../..');
const HOUR_MS = 60 * 60 * 1000;

export const DEFAULT_RETENTION_HOURS = 1;
export const DEFAULT_SCRATCH_RETENTION_HOURS = 1;
export const DEFAULT_KEEP_RECENT_LIFECYCLE = 0;
export const CLEANUP_INTERVAL_MS = HOUR_MS;

// The first pass waits for the transport to settle; later passes are one hour apart.
const STARTUP_DELAY_MS = 30 * 1000;
const MAX_WALK_ENTRIES = 20000;
const MAX_ERRORS = 50;
// Only the two fixed request-record shapes this workspace writes are candidates.
const PROJECT_REQUEST = /^project-create-[0-9a-f]{32}$/;
const ATOMIC_LEFTOVER = /\.(?:before|tmp)-[0-9a-f]{32}$/;

export type TempCleanupKind = 'lifecycle-request' | 'scratch' | 'atomic-backup';

export interface TempCleanupSettings {
    enabled: boolean;
    retentionHours: number;
    scratchRetentionHours: number;
}

export interface TempCleanupOptions {
    root?: string;
    now?: number;
    retentionMs?: number;
    scratchRetentionMs?: number;
    keepRecentLifecycle?: number;
    keep?: string[];
    keepFile?: string;
    dryRun?: boolean;
}

export interface TempCleanupRemoval {
    path: string;
    kind: TempCleanupKind;
    ageHours: number;
    bytes: number;
}

export interface TempCleanupResult {
    root: string;
    artifacts: string;
    dryRun: boolean;
    retentionHours: number;
    scratchRetentionHours: number;
    scanned: number;
    matched: number;
    removed: number;
    failed: number;
    skipped: number;
    bytesMatched: number;
    bytesFreed: number;
    removals: TempCleanupRemoval[];
    errors: { path: string; message: string }[];
}

interface WalkResult { newestMs: number; bytes: number }

function comparable(path: string): string {
    return process.platform === 'win32' ? path.toLowerCase() : path;
}

/** True when `candidate` is strictly inside `directory`; the directory itself never matches. */
function inside(directory: string, candidate: string): boolean {
    const prefix = directory.endsWith(sep) ? directory : directory + sep;
    const left = comparable(candidate), right = comparable(prefix);
    return left.length > right.length && left.startsWith(right);
}

/** Newest modification time and total bytes, refusing reparse points and unbounded trees. */
async function walk(path: string, budget: { entries: number }): Promise<WalkResult> {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error('reparse point');
    budget.entries += 1;
    if (budget.entries > MAX_WALK_ENTRIES) throw new Error(`more than ${MAX_WALK_ENTRIES} entries`);
    if (!info.isDirectory()) return { newestMs: info.mtimeMs, bytes: info.size };
    let newestMs = info.mtimeMs, bytes = 0;
    for (const name of await readdir(path)) {
        const child = await walk(join(path, name), budget);
        if (child.newestMs > newestMs) newestMs = child.newestMs;
        bytes += child.bytes;
    }
    return { newestMs, bytes };
}

/** One name or absolute path per line; a missing manifest simply contributes nothing. */
async function readKeepFile(path: string, artifacts: string): Promise<string[]> {
    let text: string;
    try { text = await readFile(path, 'utf8'); } catch { return []; }
    const kept: string[] = [];
    for (const line of text.split(/\r?\n/)) {
        const value = line.trim();
        if (!value || value.startsWith('#')) continue;
        kept.push(isAbsolute(value) ? resolve(value) : resolve(artifacts, value));
    }
    return kept;
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Remove stale temporary output under `<root>/artifacts`:
 * lifecycle request records, child-process TEMP/TMP entries and atomic-write backups.
 * Managed projects, IPC evidence, current runtime receipts and active request records are not candidates.
 */
export async function cleanupTempFiles(options: TempCleanupOptions = {}): Promise<TempCleanupResult> {
    const root = resolve(options.root ?? workspaceRoot);
    const artifacts = resolve(root, 'artifacts');
    const now = options.now ?? Date.now();
    const retentionMs = options.retentionMs ?? DEFAULT_RETENTION_HOURS * HOUR_MS;
    const scratchRetentionMs = options.scratchRetentionMs ?? DEFAULT_SCRATCH_RETENTION_HOURS * HOUR_MS;
    const keepRecent = Math.max(0, options.keepRecentLifecycle ?? DEFAULT_KEEP_RECENT_LIFECYCLE);
    const dryRun = options.dryRun === true;
    const result: TempCleanupResult = {
        root, artifacts, dryRun,
        retentionHours: Math.round((retentionMs / HOUR_MS) * 100) / 100,
        scratchRetentionHours: Math.round((scratchRetentionMs / HOUR_MS) * 100) / 100,
        scanned: 0, matched: 0, removed: 0, failed: 0, skipped: 0,
        bytesMatched: 0, bytesFreed: 0, removals: [], errors: []
    };
    const keep = new Set([...(options.keep ?? []).map(item => resolve(item)),
        ...await readKeepFile(options.keepFile ?? join(artifacts, 'temp-cleanup-keep.txt'), artifacts)].map(comparable));

    const consider = async (path: string, kind: TempCleanupKind, cutoffMs: number): Promise<void> => {
        result.scanned += 1;
        const absolute = resolve(path);
        if (!inside(artifacts, absolute) || keep.has(comparable(absolute))) { result.skipped += 1; return; }
        let info;
        try { info = await lstat(absolute); } catch { result.skipped += 1; return; }
        if (info.isSymbolicLink() || now - info.mtimeMs < cutoffMs) { result.skipped += 1; return; }
        let measured: WalkResult;
        try { measured = await walk(absolute, { entries: 0 }); } catch { result.skipped += 1; return; }
        if (now - measured.newestMs < cutoffMs) { result.skipped += 1; return; }
        const ageHours = Math.round((now - measured.newestMs) / (HOUR_MS / 10)) / 10;
        result.matched += 1;
        result.bytesMatched += measured.bytes;
        result.removals.push({ path: absolute, kind, ageHours, bytes: measured.bytes });
        if (dryRun) return;
        try {
            // Unlink the pinned native DLL first when present so a live Cubase process fails before
            // recursive deletion removes operation.json, create-result.json or operation-error.json.
            if (kind === 'lifecycle-request') {
                const dllPath = join(absolute, 'CubaseProjectCreate.dll');
                try { await rm(dllPath, { force: false }); }
                catch (dllError) {
                    if ((dllError as NodeJS.ErrnoException)?.code !== 'ENOENT') throw dllError;
                }
            }
            await rm(absolute, { recursive: true, force: false, maxRetries: 2, retryDelay: 100 });
        }
        catch (error) {
            result.failed += 1;
            if (result.errors.length < MAX_ERRORS) result.errors.push({ path: absolute, message: describe(error) });
            return;
        }
        result.removed += 1;
        result.bytesFreed += measured.bytes;
    };

    const entries = await readdir(artifacts, { withFileTypes: true }).catch(() => []);
    const requests: { path: string; mtimeMs: number }[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || !PROJECT_REQUEST.test(entry.name)) continue;
        const path = join(artifacts, entry.name);
        try {
            const info = await lstat(path);
            if (!info.isSymbolicLink()) requests.push({ path, mtimeMs: info.mtimeMs });
        } catch { /* removed between readdir and lstat */ }
    }
    // An explicit keepRecentLifecycle window can keep the newest records past the cutoff; the default is 0.
    requests.sort((left, right) => right.mtimeMs - left.mtimeMs);
    for (let index = keepRecent; index < requests.length; index += 1) {
        await consider(requests[index].path, 'lifecycle-request', retentionMs);
    }

    const scratch = join(artifacts, 'scratch-temp');
    for (const entry of await readdir(scratch, { withFileTypes: true }).catch(() => [])) {
        await consider(join(scratch, entry.name), 'scratch', scratchRetentionMs);
    }

    const runtime = join(artifacts, 'runtime');
    for (const entry of await readdir(runtime, { withFileTypes: true }).catch(() => [])) {
        if (ATOMIC_LEFTOVER.test(entry.name)) await consider(join(runtime, entry.name), 'atomic-backup', retentionMs);
    }

    return result;
}

export interface TempCleanupSchedule extends Partial<TempCleanupSettings> {
    root?: string;
    delayMs?: number;
    intervalMs?: number;
    keep?: string[];
    keepFile?: string;
    keepRecentLifecycle?: number;
}

let startTimer: NodeJS.Timeout | undefined;
let repeatTimer: NodeJS.Timeout | undefined;
let running = false;

/**
 * Start the background pass that keeps temporary output bounded. It never throws into the
 * MCP process: failures are retried by the next pass and are reported by the CLI instead.
 */
export function startTempCleanup(schedule: TempCleanupSchedule = {}): void {
    const { root, delayMs = STARTUP_DELAY_MS, intervalMs = CLEANUP_INTERVAL_MS, ...settings } = schedule;
    if (settings.enabled === false || startTimer || repeatTimer) return;
    const retentionMs = (settings.retentionHours ?? DEFAULT_RETENTION_HOURS) * HOUR_MS;
    const scratchRetentionMs = (settings.scratchRetentionHours ?? DEFAULT_SCRATCH_RETENTION_HOURS) * HOUR_MS;
    const run = (): void => {
        if (running) return;
        running = true;
        void cleanupTempFiles({ root, retentionMs, scratchRetentionMs, keep: settings.keep,
            keepFile: settings.keepFile, keepRecentLifecycle: settings.keepRecentLifecycle })
            .catch(() => undefined)
            .finally(() => { running = false; });
    };
    startTimer = setTimeout(run, delayMs);
    startTimer.unref();
    repeatTimer = setInterval(run, intervalMs);
    repeatTimer.unref();
}

/** Stop the background pass; used by tests and by an explicit shutdown of the owning process. */
export function stopTempCleanup(): void {
    if (startTimer) clearTimeout(startTimer);
    if (repeatTimer) clearInterval(repeatTimer);
    startTimer = undefined;
    repeatTimer = undefined;
}
