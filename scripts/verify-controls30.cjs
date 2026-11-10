'use strict';

// Session-30 live sweep of the declared binding controls on the owned private-desktop instance.
// Through the real stdio MCP server it writes every writable control of the active mapping page
// once with a value that differs from the observed one, waits for host feedback, and writes the
// previous value back when the first write was confirmed. Controls are never retried.
//   feedback_observed - the host reported a new value after the write
//   not_observed      - the write was submitted and the host reported nothing in the settle window
//   unavailable       - the bridge reports the control as unavailable (missing branch, no channel, no plug-in)
//   read_only / action - not written by this sweep
// Usage (from a PowerShell-started process): node scripts/verify-controls30.cjs <label> [--resume] [--page main|mixer]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('@modelcontextprotocol/client');
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');

const root = path.resolve(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const SONG = { tracks: [
    { name: 'Keys', channel: 0, program: 0, notes: [60, 64, 67].map(pitch => ({ pitch, start: 0, duration: 4 })) },
    { name: 'Low', channel: 1, program: 33, notes: [0, 1, 2, 3].map(step => ({ pitch: 36, start: step, duration: 0.5 })) }
] };

async function main() {
    const argv = process.argv.slice(2), label = argv[0];
    if (!label || !/^[a-z0-9-]+$/.test(label)) throw new Error('usage: verify-controls30.cjs <label> [--resume] [--page main|mixer]');
    const onlyPage = argv.includes('--page') ? argv[argv.indexOf('--page') + 1] : null;
    const done = new Set();
    const ipc = path.join(root, 'artifacts', 'ipc');
    if (argv.includes('--resume')) {
        for (const name of fs.readdirSync(ipc).filter(file => file.startsWith(`control-sweep30-${label}-`) && file.endsWith('.jsonl'))) {
            for (const line of fs.readFileSync(path.join(ipc, name), 'utf8').split(/\r?\n/)) {
                if (line.trim()) { const entry = JSON.parse(line); if (entry.step === 'control' && entry.outcome !== 'sweep_error' && entry.outcome !== 'rejected') done.add(entry.key); }
            }
        }
    }
    const ledger = path.join(ipc, `control-sweep30-${label}-${crypto.randomUUID()}.jsonl`);
    const fd = fs.openSync(ledger, 'wx', 0o600);
    const record = event => { fs.writeSync(fd, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n'); };
    const client = new Client({ name: 'control-sweep30', version: '0.1.0' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dist/src/server.js')],
        env: { ...process.env, CUBASE_MCP_CONFIG: path.join(root, 'cubase.config.json') }, stderr: 'pipe' });
    transport.stderr.on('data', data => process.stderr.write(data));
    let session = null;
    async function raw(name, args = {}) {
        const response = await client.callTool({ name, arguments: args });
        const text = response.content.find(item => item.type === 'text').text;
        // The MCP layer answers a schema violation with plain text.
        try { return JSON.parse(text); } catch { return { ok: false, error: { code: 'INPUT_REFUSED', message: text.slice(0, 200) } }; }
    }
    async function call(name, args = {}) {
        const sessionless = /^cubase_(status|runtime_|project_(create|open)|connection_reset)/.test(name);
        const body = await raw(name, sessionless ? args : { session, ...args });
        if (!body.ok) { const error = new Error(`${name}: ${body.error.code} ${body.error.message}`); error.code = body.error.code; throw error; }
        if (body.data && typeof body.data.session === 'string') session = body.data.session;
        if (body.data && body.data.host && typeof body.data.host.session === 'string') session = body.data.host.session;
        return body.data;
    }
    async function controlKeys(pageKey) {
        const keys = [];
        for (let offset = 0; offset !== null;) {
            const page = await call('cubase_controls_list', { offset, limit: 16, groupLimit: 1 });
            keys.push(...page.controls.filter(control => control.page === pageKey).map(control => control.key));
            offset = page.nextOffset;
        }
        return keys;
    }
    let track = null;
    async function sweepControl(key) {
        const entry = { step: 'control', key };
        let info;
        try { info = (await call('cubase_control_get', { key })).control; }
        catch (error) {
            // An empty bank slot or a missing host branch is reported by the bridge as an error of the read itself.
            if (!error.code || /^MIDI_/.test(error.code)) throw error;
            entry.outcome = 'unavailable'; entry.reason = error.code; entry.page = /^mixer\./.test(key) ? 'mixer' : 'main';
            const slot = /^mixer\.channel\.(\d+)\./.exec(key);
            if (slot) entry.channel = Number(slot[1]);
            return entry;
        }
        Object.assign(entry, { page: info.page, momentary: info.momentary, channel: info.channel ? info.channel.index : undefined,
            channelUniqueId: info.channel ? info.channel.uniqueId : undefined, before: info.observed ? info.observed.value : null });
        if (!info.available || info.error) { entry.outcome = 'unavailable'; entry.reason = info.error ? info.error.code : 'not available'; return entry; }
        if (info.readOnly) { entry.outcome = 'read_only'; entry.observed = info.observed !== null; return entry; }
        if (info.action) { entry.outcome = 'action'; return entry; }
        // An insert or strip slot without a plug-in reports no identity or an empty name.
        if (info.pluginIdentity === null || (info.pluginIdentity && !info.pluginIdentity.name)) { entry.outcome = 'unavailable'; entry.reason = 'no plug-in in this slot'; return entry; }
        const args = { key };
        if (info.channel) args.expectedChannelUniqueId = info.channel.uniqueId;
        if (info.pluginIdentity) { args.expectedPluginIdentity = info.pluginIdentity; entry.plugin = info.pluginIdentity.name; }
        if (/^track\./.test(key)) { args.expectedTrackUniqueId = track.uniqueId; args.expectedTrackRuntimeId = track.runtimeId; }
        const before = info.observed ? info.observed.value : null;
        const target = info.momentary ? 1 : before === null ? 1 : before === 0 ? 1 : before === 1 ? 0 : before > 0.5 ? Math.round((before - 0.125) * 1000) / 1000 : Math.round((before + 0.125) * 1000) / 1000;
        entry.target = target;
        let written;
        try { written = await call('cubase_control_set', { ...args, value: target, settleMs: 450 }); }
        catch (error) { entry.outcome = 'rejected'; entry.reason = error.code || String(error.message); return entry; }
        const confirmation = written.confirmation || {};
        entry.outcome = confirmation.state === 'feedback_observed' ? 'feedback_observed' : confirmation.state === 'not_applicable' ? 'action' : 'not_observed';
        entry.after = confirmation.observed ? confirmation.observed.value : null;
        entry.matches = confirmation.matchesRequest === true;
        entry.display = confirmation.display && confirmation.display.value !== undefined ? confirmation.display.value : undefined;
        if (/^transport\.(start|record|rewind|forward)$/.test(key)) { await call('cubase_transport_action', { action: 'stop', settleMs: 200 }); await call('cubase_transport_action', { action: 'returnToZero', settleMs: 100 }); }
        else if (entry.outcome === 'feedback_observed' && !info.momentary && before !== null) {
            const restored = await call('cubase_control_set', { ...args, value: before, settleMs: 300 }).catch(error => ({ confirmation: { state: error.code || 'error' } }));
            entry.restored = restored.confirmation && restored.confirmation.state === 'feedback_observed';
        }
        return entry;
    }
    async function sweepPage(pageKey) {
        const keys = (await controlKeys(pageKey)).filter(key => !done.has(key) && !/^command\./.test(key));
        process.stdout.write(`${pageKey}: ${keys.length} controls to sweep\n`);
        const counts = {};
        for (const key of keys) {
            let entry;
            try { entry = await sweepControl(key); }
            catch (error) {
                entry = { step: 'control', key, outcome: 'sweep_error', reason: String(error.message || error) };
                if (/MIDI_(FAULTED|TIMEOUT|CLOSED)/.test(entry.reason)) { await raw('cubase_connection_reset', { confirmNoReplay: true }).catch(() => {}); await call('cubase_status').catch(() => {}); }
            }
            record(entry);
            counts[entry.outcome] = (counts[entry.outcome] || 0) + 1;
            if (entry.outcome === 'sweep_error' || entry.outcome === 'rejected') process.stdout.write(`${key}: ${entry.outcome} ${entry.reason}\n`);
        }
        process.stdout.write(`${pageKey} done: ${JSON.stringify(counts)}\n`);
        return counts;
    }

    try {
        await client.connect(transport);
        let status = await call('cubase_status');
        if (!argv.includes('--resume')) {
            const projectPath = path.join(root, 'artifacts', 'managed-projects', 'session-30', `controls-${label}-${path.basename(ledger, '.jsonl').slice(-8)}`, 'Song.cpr');
            await call('cubase_project_create', { projectPath, replaceCurrent: true, confirmDiscardChanges: true });
            await sleep(500);
            status = await call('cubase_status');
            const imported = await call('cubase_midi_import', { song: SONG, confirmImport: true });
            await call('cubase_command_execute', { key: 'track.add.audioMono', confirmCurrentSelection: true });
            await sleep(400);
            record({ step: 'project', projectPath, added: imported.channels.added.map(item => `${item.typeName}:${item.title}`) });
        }
        const pages = await call('cubase_pages_list', {});
        if (pages.active !== 'main') await call('cubase_page_activate', { page: 'main' });
        // Selected-track controls are swept on the instrument channel, which has the widest set of host values.
        const channels = (await call('cubase_channels_list', {})).items;
        const synth = channels.find(channel => channel.typeName === 'Synth');
        if (synth) { await call('cubase_channel_set', { objectId: synth.objectId, expectedUniqueId: synth.uniqueIdString, field: 'selected', value: true }); await sleep(400); }
        track = await call('cubase_selected_track', {});
        record({ step: 'context', bridgeRevision: status.bridgeRevision, channels: channels.map(channel => `${channel.typeName}:${channel.title}`),
            channelIds: Object.fromEntries(channels.map(channel => [channel.uniqueIdString, `${channel.typeName}:${channel.title}`])),
            selectedTrack: track, windows: (await call('cubase_runtime_windows')).unexpected });
        if (!onlyPage || onlyPage === 'main') {
            record({ step: 'page', page: 'main', activation: (await call('cubase_pages_list', {})).activation });
            record({ step: 'page_done', page: 'main', counts: await sweepPage('main') });
        }
        if (!onlyPage || onlyPage === 'mixer') {
            await call('cubase_page_activate', { page: 'mixer' });
            await sleep(800);
            record({ step: 'page', page: 'mixer', activation: (await call('cubase_pages_list', {})).activation });
            // Which channel sits in which bank slot, by the identity the bank reports.
            const bank = [];
            for (let slot = 0; slot < 8; slot++) {
                let control = null;
                try { control = (await call('cubase_control_get', { key: `mixer.channel.${slot}.volume` })).control; }
                catch (error) { if (!error.code || /^MIDI_/.test(error.code)) throw error; }
                const match = control && control.channel && channels.find(channel => channel.uniqueIdString === control.channel.uniqueId);
                bank.push({ slot, uniqueId: control && control.channel ? control.channel.uniqueId : null, channel: match ? `${match.typeName}:${match.title}` : null });
            }
            record({ step: 'bank', bank });
            record({ step: 'page_done', page: 'mixer', counts: await sweepPage('mixer') });
            await call('cubase_page_activate', { page: 'main' });
            await sleep(500);
        }
        record({ step: 'done', windows: (await call('cubase_runtime_windows')).unexpected });
    } finally {
        fs.closeSync(fd);
        await client.close().catch(() => {});
        process.stdout.write('ledger ' + ledger + '\n');
    }
}

main().catch(error => { process.stderr.write(String(error && error.stack || error) + '\n'); process.exitCode = 1; });
