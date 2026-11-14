import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { basename, extname, join, resolve } from 'node:path';
import { BridgeError } from './midi.js';

const root = resolve(__dirname, '../..');
const powershell = () => join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

export type LifecycleAction = 'status' | 'stop' | 'create' | 'open' | 'save_as' | 'import_midi' | 'export_audio' | 'import_audio' | 'model_snapshot' | 'edit_event' | 'create_track' | 'unload_plugin' | 'routing' | 'automation';

export async function runLifecycle(action: LifecycleAction, args: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (process.platform !== 'win32') throw new BridgeError('WINDOWS_REQUIRED', 'The owned Cubase lifecycle requires Windows.');
    if (signal?.aborted) throw new BridgeError('LIFECYCLE_CANCELLED', 'Cancelled before lifecycle admission.');
    const id = randomBytes(16).toString('hex');
    const directory = join(root, 'artifacts', `project-create-${id}`);
    await mkdir(directory, { recursive: false });
    const requestPath = join(directory, 'operation.json');
    await writeFile(requestPath, JSON.stringify({ ...args, id, action }), { encoding: 'utf8', flag: 'wx' });
    const scratch = join(root, 'artifacts', 'scratch-temp');
    await mkdir(scratch, { recursive: true });
    return new Promise((resolveResult, reject) => {
        execFile(powershell(),
            ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts', 'Project-Runtime.ps1'), '-RequestPath', requestPath],
            { windowsHide: true, timeout: action === 'export_audio' ? Math.min(600000, Math.max(5000, Number(args.timeoutMs) || 180000)) + 60000
                : action === 'create' || action === 'open' ? 300000 : 180000,
                maxBuffer: 16 * 1024 * 1024, signal, env: { ...process.env, TEMP: scratch, TMP: scratch } },
            (error, stdout, stderr) => {
                let result: Record<string, unknown>;
                try { result = JSON.parse(stdout.trim()) as Record<string, unknown>; }
                catch { reject(new BridgeError('LIFECYCLE_RESULT_UNKNOWN', 'The lifecycle result is missing or incomplete.', 'unknown', { directory, diagnostic: stderr.slice(-2048) })); return; }
                if (error || result.ok !== true) {
                    reject(new BridgeError(typeof result.code === 'string' ? result.code : 'LIFECYCLE_FAILED',
                        typeof result.message === 'string' ? result.message : 'The lifecycle operation did not complete.',
                        result.execution === 'not_started' ? 'not_started' : 'unknown', result)); return;
                }
                // A status read changes nothing; its request record is not kept as evidence.
                if (action === 'status') void rm(directory, { recursive: true, force: true }).catch(() => undefined);
                resolveResult(result);
            });
    });
}

export interface ManagedProject { projectPath: string; directory: string; name: string; pid: number }

/** The project file that the owned host currently manages, taken from a lifecycle status result. */
export function managedProjectOf(status: Record<string, unknown>): ManagedProject {
    const managed = status.managedProject as { projectPath?: unknown } | null | undefined;
    if (status.running !== true || !managed || typeof managed.projectPath !== 'string' || !managed.projectPath) {
        throw new BridgeError('NO_MANAGED_PROJECT', 'No owned project is active. Use cubase_project_create or cubase_project_open first.');
    }
    const projectPath = resolve(managed.projectPath);
    return { projectPath, directory: resolve(projectPath, '..'), name: basename(projectPath, extname(projectPath)), pid: status.pid as number };
}

export interface OwnedWindow { title: string; className: string }

/** One read-only sample of the visible windows of the owned process on its private desktop. */
export async function readOwnedWindows(signal?: AbortSignal): Promise<{ pid: number; sampledUtc: string; windows: OwnedWindow[] }> {
    if (process.platform !== 'win32') throw new BridgeError('WINDOWS_REQUIRED', 'The owned Cubase lifecycle requires Windows.');
    return new Promise((resolveResult, reject) => {
        execFile(powershell(),
            ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts', 'Read-OwnedDesktopWindows.ps1'), '-VisibleOnly'],
            { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024, signal, encoding: 'utf8' },
            (_error, stdout) => {
                let parsed: { status?: string; error?: string; pid?: number; sampledUtc?: string; windows?: { className: string; title: string }[] };
                try { parsed = JSON.parse(String(stdout).trim()); }
                catch { reject(new BridgeError('WINDOW_INVENTORY_FAILED', 'The owned window inventory returned no result.')); return; }
                if (parsed.status !== 'observed' || !Array.isArray(parsed.windows)) {
                    reject(new BridgeError('WINDOW_INVENTORY_FAILED', parsed.error ?? 'The owned window inventory failed.')); return;
                }
                resolveResult({ pid: parsed.pid as number, sampledUtc: parsed.sampledUtc as string,
                    // The session input-indicator overlays belong to Windows, not to Cubase.
                    windows: parsed.windows.filter(item => !/^UAC/.test(item.className)).map(item => ({ title: item.title, className: item.className.replace(/[^\x20-\x7e]+$/, '') })) });
            });
    });
}
