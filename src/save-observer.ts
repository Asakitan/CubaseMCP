import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, extname, isAbsolute, resolve } from 'node:path';
import { BridgeError } from './midi.js';

const MAX_PROJECT_BYTES = 64 * 1024 * 1024;
const SAMPLE_MS = 200;
const STABLE_MS = 400;

interface FileState {
    size: number;
    mtimeMs: number;
    ctimeMs: number;
}

interface Snapshot extends FileState { bytes: Buffer }

function sameState(left: FileState, right: FileState): boolean {
    return left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

async function metadata(path: string): Promise<FileState> {
    const value = await lstat(path);
    if (!value.isFile() || value.isSymbolicLink() || value.size > MAX_PROJECT_BYTES)
        throw new BridgeError('PROJECT_FILE_INVALID', 'Expected an existing regular CPR file between 12 bytes and 64 MiB.');
    if (value.size < 12) throw new BridgeError('PROJECT_FILE_INCOMPLETE', 'The CPR file is shorter than its minimum envelope.');
    return { size: value.size, mtimeMs: value.mtimeMs, ctimeMs: value.ctimeMs };
}

async function snapshot(path: string): Promise<Snapshot | null> {
    const before = await metadata(path);
    const bytes = await readFile(path);
    const after = await metadata(path);
    return sameState(before, after) && bytes.length === after.size ? { ...after, bytes } : null;
}

async function admitPath(path: string): Promise<string> {
    if (!isAbsolute(path) || extname(path).toLowerCase() !== '.cpr' || path.includes('\0'))
        throw new BridgeError('PROJECT_PATH_INVALID', 'An absolute existing .cpr path is required.');
    const absolute = resolve(path);
    for (let part = absolute; ; part = dirname(part)) {
        if ((await lstat(part)).isSymbolicLink())
            throw new BridgeError('PROJECT_PATH_LINK', 'Symbolic links and junctions are not admitted.');
        if (dirname(part) === part) break;
    }
    const canonical = await realpath(absolute);
    const comparable = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
    if (comparable(canonical) !== comparable(absolute))
        throw new BridgeError('PROJECT_PATH_CHANGED', 'The project path resolves to another location.');
    return absolute;
}

/** File observation only. The supplied path is not an active-document identity API. */
export async function saveProjectObserved(
    projectPath: string,
    observationTimeoutMs: number,
    save: () => Promise<unknown>,
    signal?: AbortSignal
): Promise<unknown> {
    let path: string, before: Snapshot;
    try {
        if (signal?.aborted) throw new BridgeError('PROJECT_SAVE_CANCELLED', 'Cancelled before Save.');
        path = await admitPath(projectPath);
        const captured = await snapshot(path);
        if (!captured) throw new BridgeError('PROJECT_FILE_BUSY', 'The project file changed during preflight.');
        before = captured;
        if (signal?.aborted) throw new BridgeError('PROJECT_SAVE_CANCELLED', 'Cancelled before Save.');
    } catch (error) {
        if (error instanceof BridgeError) throw error;
        throw new BridgeError('PROJECT_FILE_PREFLIGHT', error instanceof Error ? error.message : String(error));
    }

    // There is exactly one mutation call. Later sampling never resends Save.
    const receipt = await save();
    const deadline = Date.now() + observationTimeoutMs;
    let candidate: Snapshot | null = null, candidateAt = 0;
    const publicState = (value: FileState) => ({ size: value.size, mtimeMs: value.mtimeMs, ctimeMs: value.ctimeMs });
    const result = (state: string, after?: Snapshot) => ({
        save: receipt,
        file: { path, pathSource: 'caller_asserted_current_project', state, before: publicState(before),
            after: after ? publicState(after) : null, contentChanged: state === 'changed_stable',
            stableWindowMs: state === 'changed_stable' ? Date.now() - candidateAt : 0 },
        semanticReopenVerified: false,
        limitations: 'The path is caller-asserted. Stable changed bytes are an observation, not an atomic active-document identity, durable-flush callback or semantic reopen.'
    });
    try {
        while (Date.now() < deadline) {
            if (signal?.aborted) throw new BridgeError('PROJECT_SAVE_OBSERVATION_CANCELLED', 'Save was submitted; file observation was cancelled.', 'unknown');
            try {
                const state = await metadata(path);
                if (!sameState(state, before)) {
                    const current = await snapshot(path);
                    if (current && !current.bytes.equals(before.bytes)) {
                        if (candidate && sameState(candidate, current) && candidate.bytes.equals(current.bytes)) {
                            if (Date.now() - candidateAt >= STABLE_MS) return result('changed_stable', current);
                        } else { candidate = current; candidateAt = Date.now(); }
                    } else { candidate = null; candidateAt = 0; }
                } else { candidate = null; candidateAt = 0; }
            } catch (error) {
                // A host replacement can briefly remove the path; this is read-only sampling.
                if (!(error && typeof error === 'object' && 'code' in error &&
                    (error.code === 'ENOENT' || error.code === 'PROJECT_FILE_INCOMPLETE'))) throw error;
                candidate = null; candidateAt = 0;
            }
            await new Promise(resolve => setTimeout(resolve, Math.min(SAMPLE_MS, Math.max(0, deadline - Date.now()))));
        }
        return result('change_not_observed');
    } catch (error) {
        throw new BridgeError(error instanceof BridgeError ? error.code : 'PROJECT_SAVE_OBSERVATION_FAILED',
            error instanceof Error ? error.message : String(error), 'unknown', { save: receipt, projectPath: path });
    }
}
