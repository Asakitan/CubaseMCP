'use strict';
const fs = require('node:fs'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { MidiClient } = require('../dist/src/midi.js');
const { loadConfig } = require('../dist/src/config.js');
const root = path.resolve(__dirname, '..'), reopen = process.argv.slice(2).join(' ') === '--reopen';
if (process.argv.length > 2 && !reopen) throw new Error('INVALID_MODE');
const fixture = path.join(root, 'artifacts/live-smoke/Minimal Save 30.cpr');
const saved = path.join(root, 'artifacts/live-smoke/Minimal Saved 30.cpr');
const readReceipt = () => JSON.parse(fs.readFileSync(path.join(root, 'artifacts/runtime/cubase-launch.json'), 'utf8'));
function snapshot() {
    const stat = fs.lstatSync(fixture);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('FIXTURE_IDENTITY_CHANGED');
    return { bytes: fs.readFileSync(fixture), size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino };
}
async function main() {
    const launch = readReceipt(), pid = launch.ProcessId, creation = launch.processCreationFiletime;
    const preflight = JSON.parse(fs.readFileSync(path.join(root, `artifacts/minimal-save30/preflight-${pid}-${creation}.json`), 'utf8'));
    if (preflight.pid !== pid || preflight.creation !== creation || preflight.holder !== launch.HostPid ||
        preflight.fixture !== fixture || Date.now() - Date.parse(preflight.at) > 10000 ||
        preflight.mode !== (reopen ? 'reopen' : 'write')) throw new Error('PREFLIGHT_MISMATCH');
    const ledger = path.join(root, `artifacts/ipc/minimal30-${pid}-${creation}-${randomUUID()}.jsonl`), fd = fs.openSync(ledger, 'wx');
    const log = e => { fs.writeSync(fd, JSON.stringify({ at: new Date().toISOString(), ...e }) + '\n'); fs.fsyncSync(fd); };
    const admit = kind => { const f = fs.openSync(path.join(root, `artifacts/ipc/minimal30-${kind}-${pid}-${creation}.json`), 'wx'); try { fs.writeFileSync(f, JSON.stringify({ pid, creation, kind, fixture, at: new Date().toISOString() })); fs.fsyncSync(f); } finally { fs.closeSync(f); } };
    const client = new MidiClient(loadConfig().midi); let stage = 'not_started';
    try {
        const before = snapshot(); log({ step: 'start', pid, creation, reopen, size: before.size });
        const status = await client.request('diag.status', {});
        if (status.profile !== 'minimal-save30' || !status.session) throw new Error('PROFILE_MISMATCH');
        log({ step: 'status', status });
        const session = status.session;
        let state = status, limit = Date.now() + 2000;
        while (state.tempo === null && Date.now() < limit) {
            await new Promise(r => setTimeout(r, 100)); state = await client.request('diag.read', { session });
        }
        if (!Number.isFinite(state.tempo)) throw new Error('TEMPO_NOT_OBSERVED');
        if (reopen) {
            if (Math.abs(state.tempo - 137.5) > 1e-6 || !before.bytes.equals(fs.readFileSync(saved))) throw new Error('REOPEN_CONTENT_MISMATCH');
            stage = 'reopen_content_observed'; log({ step: stage, tempo: state.tempo, size: before.size });
            return;
        }
        if (before.size !== 93085 || state.tempo === 137.5) throw new Error('BASELINE_MISMATCH');
        // Fixed diagnostic uses the inspected MidiClient's existing validated handle;
        // a second WinMM output in this process is not supported on this host.
        const output = client.output;
        if (!output || !output.isPortOpen()) throw new Error('INSPECTED_OUTPUT_NOT_OPEN');
        admit('edit');
        log({ step: 'edit_admitted', expectedTempo: state.tempo, requestedTempo: 137.5 }); stage = 'edit_unknown';
        log({ step: 'edit_receipt', result: await client.request('diag.edit', { session, expectedTempo: state.tempo }) });
        limit = Date.now() + 2000;
        do { state = await client.request('diag.read', { session }); if (Math.abs(state.tempo - 137.5) < 1e-6) break; await new Promise(r => setTimeout(r, 100)); } while (Date.now() < limit);
        if (Math.abs(state.tempo - 137.5) >= 1e-6 || state.canPerform !== true) throw new Error('EDIT_OR_SAVE_STATE_NOT_OBSERVED');
        log({ step: 'edit_observed', state });
        const current = readReceipt(); if (current.ProcessId !== pid || current.processCreationFiletime !== creation || !snapshot().bytes.equals(before.bytes)) throw new Error('PRE_SAVE_STATE_CHANGED');
        admit('input');
        log({ step: 'input_admitted', packet: [144, 1, 127] }); stage = 'save_unknown';
        output.sendMessage([144, 1, 127]);
        log({ step: 'input_sent', release: 'No release or repeating input; process exit clears the diagnostic button.' });
        let after = before; limit = Date.now() + 15000;
        while (Date.now() < limit && after.bytes.equals(before.bytes)) {
            await new Promise(r => setTimeout(r, 250));
            try { after = snapshot(); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        }
        if (!after.bytes.equals(before.bytes)) {
            let stable = false; limit = Date.now() + 5000;
            while (Date.now() < limit) {
                await new Promise(r => setTimeout(r, 500)); const next = snapshot();
                if (next.bytes.equals(after.bytes)) { stable = true; after = next; break; }
                after = next;
            }
            if (!stable) throw new Error('SAVED_FILE_NOT_STABLE');
            const out = fs.openSync(saved, 'wx'); try { fs.writeFileSync(out, after.bytes); fs.fsyncSync(out); } finally { fs.closeSync(out); }
            stage = 'file_change_observed';
        } else { stage = 'save_unverified'; process.exitCode = 2; }
        log({ step: stage, size: after.size, mtimeMs: after.mtimeMs, savedSnapshot: stage === 'file_change_observed' ? saved : null });
        log({ step: 'after_state', state: await client.request('diag.read', { session }) });
    } catch (error) { log({ step: 'error', stage, message: String(error.message || error) }); process.exitCode = 1; }
    finally {
        client.close(); fs.closeSync(fd); process.stdout.write(JSON.stringify({ stage, ledger }) + '\n');
    }
}
main().catch(e => { process.stderr.write(String(e.stack || e) + '\n'); process.exitCode = 1; });
