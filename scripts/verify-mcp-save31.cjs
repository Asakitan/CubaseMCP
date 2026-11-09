'use strict';
const fs = require('node:fs'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Client } = require('@modelcontextprotocol/client');
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');
const root = path.resolve(__dirname, '..'), flags = process.argv.slice(2), reopen = flags.includes('--reopen');
if (flags.some(f => !['--reopen', '--profile32'].includes(f))) throw new Error('INVALID_MODE');
const profile = flags.includes('--profile32') ? '32' : '31', requestedBpm = profile === '32' ? 146.75 : 145.25;
const revision = profile === '32' ? '2026-11-10-coverage-3.13' : '2026-11-10-coverage-3.11';
const fixture = path.join(root, `artifacts/live-smoke/MCP Save ${profile}.cpr`), saved = path.join(root, `artifacts/live-smoke/MCP Saved ${profile}.cpr`);
const readReceipt = () => JSON.parse(fs.readFileSync(path.join(root, 'artifacts/runtime/cubase-launch.json'), 'utf8'));
function snapshot() {
    const s = fs.lstatSync(fixture);
    if (!s.isFile() || s.isSymbolicLink()) throw new Error('FIXTURE_IDENTITY_CHANGED');
    return { bytes: fs.readFileSync(fixture), size: s.size, mtimeMs: s.mtimeMs };
}
async function main() {
    const launch = readReceipt(), pid = launch.ProcessId, creation = launch.processCreationFiletime;
    const preflight = JSON.parse(fs.readFileSync(path.join(root, `artifacts/mcp-save${profile}/preflight-${pid}-${creation}.json`), 'utf8'));
    if (preflight.pid !== pid || preflight.creation !== creation || preflight.holder !== launch.HostPid || preflight.fixture !== fixture ||
        Date.now() - Date.parse(preflight.at) > 10000 || preflight.mode !== (reopen ? 'reopen' : 'write')) throw new Error('PREFLIGHT_MISMATCH');
    const ledger = path.join(root, `artifacts/ipc/mcp${profile}-${pid}-${creation}-${randomUUID()}.jsonl`), fd = fs.openSync(ledger, 'wx');
    const log = e => { fs.writeSync(fd, JSON.stringify({ at: new Date().toISOString(), ...e }) + '\n'); fs.fsyncSync(fd); };
    function admit(kind) {
        const f = fs.openSync(path.join(root, `artifacts/ipc/mcp${profile}-${kind}-${pid}-${creation}.json`), 'wx');
        try { fs.writeFileSync(f, JSON.stringify({ pid, creation, kind, fixture, at: new Date().toISOString() })); fs.fsyncSync(f); } finally { fs.closeSync(f); }
    }
    const client = new Client({ name: 'mcp-save31', version: '1' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dist/src/server.js')],
        env: { ...process.env, CUBASE_MCP_CONFIG: path.join(root, 'cubase.config.json') }, stderr: 'pipe' });
    transport.stderr.on('data', data => process.stderr.write(data));
    async function call(name, args = {}) {
        const response = await client.callTool({ name, arguments: args });
        const body = JSON.parse(response.content.find(p => p.type === 'text').text);
        if (response.isError || !body.ok) throw new Error(JSON.stringify(body.error));
        return body.data;
    }
    let stage = 'not_started';
    try {
        const before = snapshot(); log({ step: 'start', pid, creation, reopen, fixture, size: before.size });
        await client.connect(transport);
        const status = await call('cubase_status');
        if (status.bridgeRevision !== revision || !status.serverCompatibility.readyForOperations) throw new Error('BRIDGE_NOT_READY');
        log({ step: 'status', status }); const session = status.session;
        let state = await call('cubase_transport_get', { session });
        const bpm = state.observed.tempo && state.observed.tempo.bpm;
        if (!Number.isFinite(bpm)) throw new Error('TEMPO_NOT_OBSERVED');
        if (reopen) {
            if (Math.abs(bpm - requestedBpm) > 1e-6 || !before.bytes.equals(fs.readFileSync(saved))) throw new Error('REOPEN_CONTENT_MISMATCH');
            stage = 'reopen_content_observed'; log({ step: stage, bpm, size: before.size }); return;
        }
        if (before.size !== 93085 || bpm === requestedBpm) throw new Error('BASELINE_MISMATCH');
        admit('edit'); log({ step: 'edit_admitted', before: bpm, requested: requestedBpm }); stage = 'edit_unknown';
        log({ step: 'edit_receipt', result: await call('cubase_tempo_set', { session, bpm: requestedBpm }) });
        let limit = Date.now() + 2000;
        do { state = await call('cubase_transport_get', { session }); if (state.observed.tempo && Math.abs(state.observed.tempo.bpm - requestedBpm) < 1e-6) break; await new Promise(r => setTimeout(r, 100)); } while (Date.now() < limit);
        if (!state.observed.tempo || Math.abs(state.observed.tempo.bpm - requestedBpm) >= 1e-6) throw new Error('EDIT_NOT_OBSERVED');
        log({ step: 'edit_observed', bpm: state.observed.tempo.bpm });
        const current = readReceipt(); if (current.ProcessId !== pid || current.processCreationFiletime !== creation || !snapshot().bytes.equals(before.bytes)) throw new Error('PRE_SAVE_STATE_CHANGED');
        admit('save'); log({ step: 'save_admitted' }); stage = 'save_unknown';
        const result = await call('cubase_command_execute', { session, key: 'project.save', confirmCurrentSelection: true });
        log({ step: 'save_receipt', result });
        if (result.execution !== 'submitted' || result.bindingObserved !== true) throw new Error('BINDING_NOT_OBSERVED');
        let after = before; limit = Date.now() + 15000;
        while (Date.now() < limit && after.bytes.equals(before.bytes)) {
            await new Promise(r => setTimeout(r, 250));
            try { after = snapshot(); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        }
        if (after.bytes.equals(before.bytes)) { stage = 'save_unverified'; log({ step: stage, size: after.size }); process.exitCode = 2; return; }
        let stable = false; limit = Date.now() + 5000;
        while (Date.now() < limit) {
            await new Promise(r => setTimeout(r, 500)); const next = snapshot();
            if (next.bytes.equals(after.bytes)) { stable = true; after = next; break; } after = next;
        }
        if (!stable) throw new Error('SAVED_FILE_NOT_STABLE');
        const out = fs.openSync(saved, 'wx'); try { fs.writeFileSync(out, after.bytes); fs.fsyncSync(out); } finally { fs.closeSync(out); }
        stage = 'file_change_observed'; log({ step: stage, size: after.size, mtimeMs: after.mtimeMs, savedSnapshot: saved });
    } catch (error) { log({ step: 'error', stage, message: String(error.message || error) }); process.exitCode = 1; }
    finally { try { await client.close(); } finally { fs.closeSync(fd); process.stdout.write(JSON.stringify({ stage, ledger }) + '\n'); } }
}
main().catch(e => { process.stderr.write(String(e.stack || e) + '\n'); process.exitCode = 1; });
