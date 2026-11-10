'use strict';

// Session-30 live probe for allowlisted commands on the owned private-desktop instance.
// For each key it records, through the real stdio MCP server: canPerform, the mixer channel
// list and the visible window titles before and after one execution. It never retries a
// command and never touches a window; a new visible window is only reported.
// Usage: node scripts/probe-commands30.cjs <label> <commandKey> [<commandKey> ...]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Client } = require('@modelcontextprotocol/client');
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');

const root = path.resolve(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function windows() {
    const text = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
        path.join(root, 'scripts', 'Read-OwnedDesktopWindows.ps1'), '-VisibleOnly'], { encoding: 'utf8', windowsHide: true });
    const parsed = JSON.parse(text.trim());
    if (parsed.status !== 'observed') throw new Error('WINDOW_INVENTORY_FAILED ' + text);
    return parsed.windows.filter(item => !/^UAC/.test(item.className)).map(item => `${item.title}`).sort();
}

async function main() {
    const [label, ...keys] = process.argv.slice(2);
    if (!label || !/^[a-z0-9-]+$/.test(label) || !keys.length) throw new Error('usage: probe-commands30.cjs <label> <key> [...]');
    const receipt = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'runtime', 'cubase-launch.json'), 'utf8'));
    const ledger = path.join(root, 'artifacts', 'ipc', `command-probe30-${label}-${receipt.ProcessId}-${crypto.randomUUID()}.jsonl`);
    const fd = fs.openSync(ledger, 'wx', 0o600);
    const record = event => { fs.writeSync(fd, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n'); fs.fsyncSync(fd); };
    const client = new Client({ name: 'command-probe30', version: '0.1.0' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dist/src/server.js')],
        env: { ...process.env, CUBASE_MCP_CONFIG: path.join(root, 'cubase.config.json') }, stderr: 'pipe' });
    transport.stderr.on('data', data => process.stderr.write(data));
    async function call(name, args = {}) {
        const response = await client.callTool({ name, arguments: args });
        return JSON.parse(response.content.find(item => item.type === 'text').text);
    }
    async function channels(session) {
        const listed = await call('cubase_objects_list', { session, root: 'mixConsole', limit: 64 });
        if (!listed.ok) throw new Error('CHANNEL_LIST_FAILED ' + JSON.stringify(listed.error));
        return listed.data.items.map(item => `${item.typeName}:${item.title}`);
    }
    try {
        await client.connect(transport);
        const status = await call('cubase_status');
        if (!status.ok || !status.data.serverCompatibility.readyForOperations) throw new Error('BRIDGE_NOT_READY ' + JSON.stringify(status));
        let session = status.data.session;
        record({ step: 'status', pid: receipt.ProcessId, creation: receipt.processCreationFiletime, session, activation: status.data.activation });
        for (const key of keys) {
            const before = { windows: windows(), channels: await channels(session) };
            const info = await call('cubase_command_get', { session, key });
            const entry = { step: 'command', key, canPerform: info.ok ? info.data.command.canPerform : null, before };
            if (!info.ok || !info.data.command.canPerform) {
                entry.outcome = info.ok ? 'not_performable' : info.error.code;
                record(entry);
                process.stdout.write(`${key}: ${entry.outcome}\n`);
                continue;
            }
            const executed = await call('cubase_command_execute', { session, key, confirmCurrentSelection: true });
            entry.receipt = executed.ok ? { bindingObserved: executed.data.bindingObserved, waitedMs: executed.data.waitedMs } : executed.error;
            await sleep(700);
            let after;
            try {
                const next = await call('cubase_status');
                if (next.ok && next.data.session !== session) { entry.sessionChanged = true; session = next.data.session; }
                after = { windows: windows(), channels: await channels(session) };
            } catch (error) { after = { error: String(error.message || error), windows: windows() }; }
            entry.after = after;
            entry.newWindows = after.windows.filter(title => !before.windows.includes(title));
            entry.closedWindows = before.windows.filter(title => !after.windows.includes(title));
            if (after.channels) {
                entry.addedChannels = after.channels.filter(name => !before.channels.includes(name) ||
                    after.channels.filter(other => other === name).length > before.channels.filter(other => other === name).length);
                entry.removedChannels = before.channels.filter(name => after.channels.filter(other => other === name).length < before.channels.filter(other => other === name).length);
                entry.channelCount = [before.channels.length, after.channels.length];
            }
            record(entry);
            process.stdout.write(`${key}: binding=${entry.receipt.bindingObserved} channels ${before.channels.length}->${after.channels ? after.channels.length : '?'}` +
                `${entry.addedChannels && entry.addedChannels.length ? ' +[' + entry.addedChannels.join(', ') + ']' : ''}` +
                `${entry.newWindows.length ? ' NEW WINDOWS [' + entry.newWindows.join(' | ') + ']' : ''}` +
                `${entry.closedWindows.length ? ' closed [' + entry.closedWindows.join(' | ') + ']' : ''}\n`);
            if (entry.newWindows.length) { process.stdout.write('stopping: a new window appeared and is left untouched\n'); break; }
        }
    } finally {
        fs.closeSync(fd);
        await client.close().catch(() => {});
        process.stdout.write('ledger ' + ledger + '\n');
    }
}

main().catch(error => { process.stderr.write(String(error && error.stack || error) + '\n'); process.exitCode = 1; });
