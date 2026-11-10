'use strict';

// Session-30 live verification of the key-command allowlist on the owned private-desktop instance.
// Everything goes through the real stdio MCP server. For every allowlisted command the script
// prepares a context (cursor, selected track, selected events, clipboard), executes the command
// exactly once and records what the host reports afterwards:
//   - the host binding event of the command,
//   - visible windows of the owned process (a new window means a prompt; the command is then
//     recorded as "dialog", the instance is replaced by a fresh project and nothing is clicked),
//   - mixer channels and their flags, the transport state and the MIDI content written by Cubase.
// A content change is undone with Edit/Undo and the restored state is recorded as well.
// Usage (from a PowerShell-started process): node scripts/verify-commands30.cjs <label> [--only key,key] [--skip key,key] [--resume]
// --resume skips every command that an earlier ledger with the same label already recorded;
// --redo key,key probes the named commands again in spite of --resume.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('@modelcontextprotocol/client');
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');

const root = path.resolve(__dirname, '..');
const table = require(path.join(root, 'remote', 'commands.js'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const SONG = { tracks: [
    { name: 'Keys', channel: 0, program: 0, notes: [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]].flatMap((chord, bar) =>
        chord.map(pitch => ({ pitch, start: bar * 4, duration: 3.9, velocity: 90 }))) },
    { name: 'Low', channel: 1, program: 33, controlChanges: [{ controller: 7, value: 100, beat: 0 }, { controller: 1, value: 40, beat: 2 }],
        notes: [36, 33, 29, 31].flatMap((pitch, bar) => [0, 1, 2, 3].map(step => ({ pitch, start: bar * 4 + step + (step % 2 ? 0.035 : 0), duration: 0.5, velocity: 100 }))) }
] };
// Commands whose effect is checked by a dedicated sequence instead of the generic loop.
const SEQUENCED = new Set(['project.save', 'edit.undo', 'edit.redo', 'midi.writeFileToProjectFolder', 'track.removeSelected',
    'export.openMixdownWindow', 'export.perform']);
// Commands that are executed last because they are the most likely to open a prompt.
const LATE = ['track.freezeToggle', 'transport.record', 'mixer.addGroupToSelected', 'mixer.addFxToSelected'];

// Transport commands that need more than "cursor at bar 2" to show an effect.
const TRANSPORT_CONTEXT = { 'transport.stop': 'playing', 'transport.toLeftLocator': 'bar4', 'transport.setLeftLocator': 'bar4', 'transport.exchangeLocators': 'bar4',
    'transport.locatorsToSelection': 'events', 'transport.locateSelection': 'events', 'transport.locateSelectionEnd': 'events', 'transport.loopSelection': 'events',
    'transport.locateNextEvent': 'track', 'transport.locatePreviousEvent': 'track' };

function contextOf(definition) {
    const key = definition.key;
    if (TRANSPORT_CONTEXT[key]) return TRANSPORT_CONTEXT[key];
    if (['edit.paste', 'edit.pasteAtOrigin', 'edit.pasteTime'].includes(key)) return 'clipboard';
    if (key === 'edit.unmuteAll') return 'muted';
    if (key === 'edit.deactivateAllSolo') return 'soloed';
    if (key === 'edit.unmuteEvents') return 'mutedEvents';
    if (['edit.selectAll', 'edit.selectNone'].includes(key) || /^track\.add\./.test(key)) return 'none';
    if (['edit', 'midi', 'nudge', 'audio', 'navigate'].includes(definition.group)) return 'events';
    if (['track', 'automation', 'mixer'].includes(definition.group)) return 'track';
    return 'none';
}
const needsMidi = definition => ['edit', 'midi', 'nudge', 'audio', 'navigate', 'track'].includes(definition.group);

async function main() {
    const argv = process.argv.slice(2), label = argv[0];
    if (!label || !/^[a-z0-9-]+$/.test(label)) throw new Error('usage: verify-commands30.cjs <label> [--only a,b] [--skip a,b]');
    const option = name => { const index = argv.indexOf(name); return index === -1 ? null : new Set(argv[index + 1].split(',')); };
    const only = option('--only'), skip = option('--skip') || new Set();
    if (argv.includes('--resume')) {
        for (const name of fs.readdirSync(path.join(root, 'artifacts', 'ipc')).filter(file => file.startsWith(`command-verify30-${label}-`) && file.endsWith('.jsonl'))) {
            for (const line of fs.readFileSync(path.join(root, 'artifacts', 'ipc', name), 'utf8').split(/\r?\n/)) {
                if (!line.trim()) continue;
                const entry = JSON.parse(line);
                if (entry.step === 'command' && entry.outcome !== 'probe_error') skip.add(entry.key);
            }
        }
    }
    for (const key of option('--redo') || []) skip.delete(key);
    const ledger = path.join(root, 'artifacts', 'ipc', `command-verify30-${label}-${crypto.randomUUID()}.jsonl`);
    const fd = fs.openSync(ledger, 'wx', 0o600);
    const record = event => { fs.writeSync(fd, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n'); fs.fsyncSync(fd); };
    const client = new Client({ name: 'command-verify30', version: '0.1.0' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dist/src/server.js')],
        env: { ...process.env, CUBASE_MCP_CONFIG: path.join(root, 'cubase.config.json') }, stderr: 'pipe' });
    transport.stderr.on('data', data => process.stderr.write(data));
    let session = null, round = 0, baseline = null;

    async function raw(name, args = {}) {
        const response = await client.callTool({ name, arguments: args });
        return JSON.parse(response.content.find(item => item.type === 'text').text);
    }
    async function call(name, args = {}) {
        const sessionless = /^cubase_(status|runtime_|project_(create|open)|connection_reset)/.test(name);
        const body = await raw(name, sessionless ? args : { session, ...args });
        if (!body.ok) { const error = new Error(`${name}: ${body.error.code} ${body.error.message}`); error.code = body.error.code; error.details = body.error.details; throw error; }
        if (body.data && typeof body.data.session === 'string') session = body.data.session;
        if (body.data && body.data.host && typeof body.data.host.session === 'string') session = body.data.host.session;
        return body.data;
    }
    const unexpected = async () => (await call('cubase_runtime_windows')).unexpected.map(item => item.title);
    const channels = async () => (await call('cubase_channels_list', {})).items;
    const flag = (channel, field) => channel.fields[field] && channel.fields[field].value >= 0.5 ? 1 : 0;
    const channelState = items => items.map(channel => `${channel.typeName}:${channel.title}:` +
        ['mute', 'solo', 'selected', 'recordEnable', 'monitor', 'automationRead', 'automationWrite'].map(field => flag(channel, field)).join(''));
    async function transportState() {
        const state = await call('cubase_transport_state', {});
        return { playing: state.playing, recording: state.recording, cycle: state.cycle, punchIn: state.punchIn, punchOut: state.punchOut,
            metronome: state.metronome, precount: state.precount, position: state.position.primary,
            left: state.cycleLeft, right: state.cycleRight, signature: state.signature, tempo: state.tempo && state.tempo.bpm };
    }
    async function midiState() {
        let read;
        try { read = await call('cubase_midi_read', { noteLimit: 2000, includeControllers: true }); }
        catch (error) { if (error.code === 'MIDI_FILE_NOT_OBSERVED') return { digest: 'none', text: 'no file written' }; throw error; }
        const notes = read.notes.map(note => `${read.tracks.find(track => track.index === note.track).name}|${note.pitch}|${note.start}|${note.duration}|${note.velocity}`).sort();
        const sum = field => Math.round(read.notes.reduce((total, note) => total + note[field], 0) * 1000) / 1000;
        const text = `tracks=${read.tracks.filter(track => track.noteCount || track.controlChangeCount).map(track => `${track.name}:${track.noteCount}`).join(',')} ` +
            `notes=${read.noteTotal} startSum=${sum('start')} durSum=${sum('duration')} pitchSum=${sum('pitch')} velSum=${sum('velocity')} cc=${read.controlChanges.length}` +
            ` tempo=${read.tempos.map(tempo => tempo.bpm).join('/')} markers=${read.markers.length}`;
        return { digest: crypto.createHash('sha1').update(JSON.stringify([notes, read.controlChanges, read.tempos, read.timeSignatures, read.markers])).digest('hex').slice(0, 12), text };
    }
    async function observe(withMidi) {
        return { channels: channelState(await channels()), transport: await transportState(), midi: withMidi ? await midiState() : null };
    }
    function difference(before, after) {
        const changes = [];
        if (JSON.stringify(before.channels) !== JSON.stringify(after.channels)) {
            const structure = list => list.map(item => item.replace(/:[01]+$/, '')).join('|');
            changes.push(structure(before.channels) !== structure(after.channels) ? 'tracks' : 'channelFlags');
        }
        for (const field of Object.keys(before.transport)) if (before.transport[field] !== after.transport[field]) changes.push(`transport.${field}`);
        if (before.midi && after.midi && before.midi.digest !== after.midi.digest) changes.push('midi');
        return changes;
    }
    async function execute(key) {
        const info = await call('cubase_command_get', { key });
        if (!info.command.canPerform) return { performable: false };
        const receipt = await call('cubase_command_execute', { key, confirmCurrentSelection: true, settleMs: 1500 });
        await sleep(350);
        return { performable: true, bindingObserved: receipt.bindingObserved, waitedMs: receipt.waitedMs };
    }
    async function setChannel(title, field, value) {
        const channel = (await channels()).find(item => item.title === title);
        if (!channel) throw new Error('CHANNEL_MISSING ' + title);
        await call('cubase_channel_set', { objectId: channel.objectId, expectedUniqueId: channel.uniqueIdString, field, value });
        await sleep(200);
    }
    const action = name => call('cubase_transport_action', { action: name, settleMs: 250 });

    async function fresh() {
        round++;
        const projectPath = path.join(root, 'artifacts', 'managed-projects', 'session-30', `verify-${label}-${path.basename(ledger, '.jsonl').slice(-8)}-${round}`, 'Song.cpr');
        await call('cubase_project_create', { projectPath, replaceCurrent: true, confirmDiscardChanges: true });
        await sleep(500);
        await call('cubase_status');
        const imported = await call('cubase_midi_import', { song: SONG, confirmImport: true });
        await execute('track.add.audioMono');
        const audio = (await channels()).find(channel => channel.typeName === 'AudioChannel');
        await call('cubase_locator_set', { display: 'primary', locator: 'cycleLeft', time: '2.1.1.0' });
        await call('cubase_locator_set', { display: 'primary', locator: 'cycleRight', time: '3.1.1.0' });
        await sleep(300);
        const windows = await unexpected();
        baseline = (await midiState()).digest;
        record({ step: 'fresh', round, projectPath, added: imported.channels.added.map(item => item.title), audio: audio && audio.title,
            transport: await transportState(), unexpectedWindows: windows, baseline });
        if (windows.length) throw new Error('FRESH_PROJECT_HAS_UNEXPECTED_WINDOWS ' + windows.join(' | '));
        return audio ? audio.title : null;
    }

    async function prepare(context) {
        await action('returnToZero');
        await action('stepBar');
        if (context === 'bar4') { await action('stepBar'); await action('stepBar'); }
        if (context === 'playing') { await action('start'); await sleep(600); }
        if (context === 'muted') await setChannel('Keys', 'mute', true);
        if (context === 'soloed') await setChannel('Low', 'solo', true);
        if (['events', 'clipboard', 'track', 'mutedEvents'].includes(context)) await setChannel('Low', 'selected', true);
        if (['events', 'clipboard', 'mutedEvents'].includes(context)) await execute('edit.selectAllOnTracks');
        if (context === 'clipboard') await execute('edit.copy');
        if (context === 'mutedEvents') { await execute('edit.muteEvents'); await execute('edit.selectAllOnTracks'); }
    }

    async function probe(definition) {
        const context = contextOf(definition), withMidi = needsMidi(definition);
        const entry = { step: 'command', round, key: definition.key, category: definition.category, name: definition.name, context };
        await prepare(context);
        const before = await observe(withMidi);
        if (withMidi && baseline && ['none', 'events', 'track', 'clipboard'].includes(context) && before.midi.digest !== baseline) {
            const drift = new Error(`BASELINE_DRIFT ${before.midi.text}`);
            drift.drift = true;
            throw drift;
        }
        const executed = await execute(definition.key);
        Object.assign(entry, executed);
        if (!executed.performable) { entry.outcome = 'not_performable'; return entry; }
        entry.unexpectedWindows = await unexpected();
        if (entry.unexpectedWindows.length) { entry.outcome = 'dialog'; return entry; }
        if (definition.group === 'transport' || definition.group === 'marker') await sleep(500);
        let after = await observe(withMidi);
        entry.changes = difference(before, after);
        if (after.transport.playing || after.transport.recording) { await action('stop'); entry.stopped = true; after = await observe(withMidi); }
        entry.before = { midi: before.midi && before.midi.text, transport: before.transport };
        entry.after = { midi: after.midi && after.midi.text, transport: after.transport };
        if (entry.changes.includes('channelFlags') || entry.changes.includes('tracks')) { entry.before.channels = before.channels; entry.after.channels = after.channels; }
        entry.outcome = entry.changes.length ? 'effect_observed' : executed.bindingObserved ? 'submitted' : 'binding_not_observed';
        // Put the project back so that the next command meets the same material.
        const flagsOnly = entry.changes.includes('channelFlags') && !entry.changes.includes('tracks');
        if (context === 'mutedEvents') {
            entry.restoredByCommand = !!baseline && after.midi.digest === baseline;
        } else if (!flagsOnly && (entry.changes.includes('midi') || entry.changes.includes('tracks'))) {
            const undo = await execute('edit.undo');
            const restored = await observe(true);
            entry.undo = { ...undo, restored: !!before.midi && restored.midi.digest === before.midi.digest &&
                JSON.stringify(restored.channels.map(item => item.replace(/:[01]+$/, ''))) === JSON.stringify(before.channels.map(item => item.replace(/:[01]+$/, ''))) };
            entry.unexpectedWindowsAfterUndo = await unexpected();
        } else if (entry.changes.some(change => change === 'channelFlags' || /^transport\.(cycle|punchIn|punchOut|metronome|precount)$/.test(change))) {
            if (context === 'muted' || context === 'soloed') entry.toggledBack = 'not_needed';
            else {
                await prepare(context);
                await execute(definition.key);
                const again = await observe(false);
                entry.toggledBack = JSON.stringify(again.channels) === JSON.stringify(before.channels) &&
                    ['cycle', 'punchIn', 'punchOut', 'metronome', 'precount'].every(field => again.transport[field] === before.transport[field]);
                if (!entry.toggledBack) entry.afterSecondExecution = { channels: again.channels, transport: again.transport };
                // Mute and solo flags decide what Cubase writes; a project left with other flags is replaced.
                if (!entry.toggledBack && JSON.stringify(again.channels.map(item => item.replace(/(:[01]{2})[01]+$/, '$1'))) !==
                    JSON.stringify(before.channels.map(item => item.replace(/(:[01]{2})[01]+$/, '$1')))) entry.flagsLeftChanged = true;
            }
        }
        // Locators and cycle belong to the prepared context of the following commands.
        if (after.transport.left !== '2. 1. 1.  0' || after.transport.right !== '3. 1. 1.  0' || after.transport.cycle) {
            await call('cubase_locator_set', { display: 'primary', locator: 'cycleLeft', time: '2.1.1.0' }).catch(() => {});
            await call('cubase_locator_set', { display: 'primary', locator: 'cycleRight', time: '3.1.1.0' }).catch(() => {});
            if (after.transport.cycle && !before.transport.cycle) await call('cubase_transport_set', { field: 'cycle', value: false }).catch(() => {});
            entry.locatorsRestored = true;
        }
        if (context === 'muted') await setChannel('Keys', 'mute', false).catch(() => {});
        if (context === 'soloed') await setChannel('Low', 'solo', false).catch(() => {});
        return entry;
    }

    async function undoRedoSequence() {
        await prepare('events');
        const before = await observe(true);
        const removed = await execute('edit.delete');
        const afterDelete = await observe(true);
        const undo = await execute('edit.undo');
        const afterUndo = await observe(true);
        const redo = await execute('edit.redo');
        const afterRedo = await observe(true);
        const undoAgain = await execute('edit.undo');
        const final = await observe(true);
        const windows = await unexpected();
        record({ step: 'command', round, key: 'edit.undo', context: 'after edit.delete', ...undo, unexpectedWindows: windows,
            outcome: afterDelete.midi.digest !== before.midi.digest && afterUndo.midi.digest === before.midi.digest ? 'effect_observed' : 'submitted',
            changes: ['midi'], before: { midi: afterDelete.midi.text }, after: { midi: afterUndo.midi.text } });
        record({ step: 'command', round, key: 'edit.redo', context: 'after edit.undo', ...redo, unexpectedWindows: windows,
            outcome: afterRedo.midi.digest === afterDelete.midi.digest && afterRedo.midi.digest !== afterUndo.midi.digest ? 'effect_observed' : 'submitted',
            changes: ['midi'], before: { midi: afterUndo.midi.text }, after: { midi: afterRedo.midi.text }, restoredAfterSecondUndo: final.midi.digest === before.midi.digest, deleteStep: removed, secondUndo: undoAgain });
        process.stdout.write(`edit.undo/edit.redo: delete ${before.midi.text} -> ${afterDelete.midi.text}; undo restored=${afterUndo.midi.digest === before.midi.digest}; redo repeated=${afterRedo.midi.digest === afterDelete.midi.digest}; final restored=${final.midi.digest === before.midi.digest}\n`);
    }

    // Markers have no direct read-back; locating to them moves the cursor, which is observable.
    async function markerSequence(keys) {
        const position = async () => (await transportState()).position;
        const run = async (key, expectation) => {
            const from = await position();
            const executed = await execute(key);
            await sleep(300);
            const to = await position(), windows = await unexpected();
            const entry = { step: 'command', round, key, context: 'marker sequence', ...executed, unexpectedWindows: windows, before: { position: from }, after: { position: to },
                changes: from !== to ? ['transport.position'] : [], expected: expectation || null,
                outcome: !executed.performable ? 'not_performable' : windows.length ? 'dialog' : expectation ? (to === expectation ? 'effect_observed' : 'submitted') : (executed.bindingObserved ? 'submitted' : 'binding_not_observed') };
            record(entry);
            process.stdout.write(`${key}: ${entry.outcome} ${from} -> ${to}${expectation ? ' (expected ' + expectation + ')' : ''}${windows.length ? ' WINDOWS [' + windows.join(' | ') + ']' : ''}\n`);
            return entry;
        };
        const bar = number => `${number}. 1. 1.  0`;
        const goto = async number => { await action('returnToZero'); for (let step = 1; step < number; step++) await action('stepBar'); };
        const wanted = key => !keys || keys.has(key);
        const entries = [];
        if (wanted('marker.insert')) {
            await goto(3); entries.push(await run('marker.insert'));
            await goto(4); await execute('marker.insert');
            await action('returnToZero'); entries.push(await run('marker.locateNext', bar(3)));
            entries.push(await run('marker.locateNext', bar(4)));
            entries.push(await run('marker.locatePrevious', bar(3)));
            const read = await midiState();
            record({ step: 'observation', round, note: 'MIDI content after two inserted markers', midi: read.text });
            // the first inserted marker proved itself when the cursor located to it
            if (entries[1].outcome === 'effect_observed') record({ step: 'command', round, key: 'marker.insert', context: 'marker sequence', performable: true, bindingObserved: entries[0].bindingObserved,
                outcome: 'effect_observed', changes: ['marker'], unexpectedWindows: [], after: { position: bar(3) } });
        }
        for (let number = 1; number <= 9; number++) {
            if (!wanted('marker.set' + number) && !wanted('marker.to' + number)) continue;
            await goto(number % 2 ? 2 : 4);
            entries.push(await run('marker.set' + number));
            await action('returnToZero');
            entries.push(await run('marker.to' + number, bar(number % 2 ? 2 : 4)));
        }
        if (wanted('marker.insertCycle')) entries.push(await run('marker.insertCycle'));
        return entries.some(entry => entry.outcome === 'dialog');
    }

    // The insert velocity presets have no read-back of their own; Fixed Velocity applies the selected preset
    // to the selected notes, which the written MIDI content shows.
    async function velocitySequence() {
        const velocities = async () => {
            const read = await call('cubase_midi_read', { noteLimit: 2000 });
            const low = read.tracks.find(track => track.name === 'Low');
            return low ? [...new Set(read.notes.filter(note => note.track === low.index).map(note => note.velocity))].sort((a, b) => a - b) : null;
        };
        const seen = [];
        for (let preset = 1; preset <= 5; preset++) {
            await prepare('events');
            const before = await velocities();
            const selected = await execute(`midi.insertVelocity.${preset}`);
            await prepare('events');
            const applied = await execute('midi.fixedVelocity');
            const after = await velocities(), windows = await unexpected();
            const undo = await execute('edit.undo');
            const restored = await velocities();
            seen.push(after && after.length === 1 ? after[0] : null);
            const entry = { step: 'command', round, key: `midi.insertVelocity.${preset}`, context: 'velocity sequence', ...selected, unexpectedWindows: windows,
                changes: JSON.stringify(before) !== JSON.stringify(after) ? ['midi'] : [], before: { velocities: before }, after: { velocities: after },
                undo: { ...undo, restored: JSON.stringify(restored) === JSON.stringify(before) } };
            entry.outcome = !selected.performable ? 'not_performable' : windows.length ? 'dialog' : after && after.length === 1 && seen.filter(value => value === after[0]).length === 1 && entry.changes.length ? 'effect_observed' : 'submitted';
            record(entry);
            process.stdout.write(`midi.insertVelocity.${preset}: ${entry.outcome} velocities ${JSON.stringify(before)} -> ${JSON.stringify(after)} undoRestored=${entry.undo.restored}\n`);
            if (preset === 5 || entry.outcome === 'effect_observed') {
                const fixed = { step: 'command', round, key: 'midi.fixedVelocity', context: 'velocity sequence', ...applied, unexpectedWindows: windows, changes: entry.changes,
                    before: { velocities: before }, after: { velocities: after }, undo: entry.undo,
                    outcome: !applied.performable ? 'not_performable' : windows.length ? 'dialog' : entry.changes.length ? 'effect_observed' : 'submitted' };
                if (fixed.outcome === 'effect_observed' || preset === 5) { record(fixed); process.stdout.write(`midi.fixedVelocity: ${fixed.outcome}\n`); }
            }
            if (windows.length || !entry.undo.restored) return true;
        }
        return false;
    }

    try {
        await client.connect(transport);
        let pendingFresh = true, audioTitle = null;
        const ordered = [...table.filter(item => !LATE.includes(item.key)), ...LATE.map(key => table.find(item => item.key === key)).filter(Boolean)]
            .filter(item => !SEQUENCED.has(item.key) && item.group !== 'marker' && (!only || (only.has(item.key) && !(only.has('midi.insertVelocity.1') && /^midi\.(insertVelocity|fixedVelocity)/.test(item.key)))) && !skip.has(item.key));
        let sequenced = (!only || only.has('edit.undo')) && !skip.has('edit.undo');
        if ((!only || [...only].some(key => /^marker\./.test(key))) && !skip.has('marker.insertCycle')) {
            audioTitle = await fresh(); pendingFresh = false;
            if (sequenced) { await undoRedoSequence(); sequenced = false; }
            pendingFresh = await markerSequence(only);
        }
        if (only && only.has('midi.insertVelocity.1')) {
            if (pendingFresh) { audioTitle = await fresh(); pendingFresh = false; }
            pendingFresh = await velocitySequence();
        }
        for (const definition of ordered) {
            if (pendingFresh) { audioTitle = await fresh(); pendingFresh = false; if (sequenced) { await undoRedoSequence(); sequenced = false; } }
            let entry;
            try {
                try { entry = await probe(definition); }
                catch (error) {
                    if (!error.drift) throw error;
                    record({ step: 'drift', round, key: definition.key, detail: String(error.message) });
                    audioTitle = await fresh();
                    entry = await probe(definition);
                }
            }
            catch (error) {
                entry = { step: 'command', round, key: definition.key, outcome: 'probe_error', error: String(error.message || error) };
                if (/MIDI_(FAULTED|TIMEOUT|CLOSED)/.test(entry.error)) { await raw('cubase_connection_reset', { confirmNoReplay: true }).catch(() => {}); await call('cubase_status').catch(() => {}); }
            }
            record(entry);
            process.stdout.write(`${definition.key}: ${entry.outcome}` + (entry.changes && entry.changes.length ? ` [${entry.changes.join(',')}]` : '') +
                (entry.outcome === 'effect_observed' && entry.changes.includes('midi') ? ` ${entry.before.midi} => ${entry.after.midi}` : '') +
                (entry.undo ? ` undoRestored=${entry.undo.restored}` : '') + (entry.toggledBack !== undefined ? ` toggledBack=${entry.toggledBack}` : '') +
                (entry.unexpectedWindows && entry.unexpectedWindows.length ? ` WINDOWS [${entry.unexpectedWindows.join(' | ')}]` : '') +
                (entry.error ? ` ${entry.error}` : '') + '\n');
            const blocked = (entry.unexpectedWindows && entry.unexpectedWindows.length) || (entry.unexpectedWindowsAfterUndo && entry.unexpectedWindowsAfterUndo.length);
            if (blocked || (entry.undo && !entry.undo.restored) || entry.flagsLeftChanged || entry.restoredByCommand === false || entry.outcome === 'probe_error') pendingFresh = true;
        }
        record({ step: 'done', audioTitle });
    } finally {
        fs.closeSync(fd);
        await client.close().catch(() => {});
        process.stdout.write('ledger ' + ledger + '\n');
    }
}

main().catch(error => { process.stderr.write(String(error && error.stack || error) + '\n'); process.exitCode = 1; });
