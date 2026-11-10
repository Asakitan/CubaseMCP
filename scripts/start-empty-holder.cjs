'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const identifier = process.argv[2];
if (process.argv.length !== 3 || !/^[a-f0-9]{32}$/.test(identifier || '')) throw new Error('Invalid owned launch identifier.');
const root = path.resolve(__dirname, '..');
const runtime = path.join(root, 'artifacts', 'runtime');
const stdout = path.join(runtime, `cubase-empty-${identifier}.stdout.log`);
const stderr = path.join(runtime, `cubase-empty-${identifier}.stderr.log`);
for (const file of [stdout, stderr]) {
    const entry = fs.lstatSync(file);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size !== 0) throw new Error('Owned launch logs must be new regular files.');
}
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(__dirname, 'Start-CubaseEmptyBackground.ps1'), '-HolderStdoutPath', stdout, '-HolderStderrPath', stderr],
    { cwd: root, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...process.env, TEMP: path.join(root, 'artifacts', 'scratch-temp'), TMP: path.join(root, 'artifacts', 'scratch-temp') } });
child.stderr.on('data', data => fs.appendFileSync(stderr, data));
child.on('error', error => { fs.appendFileSync(stderr, String(error) + '\n'); process.exitCode = 1; });
child.on('exit', code => { if (code) process.exitCode = 1; });