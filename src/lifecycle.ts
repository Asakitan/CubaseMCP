import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { BridgeError } from './midi.js';

const root = resolve(__dirname, '../..');

export async function runLifecycle(action: 'status' | 'stop' | 'create' | 'open' | 'save_as', args: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
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
        execFile(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
            ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts', 'Project-Runtime.ps1'), '-RequestPath', requestPath],
            { windowsHide: true, timeout: 180000, maxBuffer: 1024 * 1024, signal, env: { ...process.env, TEMP: scratch, TMP: scratch } },
            (error, stdout, stderr) => {
                let result: Record<string, unknown>;
                try { result = JSON.parse(stdout.trim()) as Record<string, unknown>; }
                catch { reject(new BridgeError('LIFECYCLE_RESULT_UNKNOWN', 'The lifecycle result is missing or incomplete.', 'unknown', { directory, diagnostic: stderr.slice(-2048) })); return; }
                if (error || result.ok !== true) {
                    reject(new BridgeError(typeof result.code === 'string' ? result.code : 'LIFECYCLE_FAILED',
                        typeof result.message === 'string' ? result.message : 'The lifecycle operation did not complete.',
                        result.execution === 'not_started' ? 'not_started' : 'unknown', result)); return;
                }
                resolveResult(result);
            });
    });
}
