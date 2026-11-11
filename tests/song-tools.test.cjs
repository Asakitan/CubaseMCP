'use strict';

// MCP-level contract of the song tools: channel overview, transport, MIDI import/read and
// track edits. The bridge and the owned lifecycle are replaced by scripted stand-ins, so these
// tests fix what the server sends, in which order, and what it reports back.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Client, InMemoryTransport } = require('@modelcontextprotocol/client');
const lifecycle = require('../dist/src/lifecycle.js');
const { MidiClient, BridgeError } = require('../dist/src/midi.js');
const { EXPECTED_BRIDGE_REVISION } = require('../dist/src/bridge-contract.js');
const { createServer } = require('../dist/src/server.js');
const { parseSmf } = require('../dist/src/smf.js');
const { songToSmf } = require('../dist/src/song.js');

const status = { session: 'song', active: true, appVersion: '16.0.5', bridgeRevision: EXPECTED_BRIDGE_REVISION };

function channel(objectId, typeName, title, flags = {}) {
    const field = (tag, value) => ({ objectId, tag, value, display: String(value), writable: true });
    return { index: objectId, objectId, typeName, title, uniqueIdString: `uid-${objectId}`,
        fields: { name: field(1024, 1), selected: field(4000, flags.selected ? 1 : 0), mute: field(1027, flags.mute ? 1 : 0), solo: field(1028, 0) } };
}

// Runs one scenario against an in-memory server whose bridge and lifecycle are scripted.
async function withServer(script, action) {
    const original = { request: MidiClient.prototype.request, run: lifecycle.runLifecycle, windows: lifecycle.readOwnedWindows };
    const calls = [];
    MidiClient.prototype.request = async function (op, args) {
        calls.push({ op, args });
        if (op === 'bridge.status') return status;
        return script.bridge(op, args, calls);
    };
    lifecycle.runLifecycle = async (actionName, args) => {
        calls.push({ lifecycle: actionName, args });
        return script.lifecycle(actionName, args, calls);
    };
    lifecycle.readOwnedWindows = async () => {
        calls.push({ windows: true });
        return { pid: 1, sampledUtc: 'now', windows: script.windows ? script.windows() : [] };
    };
    const runtime = createServer(), client = new Client({ name: 'song-tools', version: '1' });
    const [left, right] = InMemoryTransport.createLinkedPair();
    const call = async (name, args) => {
        const response = await client.callTool({ name, arguments: args });
        const text = response.content.find(part => part.type === 'text').text;
        // A request that fails schema validation is refused by the MCP layer before any handler runs.
        try { return JSON.parse(text); } catch { return { ok: false, refusedByMcp: response.isError === true, text }; }
    };
    try {
        await Promise.all([runtime.server.connect(right), client.connect(left)]);
        await action(call, calls, client);
    } finally {
        await client.close(); await runtime.server.close(); runtime.close();
        MidiClient.prototype.request = original.request; lifecycle.runLifecycle = original.run; lifecycle.readOwnedWindows = original.windows;
    }
}

function temporaryProject() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'song-tools-'));
    return { directory, projectPath: path.join(directory, 'Song.cpr'),
        status: { ok: true, action: 'status', running: true, owned: true, pid: 7, managedProject: { projectPath: path.join(directory, 'Song.cpr') } },
        remove() { fs.rmSync(directory, { recursive: true, force: true }); } };
}

test('the server lists the song tools and none of them reaches for a window, a shell or input devices', async () => {
    await withServer({ bridge() { throw new Error('unexpected'); }, lifecycle() { throw new Error('unexpected'); } }, async (call, calls, client) => {
        const tools = (await client.listTools()).tools;
        assert.equal(tools.length, 53);
        assert.equal(tools.some(tool => tool.name === 'cubase_plugin_reset'), false);
        assert.equal(tools.some(tool => tool.name === 'cubase_track_create'), true);
        for (const name of ['cubase_channels_list', 'cubase_channel_set', 'cubase_transport_state', 'cubase_transport_set', 'cubase_transport_action',
            'cubase_track_edit', 'cubase_midi_import', 'cubase_midi_read', 'cubase_events_list', 'cubase_event_edit', 'cubase_midi_note_edit', 'cubase_audio_import', 'cubase_audio_export', 'cubase_runtime_windows', 'cubase_pages_list', 'cubase_page_activate',
            'cubase_command_get', 'cubase_plugin_unload', 'cubase_routes_list', 'cubase_routing_set',
            'cubase_automation_read', 'cubase_automation_edit']) assert.ok(tools.some(tool => tool.name === name), name);
        assert.ok(!tools.some(tool => /shell|keyboard|mouse|screenshot|eval|fallback|click/.test(tool.name)));
        const edit = tools.find(tool => tool.name === 'cubase_track_edit').inputSchema;
        assert.deepEqual(edit.properties.action.enum, ['duplicate', 'moveUp', 'moveDown', 'moveFirst', 'moveLast', 'clearEvents', 'remove']);
        // The raw command tool has no way to pass the composite marker.
        assert.equal(tools.find(tool => tool.name === 'cubase_command_execute').inputSchema.properties.tool, undefined);
        const invalid = await call('cubase_command_execute', { session: 'song', key: 'track.removeSelected', confirmCurrentSelection: true, tool: 'cubase_track_edit' });
        assert.equal(invalid.refusedByMcp, true);
        assert.deepEqual(calls, []);
    });
});

test('native mixer track creation deduplicates host channel identities and confirms the track', async () => {
    const project = temporaryProject();
    let created = false;
    try {
        await withServer({
            bridge(op) {
                if (op === 'transport.state') return { playing: false, recording: false };
                assert.equal(op, 'channels.list');
                const group = channel(12, 'GroupChannel', 'Bus');
                return { items: created ? [group, group] : [], nextOffset: null };
            },
            lifecycle(action, args) {
                if (action === 'status') return project.status;
                assert.equal(action, 'create_track');
                assert.deepEqual(args, { projectPath: project.projectPath, root: '0x1234', kind: 'group', name: 'Bus', confirmCreate: true });
                created = true;
                return { model: { added: [{ track: true, name: 'Bus' }] } };
            }
        }, async (call, calls) => {
            const args = { session: 'song', root: '0x1234', kind: 'group', name: 'Bus', confirmCreate: true };
            const result = await call('cubase_track_create', args);
            assert.equal(result.data.confirmed, true);
            assert.equal(result.data.channels.added.length, 1);
            assert.equal(calls.filter(entry => entry.lifecycle === 'create_track').length, 1);
            assert.equal((await call('cubase_track_create', { ...args, kind: 'unknown' })).refusedByMcp, true);
        });
    } finally { project.remove(); }
});

test('instrument creation requires its real track type while folders add no mixer channel', async () => {
    const project = temporaryProject();
    try {
        for (const kind of ['instrument', 'folder']) {
            let created = false;
            await withServer({
                bridge(op) {
                    if (op === 'transport.state') return { playing: false, recording: false };
                    assert.equal(op, 'channels.list');
                    return { items: created && kind === 'instrument' ? [channel(20, 'Synth', 'New')] : [], nextOffset: null };
                },
                lifecycle(action, args) {
                    if (action === 'status') return project.status;
                    assert.equal(action, 'create_track');
                    assert.equal(args.kind, kind);
                    created = true;
                    return { model: { added: [{ track: true, name: 'New', type: kind === 'instrument' ? 'MInstrumentTrackEvent' : 'MFolderTrack' }] } };
                }
            }, async (call) => {
                const result = await call('cubase_track_create', { session: 'song', root: '0x1234', kind, name: 'New', confirmCreate: true });
                assert.equal(result.data.confirmed, true);
                assert.equal(result.data.mixerConfirmed, kind === 'instrument' ? true : null);
                assert.equal(result.data.channels.added.length, kind === 'instrument' ? 1 : 0);
            });
        }
    } finally { project.remove(); }
});

test('send routing resolves the observed slot, guards its identity and uses independent parameter feedback', async () => {
    const project = temporaryProject();
    const source = channel(12, 'GroupChannel', 'Bus');
    try {
        await withServer({
            bridge(op, args) {
                if (op === 'channels.list') return { items: [source], nextOffset: null };
                if (op === 'transport.state') return { playing: false, recording: false };
                if (op === 'objects.list') return { items: args.parentId === 12
                    ? [{ objectId: 30, typeName: 'Sends', uniqueIdString: 'sends' }]
                    : [{ objectId: 31, typeName: 'Slot', uniqueIdString: 'slot-31' }] };
                if (op === 'parameters.list') return { items: [{ tag: 4099, locked: false }] };
                assert.equal(op, 'parameters.get');
                assert.equal(args.objectId, 31);
                assert.equal(args.tag, 4099);
                return { parameter: { value: 22, display: 'Return' } };
            },
            lifecycle(action, args) {
                if (action === 'status') return project.status;
                assert.equal(action, 'routing');
                assert.equal(args.objectId, 31);
                assert.equal(args.tag, 4099);
                return { model: { current: { id: 0, name: 'No Bus' }, confirmed: true } };
            }
        }, async (call, calls) => {
            const reference = { session: 'song', root: '0x1234', objectId: 12, expectedUniqueId: 'uid-12', field: 'send', sendIndex: 0 };
            const listed = await call('cubase_routes_list', reference);
            assert.equal(listed.data.sendSlot.uniqueIdString, 'slot-31');
            const args = { ...reference, expectedSlotUniqueId: 'slot-31', expectedValue: 0, targetId: 22, targetName: 'Return', confirmRouting: true };
            assert.equal((await call('cubase_routing_set', args)).data.confirmed, true);
            calls.length = 0;
            assert.equal((await call('cubase_routing_set', { ...args, expectedSlotUniqueId: 'stale' })).error.code, 'SLOT_CHANGED');
            assert.equal(calls.some(entry => entry.lifecycle === 'routing'), false);
        });
    } finally { project.remove(); }
});

test('native automation operations preserve exact point identity and reject incomplete requests without replay', async () => {
    const project = temporaryProject();
    let playing = false, unknown = false;
    const reference = { session: 'song', root: '0x1234', trackEventId: '0x2000' };
    const point = { laneEventId: '0x3000', parameterTag: 1025, pointEventId: '0x4000',
        expected: { pointCount: 5, startSeconds: 10, normalizedValue: 0.25 }, confirmEdit: true };
    try {
        await withServer({
            bridge(op) {
                if (op === 'objects.get') return { object: { uniqueIdString: 'uid-8' } };
                if (op === 'parameters.get') return { parameter: { automatable: true, locked: false } };
                assert.equal(op, 'transport.state'); return { playing, recording: false };
            },
            lifecycle(action, args) {
                if (action === 'status') return project.status;
                assert.equal(action, 'automation');
                assert.equal(args.projectPath, project.projectPath);
                assert.equal(args.root, reference.root);
                assert.equal(args.trackEventId, reference.trackEventId);
                if (unknown) throw new BridgeError('LIFECYCLE_RESULT_UNKNOWN', 'Host operation entered.', 'unknown');
                return { model: { confirmed: true, items: [], received: args } };
            }
        }, async (call, calls) => {
            const read = await call('cubase_automation_read', reference);
            assert.equal(read.data.received.automationAction, 'read');
            assert.equal(read.data.received.limit, 64);
            assert.equal(read.data.execution, undefined);
            calls.length = 0;
            for (const action of ['setValue', 'move', 'delete', 'insert', 'createLane']) {
                const args = { ...reference, ...point, action };
                if (action === 'insert') { delete args.pointEventId; args.expected = { pointCount: 5 }; }
                if (action === 'createLane') { delete args.pointEventId; delete args.laneEventId; args.expected = { laneCount: 1 }; args.objectId = 8; args.expectedUniqueId = 'uid-8'; }
                if (action === 'insert' || action === 'move') args.positionSeconds = 12;
                if (action === 'insert' || action === 'setValue') args.value = 0.6;
                const result = await call('cubase_automation_edit', args);
                assert.equal(result.data.confirmed, true);
                assert.equal(result.data.received.automationAction, action);
                assert.equal(result.data.received.expectedPointCount, action === 'createLane' ? 1 : 5);
                assert.equal(result.data.received.value, action === 'move' ? 12 : args.value);
            }
            assert.equal(calls.filter(entry => entry.lifecycle === 'automation').length, 5);
            calls.length = 0;
            const incomplete = await call('cubase_automation_edit', { ...reference, ...point, action: 'move' });
            assert.equal(incomplete.error.code, 'INVALID_ARGUMENT');
            assert.equal(calls.some(entry => entry.lifecycle), false);
            playing = true;
            assert.equal((await call('cubase_automation_edit', { ...reference, ...point, action: 'delete' })).error.code, 'TRANSPORT_RUNNING');
            assert.equal(calls.some(entry => entry.lifecycle === 'automation'), false);
            playing = false; unknown = true; calls.length = 0;
            const uncertain = await call('cubase_automation_edit', { ...reference, ...point, action: 'delete' });
            assert.equal(uncertain.error.execution, 'unknown');
            assert.equal(calls.filter(entry => entry.lifecycle === 'automation').length, 1);
        });
    } finally { project.remove(); }
});

test('native note edits keep exact identity and old values, reject invalid states and never replay an unknown result', async () => {
    const project = temporaryProject();
    const expected = { name: 'Note', pitch: 60, velocity: 96, channel: 0, velocityNormalized: 0.75, startSeconds: 0, durationSeconds: 2 };
    const args = { session: 'song', root: '0x1234', eventId: '0x5678', path: [2, 0, 1], expected, field: 'pitch', value: 62, confirmEdit: true };
    let playing = false, unknown = false;
    try {
        await withServer({
            bridge(op) { assert.equal(op, 'transport.state'); return { playing, recording: false }; },
            lifecycle(action, received) {
                if (action === 'status') return project.status;
                assert.equal(action, 'edit_event');
                assert.deepEqual(received, { projectPath: project.projectPath, root: args.root, eventId: args.eventId, path: args.path,
                    expected: { ...expected, type: 'MMidiNote' }, field: 'pitch', seconds: 62, confirmEdit: true });
                if (unknown) throw new BridgeError('LIFECYCLE_RESULT_UNKNOWN', 'Entered host setter.', 'unknown');
                return { model: { before: expected, after: { ...expected, pitch: 62 }, confirmed: true } };
            }
        }, async (call, calls) => {
            const edited = await call('cubase_midi_note_edit', args);
            assert.equal(edited.data.confirmed, true);
            assert.equal(edited.data.after.pitch, 62);
            assert.equal(calls.filter(entry => entry.lifecycle === 'edit_event').length, 1);
            calls.length = 0;
            for (const invalid of [{ field: 'pitch', value: 128 }, { field: 'pitch', value: 61.5 }, { field: 'velocity', value: 0 }, { field: 'duration', value: 0 }]) {
                assert.equal((await call('cubase_midi_note_edit', { ...args, ...invalid })).error.code, 'INVALID_ARGUMENT');
            }
            assert.equal((await call('cubase_midi_note_edit', { ...args, eventId: '0x0' })).refusedByMcp, true);
            assert.equal(calls.some(entry => entry.lifecycle), false);
            playing = true;
            assert.equal((await call('cubase_midi_note_edit', args)).error.code, 'TRANSPORT_RUNNING');
            assert.equal(calls.some(entry => entry.lifecycle === 'edit_event'), false);
            calls.length = 0; playing = false; unknown = true;
            const uncertain = await call('cubase_midi_note_edit', args);
            assert.equal(uncertain.error.execution, 'unknown');
            assert.equal(calls.filter(entry => entry.lifecycle === 'edit_event').length, 1);
            assert.equal(calls.some(entry => entry.op === 'commands.execute'), false);
        });
    } finally { project.remove(); }
});

test('control and command receipts report what the host confirmed inside the settle window', async () => {
    let revision = 3, events = 5, confirm = true;
    await withServer({
        bridge(op, args) {
            if (op === 'controls.set') return { session: 'song', key: args.key, execution: 'submitted', before: { value: 0.1, revision }, after: { value: 0.1, revision } };
            if (op === 'controls.get') { if (confirm) revision++; return { control: { key: args.key, observed: { value: confirm ? 0.5 : 0.1, revision }, display: '-6 dB' } }; }
            if (op === 'commands.execute') return { session: 'song', key: args.key, execution: 'submitted', bindingEventsBefore: events, bindingEvents: events };
            if (op === 'commands.get') { if (confirm) events++; return { command: { key: args.key, bindingEvents: events, canPerform: true } }; }
            throw new Error('unexpected ' + op);
        }, lifecycle() { throw new Error('unexpected'); }
    }, async (call, calls) => {
        const set = await call('cubase_control_set', { session: 'song', key: 'track.volume', value: 0.5 });
        assert.equal(set.data.confirmation.state, 'feedback_observed');
        assert.equal(set.data.confirmation.matchesRequest, true);
        // settleMs stays on the server; the bridge receives the request without it.
        assert.deepEqual(calls.find(entry => entry.op === 'controls.set').args, { session: 'song', key: 'track.volume', value: 0.5 });
        const run = await call('cubase_command_execute', { session: 'song', key: 'edit.undo', confirmCurrentSelection: true });
        assert.equal(run.data.bindingObserved, true);
        confirm = false;
        const unconfirmed = await call('cubase_control_set', { session: 'song', key: 'track.volume', value: 0.5, settleMs: 150 });
        assert.equal(unconfirmed.data.confirmation.state, 'not_observed');
        const silent = await call('cubase_command_execute', { session: 'song', key: 'edit.undo', confirmCurrentSelection: true, settleMs: 150 });
        assert.equal(silent.data.bindingObserved, false);
        calls.length = 0;
        const plain = await call('cubase_control_set', { session: 'song', key: 'track.volume', value: 0.5, settleMs: 0 });
        assert.equal(plain.data.confirmation, undefined);
        assert.deepEqual(calls.map(entry => entry.op), ['bridge.status', 'controls.set']);
    });
});

test('channel and transport tools forward one bridge request and a transport action reads the state afterwards', async () => {
    await withServer({
        bridge(op, args) {
            if (op === 'channels.list') return { session: 'song', items: [channel(11, 'MidiChannel', 'Keys')], nextOffset: null };
            if (op === 'channels.set') return { session: 'song', execution: 'submitted', field: args.field };
            if (op === 'transport.state') return { session: 'song', playing: true, position: { primary: '2. 1. 1.  0' } };
            if (op === 'transport.set') return { session: 'song', execution: 'submitted', field: args.field };
            if (op === 'transport.action') return { session: 'song', execution: 'submitted', action: args.action, before: { playing: false } };
            throw new Error('unexpected ' + op);
        }, lifecycle() { throw new Error('unexpected'); }
    }, async (call, calls) => {
        assert.equal((await call('cubase_channels_list', { session: 'song' })).data.items[0].title, 'Keys');
        assert.deepEqual(calls.at(-1), { op: 'channels.list', args: { session: 'song', offset: 0, limit: 32 } });
        const write = { session: 'song', objectId: 11, expectedUniqueId: 'uid-11', field: 'name', value: 'Piano' };
        assert.equal((await call('cubase_channel_set', write)).ok, true);
        assert.deepEqual(calls.at(-1), { op: 'channels.set', args: write });
        assert.equal((await call('cubase_channel_set', { ...write, field: 'output', value: 1 })).refusedByMcp, true);
        assert.equal((await call('cubase_transport_set', { session: 'song', field: 'signature', value: '3/4' })).ok, true);
        assert.deepEqual(calls.at(-1), { op: 'transport.set', args: { session: 'song', field: 'signature', value: '3/4' } });
        calls.length = 0;
        const started = await call('cubase_transport_action', { session: 'song', action: 'start', settleMs: 0 });
        assert.deepEqual(calls.map(entry => entry.op), ['bridge.status', 'transport.action', 'transport.state']);
        assert.deepEqual([started.data.before.playing, started.data.after.playing, started.data.execution], [false, true, 'submitted']);
        calls.length = 0;
        assert.equal((await call('cubase_transport_action', { session: 'song', action: 'record' })).refusedByMcp, true);
        assert.deepEqual(calls, []);
    });
});

test('MIDI import writes the song with the project tempo, imports it once and reports the added channels', async () => {
    const project = temporaryProject();
    let imported = false;
    try {
        await withServer({
            bridge(op) {
                if (op === 'transport.state') return { session: 'song', tempo: { bpm: 96 }, signature: '3/4' };
                if (op === 'channels.list') return { session: 'song', nextOffset: null, items: imported
                    ? [channel(1, 'OutputChannel', 'Stereo Out'), channel(2, 'Synth', 'HSSE Main'), channel(3, 'MidiChannel', 'Keys')]
                    : [channel(1, 'OutputChannel', 'Stereo Out')] };
                throw new Error('unexpected ' + op);
            },
            lifecycle(action, args) {
                if (action === 'status') return project.status;
                assert.equal(action, 'import_midi');
                assert.equal(args.confirmImport, true);
                imported = true;
                return { ok: true, action, midiPath: args.midiPath, native: { stage: 'operation_succeeded', importValue: 1, succeeded: true } };
            }
        }, async (call, calls) => {
            const song = { tracks: [{ name: 'Keys', program: 4, notes: [{ pitch: 60, start: 0, duration: 1 }, { pitch: 64, start: 1.5, duration: 0.5, velocity: 80 }] }] };
            const both = await call('cubase_midi_import', { session: 'song', song, midiPath: 'E:\\x\\a.mid', confirmImport: true });
            assert.equal(both.error.code, 'INVALID_ARGUMENT');
            const neither = await call('cubase_midi_import', { session: 'song', confirmImport: true });
            assert.equal(neither.error.code, 'INVALID_ARGUMENT');
            const empty = await call('cubase_midi_import', { session: 'song', song: { tracks: [{ name: 'Nothing' }] }, confirmImport: true });
            assert.equal(empty.error.code, 'SMF_INVALID_INPUT');
            assert.equal(calls.some(entry => entry.lifecycle === 'import_midi'), false);
            calls.length = 0;
            const result = await call('cubase_midi_import', { session: 'song', song, confirmImport: true });
            assert.equal(result.ok, true, JSON.stringify(result));
            const source = result.data.source;
            assert.equal(path.dirname(source.path), path.join(project.directory, 'MCP MIDI'));
            assert.match(path.basename(source.path), /^import-\d{8}T\d{6}-[0-9a-f]{6}\.mid$/);
            assert.deepEqual([source.generated, source.summary.noteCount, source.summary.tracks[0].program], [true, 2, 4]);
            const model = parseSmf(fs.readFileSync(source.path));
            assert.deepEqual(model.timeSignatures, [{ ticks: 0, numerator: 3, denominator: 4 }]);
            assert.ok(Math.abs(model.tempos[0].bpm - 96) < 0.01);
            assert.deepEqual(model.notes.map(note => [note.pitch, note.startTicks, note.durationTicks, note.velocity]), [[60, 0, 480, 100], [64, 720, 240, 80]]);
            assert.deepEqual(result.data.channels, { before: 1, after: 3, added: [
                { objectId: 2, typeName: 'Synth', title: 'HSSE Main', uniqueIdString: 'uid-2', selected: false, mute: false, solo: false },
                { objectId: 3, typeName: 'MidiChannel', title: 'Keys', uniqueIdString: 'uid-3', selected: false, mute: false, solo: false }] });
            assert.equal(result.data.tempoAndSignatureApplied, false);
            assert.equal(result.data.native.importValue, 1);
            // Exactly one import, between the two channel listings.
            const order = calls.map(entry => entry.op || entry.lifecycle);
            assert.deepEqual(order, ['bridge.status', 'status', 'transport.state', 'channels.list', 'import_midi', 'bridge.status', 'channels.list']);
            assert.deepEqual(calls.find(entry => entry.lifecycle === 'import_midi').args, { midiPath: source.path, confirmImport: true });
            // An existing file is imported from where it is and summarised, not copied.
            const existing = path.join(project.directory, 'given.mid');
            fs.writeFileSync(existing, songToSmf(song).bytes);
            imported = false;
            const fromFile = await call('cubase_midi_import', { session: 'song', midiPath: existing, confirmImport: true });
            assert.deepEqual([fromFile.data.source.path, fromFile.data.source.generated, fromFile.data.source.summary.noteCount], [existing, false, 2]);
            const wrongType = await call('cubase_midi_import', { session: 'song', midiPath: path.join(project.directory, 'Song.cpr'), confirmImport: true });
            assert.equal(wrongType.error.code, 'INVALID_ARGUMENT');
        });
    } finally { project.remove(); }
});

test('MIDI import needs a managed project and never imports when none is active', async () => {
    await withServer({
        bridge(op) { throw new Error('unexpected ' + op); },
        lifecycle(action) { assert.equal(action, 'status'); return { ok: true, action, running: false, owned: false, managedProject: null }; }
    }, async (call, calls) => {
        const result = await call('cubase_midi_import', { session: 'song', song: { tracks: [{ notes: [{ pitch: 60, start: 0, duration: 1 }] }] }, confirmImport: true });
        assert.equal(result.error.code, 'NO_MANAGED_PROJECT');
        assert.deepEqual(calls.map(entry => entry.op || entry.lifecycle), ['bridge.status', 'status']);
    });
});

test('MIDI read executes the write command once and returns the notes of the file Cubase wrote', async () => {
    const project = temporaryProject();
    let events = 0, write = true;
    const written = songToSmf({ tracks: [{ name: 'Keys', notes: [{ pitch: 60, start: 0, duration: 1 }, { pitch: 67, start: 2, duration: 2 }] },
        { name: 'Low', channel: 1, program: 33, notes: [{ pitch: 36, start: 0.5, duration: 0.5 }], controlChanges: [{ controller: 7, value: 100, beat: 0 }] }] }, { bpm: 96, numerator: 4, denominator: 4 }).bytes;
    try {
        fs.writeFileSync(path.join(project.directory, 'Old.mid'), written);
        await withServer({
            bridge(op, args) {
                if (op === 'channels.list') return { session: 'song', nextOffset: null, items: [channel(3, 'MidiChannel', 'Keys'), channel(4, 'MidiChannel', 'Low'), channel(5, 'MidiChannel', 'Muted', { mute: true })] };
                if (op === 'commands.get') return { command: { key: args.key, canPerform: true, bindingEvents: events } };
                if (op === 'commands.execute') {
                    assert.deepEqual(args, { session: 'song', key: 'midi.writeFileToProjectFolder', confirmCurrentSelection: true });
                    events++;
                    if (write) fs.writeFileSync(path.join(project.directory, 'Song.mid'), written);
                    return { session: 'song', key: args.key, execution: 'submitted', bindingEventsBefore: events - 1, bindingEvents: events - 1 };
                }
                throw new Error('unexpected ' + op);
            },
            lifecycle(action) { assert.equal(action, 'status'); return project.status; }
        }, async (call, calls) => {
            const read = await call('cubase_midi_read', { session: 'song' });
            assert.equal(read.ok, true, JSON.stringify(read));
            assert.equal(read.data.file.path, path.join(project.directory, 'Song.mid'));
            assert.equal(read.data.command.bindingObserved, true);
            assert.deepEqual(read.data.tracks.map(track => [track.index, track.name, track.noteCount]), [[0, null, 0], [1, 'Keys', 2], [2, 'Low', 1]]);
            assert.deepEqual(read.data.notes, [
                { track: 1, channel: 0, pitch: 60, start: 0, duration: 1, velocity: 100 },
                { track: 2, channel: 1, pitch: 36, start: 0.5, duration: 0.5, velocity: 100 },
                { track: 1, channel: 0, pitch: 67, start: 2, duration: 2, velocity: 100 }]);
            assert.deepEqual(read.data.tempos, [{ beat: 0, bpm: 96 }]);
            assert.deepEqual(read.data.mutedChannels.map(item => item.title), ['Muted']);
            assert.equal(read.data.controlChanges, undefined);
            assert.equal(calls.filter(entry => entry.op === 'commands.execute').length, 1);
            const paged = await call('cubase_midi_read', { session: 'song', track: 2, noteLimit: 1, includeControllers: true });
            assert.deepEqual([paged.data.noteTotal, paged.data.notes.length, paged.data.controlChanges.length], [1, 1, 1]);
            // Nothing written: the submission is reported, never presented as a read.
            write = false;
            const missing = await call('cubase_midi_read', { session: 'song', timeoutMs: 500 });
            assert.equal(missing.error.code, 'MIDI_FILE_NOT_OBSERVED');
            assert.equal(missing.error.execution, 'submitted');
            assert.deepEqual(missing.error.details.mutedChannels.map(item => item.title), ['Muted']);
        });
    } finally { project.remove(); }
});

test('track removal selects exactly the channel, empties it and passes the composite marker', async () => {
    const project = temporaryProject();
    let selected = false, removed = false, events = 0, alert = false;
    try {
        await withServer({
            bridge(op, args) {
                if (op === 'channels.list') return { session: 'song', nextOffset: null, items: removed
                    ? [channel(3, 'MidiChannel', 'Keys', { selected: true })]
                    : [channel(3, 'MidiChannel', 'Keys'), channel(4, 'MidiChannel', 'Low', { selected })] };
                if (op === 'channels.set') { selected = true; return { session: 'song', execution: 'submitted' }; }
                // Nothing is selected for Delete on an empty track.
                if (op === 'commands.get') return { command: { key: args.key, canPerform: args.key !== 'edit.delete', bindingEvents: events } };
                if (op === 'commands.execute') {
                    events++;
                    if (args.key === 'track.removeSelected') { assert.equal(args.tool, 'cubase_track_edit'); removed = true; } else assert.equal(args.tool, undefined);
                    return { session: 'song', key: args.key, execution: 'submitted', bindingEventsBefore: events - 1, bindingEvents: events - 1 };
                }
                throw new Error('unexpected ' + op);
            },
            lifecycle(action) { assert.equal(action, 'status'); return project.status; },
            windows() { return alert ? [{ title: 'Cubase AI Project - Song', className: 'W' }, { title: 'Cubase AI', className: 'W' }] : [{ title: 'Cubase AI Project - Song', className: 'W' }, { title: 'Cubase AI Hub', className: 'W' }]; }
        }, async (call, calls) => {
            const stale = await call('cubase_track_edit', { session: 'song', objectId: 4, expectedUniqueId: 'uid-9', action: 'remove', confirmEdit: true });
            assert.equal(stale.error.code, 'CHANNEL_CHANGED');
            assert.equal(calls.some(entry => entry.op === 'channels.set' || entry.op === 'commands.execute'), false);
            calls.length = 0;
            const result = await call('cubase_track_edit', { session: 'song', objectId: 4, expectedUniqueId: 'uid-4', action: 'remove', confirmEdit: true });
            assert.equal(result.ok, true, JSON.stringify(result));
            assert.deepEqual(result.data.steps.map(step => [step.key, step.performed, step.bindingObserved]),
                [['edit.selectAllOnTracks', true, true], ['edit.delete', false, false], ['track.removeSelected', true, true]]);
            assert.equal(result.data.sequenceCompleted, true);
            assert.deepEqual(result.data.removed.map(item => item.title), ['Low']);
            assert.deepEqual([result.data.orderBefore, result.data.orderAfter], [['Keys', 'Low'], ['Keys']]);
            assert.deepEqual(result.data.windows, { observed: true, unexpected: [] });
            assert.equal(result.data.note, undefined);
            const executed = calls.filter(entry => entry.op === 'commands.execute').map(entry => entry.args.key);
            assert.deepEqual(executed, ['edit.selectAllOnTracks', 'track.removeSelected']);
            assert.ok(calls.findIndex(entry => entry.op === 'channels.set') < calls.findIndex(entry => entry.op === 'commands.execute'));
            // A prompt that the host opened is reported with the instruction to replace the instance.
            removed = false; selected = false; alert = true;
            const prompted = await call('cubase_track_edit', { session: 'song', objectId: 4, expectedUniqueId: 'uid-4', action: 'duplicate', confirmEdit: true });
            assert.deepEqual(prompted.data.windows.unexpected, [{ title: 'Cubase AI', className: 'W' }]);
            assert.match(prompted.data.note, /Replace the owned instance/);
        });
    } finally { project.remove(); }
});

test('a track edit runs no command when Cubase does not confirm the selection', async () => {
    await withServer({
        bridge(op) {
            if (op === 'channels.list') return { session: 'song', nextOffset: null, items: [channel(3, 'MidiChannel', 'Keys', { selected: true }), channel(4, 'MidiChannel', 'Low')] };
            if (op === 'channels.set') return { session: 'song', execution: 'submitted' };
            throw new Error('unexpected ' + op);
        }, lifecycle() { throw new Error('unexpected'); }
    }, async (call, calls) => {
        const result = await call('cubase_track_edit', { session: 'song', objectId: 4, expectedUniqueId: 'uid-4', action: 'duplicate', confirmEdit: true });
        assert.equal(result.error.code, 'SELECTION_NOT_CONFIRMED');
        assert.equal(result.error.execution, 'submitted');
        assert.deepEqual(result.error.details.selected.map(item => item.title), ['Keys']);
        assert.equal(calls.some(entry => entry.op === 'commands.execute' || entry.op === 'commands.get'), false);
    });
});

test('the window sample separates the project window and the Hub from anything else', async () => {
    const project = temporaryProject();
    try {
        await withServer({
            bridge(op) { throw new Error('unexpected ' + op); },
            lifecycle(action) { assert.equal(action, 'status'); return project.status; },
            windows() { return [{ title: 'Cubase AI 工程 - Song', className: 'SteinbergWindowClass' }, { title: 'Cubase AI Hub', className: 'SteinbergWindowClass' },
                { title: '添加轨道', className: 'SteinbergWindowClass' }]; }
        }, async (call, calls) => {
            const sample = await call('cubase_runtime_windows', {});
            assert.equal(sample.ok, true);
            assert.equal(sample.data.windows.length, 3);
            assert.deepEqual(sample.data.unexpected, [{ title: '添加轨道', className: 'SteinbergWindowClass' }]);
            assert.equal(sample.data.project, project.projectPath);
            assert.equal(calls.some(entry => entry.op), false);
        });
    } finally { project.remove(); }
});

function smallWav(seconds = 0.5, level = 0.25) {
    const rate = 8000, frames = Math.round(rate * seconds), data = Buffer.alloc(frames * 2);
    for (let frame = 0; frame < frames; frame++) data.writeInt16LE(Math.round(level * 32767 * Math.sin(frame / 5)), frame * 2);
    const header = Buffer.alloc(44);
    header.write('RIFF', 0, 'latin1'); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8, 'latin1');
    header.write('fmt ', 12, 'latin1'); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
    header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
    header.write('data', 36, 'latin1'); header.writeUInt32LE(data.length, 40);
    return Buffer.concat([header, data]);
}

test('audio import preserves its source, copies into the managed project and calls the native operation once', async () => {
    const project = temporaryProject(), source = path.join(project.directory, 'Reference.wav');
    const bytes = smallWav();
    fs.writeFileSync(source, bytes);
    writeProjectFile(project, 8000);                       // the saved project runs at the rate of the source
    let imported = false;
    try {
        await withServer({
            bridge(op, args) {
                if (op === 'transport.state') return { playing: false, recording: false };
                if (op === 'transport.time') { assert.equal(args.time, '5.1.1.0'); return { execution: 'submitted' }; }
                if (op === 'channels.list') return { nextOffset: null, items: [channel(1, 'OutputChannel', 'Stereo Out'),
                    ...(imported ? [channel(2, 'AudioChannel', 'Reference')] : [])] };
                if (op === 'channels.set') { assert.equal(args.expectedUniqueId, 'uid-2'); return { after: { display: args.value } }; }
                throw new Error('unexpected ' + op);
            },
            lifecycle(action, args) {
                if (action === 'status') return project.status;
                assert.equal(action, 'import_audio');
                assert.equal(args.confirmImport, true);
                assert.equal(path.dirname(args.audioPath), path.join(project.directory, 'Audio'));
                assert.deepEqual(fs.readFileSync(args.audioPath), bytes);
                imported = true;
                return { ok: true, native: { importReturned: true, audioClips: 1 } };
            }
        }, async (call, calls) => {
            const reply = await call('cubase_audio_import', { session: 'song', audioPath: source, position: '5.1.1.0', trackName: 'Imported Audio', confirmImport: true });
            assert.equal(reply.ok, true, JSON.stringify(reply));
            assert.deepEqual(fs.readFileSync(source), bytes);
            assert.equal(reply.data.source.audio.sampleRate, 8000);
            assert.equal(reply.data.channels.added[0].typeName, 'AudioChannel');
            assert.equal(reply.data.renamed.after.display, 'Imported Audio');
            assert.equal(calls.filter(entry => entry.lifecycle === 'import_audio').length, 1);
            assert.equal(calls.some(entry => /^commands\./.test(entry.op || '')), false);
        });
    } finally { project.remove(); }
});

// A saved project carries its sample rate 72 bytes after the name of its setup record (src/project-rate.ts).
function writeProjectFile(project, rate) {
    const bytes = Buffer.alloc(400);
    bytes.write('PArrangeSetup\0', 100, 'latin1');
    bytes.writeFloatBE(rate, 172);
    bytes.writeUInt32BE(24, 176);
    fs.writeFileSync(project.projectPath, bytes);
}

function importScript(project, seen) {
    let imported = false;
    return {
        bridge(op) {
            if (op === 'transport.state') return { playing: false, recording: false };
            if (op === 'channels.list') return { nextOffset: null, items: [channel(1, 'OutputChannel', 'Stereo Out'),
                ...(imported ? [channel(2, 'AudioChannel', 'Layer')] : [])] };
            throw new Error('unexpected ' + op);
        },
        lifecycle(action, args) {
            if (action === 'status') return project.status;
            assert.equal(action, 'import_audio');
            seen.push(args.audioPath);
            imported = true;
            return { ok: true, native: { importReturned: true, audioClips: 1 } };
        }
    };
}

test('audio at another sample rate than the project is converted before the host sees it', async () => {
    const project = temporaryProject(), source = path.join(project.directory, 'Layer.wav'), seen = [];
    const bytes = smallWav(0.5);                                   // 8000 Hz, 4000 frames
    fs.writeFileSync(source, bytes);
    writeProjectFile(project, 16000);
    try {
        await withServer(importScript(project, seen), async (call) => {
            const reply = await call('cubase_audio_import', { session: 'song', audioPath: source, confirmImport: true });
            assert.equal(reply.ok, true, JSON.stringify(reply));
            assert.deepEqual(fs.readFileSync(source), bytes);
            assert.equal(reply.data.sampleRate.source, 8000);
            assert.equal(reply.data.sampleRate.project, 16000);
            assert.equal(reply.data.sampleRate.check, 'converted');
            assert.equal(reply.data.sampleRate.conversion.frames, 8000);
            assert.equal(seen.length, 1);
            assert.match(path.basename(seen[0]), /^Layer-[0-9a-f]{10}-16000Hz\.wav$/);
            const header = fs.readFileSync(seen[0]).subarray(0, 44);
            assert.equal(header.readUInt32LE(24), 16000);
            assert.equal(header.readUInt16LE(20), 3);                // IEEE float
        });
    } finally { project.remove(); }
});

test('a matching rate is copied unchanged, and the reject policy stops a mismatch before anything is written', async () => {
    const project = temporaryProject(), source = path.join(project.directory, 'Layer.wav'), seen = [];
    const bytes = smallWav(0.5);
    fs.writeFileSync(source, bytes);
    try {
        writeProjectFile(project, 8000);
        await withServer(importScript(project, seen), async (call) => {
            const reply = await call('cubase_audio_import', { session: 'song', audioPath: source, confirmImport: true });
            assert.equal(reply.data.sampleRate.check, 'match');
            assert.equal(reply.data.sampleRate.conversion, null);
            assert.deepEqual(fs.readFileSync(seen[0]), bytes);
        });
        writeProjectFile(project, 44100);
        await withServer(importScript(project, seen), async (call, calls) => {
            const before = fs.readdirSync(path.join(project.directory, 'Audio')).length;
            const reply = await call('cubase_audio_import', { session: 'song', audioPath: source, confirmImport: true, sampleRateMismatch: 'reject' });
            assert.equal(reply.ok, false);
            assert.equal(reply.error.code, 'AUDIO_SAMPLE_RATE_MISMATCH');
            assert.equal(reply.error.execution, 'not_started');
            assert.match(reply.error.message, /8000 Hz.*44100 Hz.*fast/);
            assert.equal(calls.some(entry => entry.lifecycle === 'import_audio'), false);
            assert.equal(fs.readdirSync(path.join(project.directory, 'Audio')).length, before);
            const ignored = await call('cubase_audio_import', { session: 'song', audioPath: source, confirmImport: true, sampleRateMismatch: 'ignore' });
            assert.equal(ignored.ok, true, JSON.stringify(ignored));
            assert.equal(ignored.data.sampleRate.check, 'imported_at_wrong_speed');
        });
    } finally { project.remove(); }
});

// The test-only native stand-in emits a file. No key command or window is an export backend.
function exportScript(project, options = {}) {
    const state = { transport: { playing: false, recording: false, cycleLeft: '1. 1. 1.  0', cycleRight: '1. 1. 1.  0', cycleDuration: '0. 0. 0.  0' }, promptOpen: !!options.promptOpen };
    return { state,
        bridge(op, args) {
            if (op === 'transport.state') return { session: 'song', ...state.transport };
            if (op === 'transport.time') {
                state.transport[args.locator] = args.time;
                if (args.locator === 'cycleRight') state.transport.cycleDuration = options.emptyRange ? '0. 0. 0.  0' : '8. 0. 0.  0';
                return { session: 'song', execution: 'submitted' };
            }
            throw new Error('unexpected ' + op);
        },
        lifecycle(action, args) {
            if (action === 'status') return project.status;
            assert.equal(action, 'export_audio');
            if (!options.writeNothing) {
                fs.mkdirSync(path.dirname(args.outputPath), { recursive: true });
                fs.writeFileSync(args.outputPath, smallWav(), { flag: 'wx' });
            }
            return { ok: true, native: { exportReturned: true, succeeded: true } };
        },
        windows() { return [{ title: 'Cubase AI Project - Song', className: 'W' },
            ...(state.promptOpen ? [{ title: 'Cubase AI', className: 'W' }] : [])]; } };
}

test('audio export passes an explicit native target and verifies the emitted format without commands or renames', async () => {
    const project = temporaryProject();
    try {
        fs.mkdirSync(path.join(project.directory, 'Mixdown'));
        fs.writeFileSync(path.join(project.directory, 'Mixdown', 'Song.wav'), smallWav(0.1));
        fs.writeFileSync(path.join(project.directory, 'Mixdown', 'Other.wav'), smallWav(0.1));
        const script = exportScript(project);
        await withServer(script, async (call, calls) => {
            const outputPath = path.join(project.directory, 'Rendered', 'Selected.wav');
            const result = await call('cubase_audio_export', { session: 'song', outputPath, sampleRate: 8000, bitDepth: 16,
                range: { left: '1.1.1.0', right: '9.1.1.0' }, confirmExport: true });
            assert.equal(result.ok, true, JSON.stringify(result));
            const data = result.data;
            assert.deepEqual(fs.readFileSync(path.join(project.directory, 'Mixdown', 'Song.wav')), smallWav(0.1));
            assert.ok(fs.existsSync(path.join(project.directory, 'Mixdown', 'Other.wav')));
            assert.equal(data.file.writtenAs, outputPath);
            assert.equal(data.file.renamed, false);
            assert.equal(data.file.path, outputPath);
            assert.equal(data.execution, 'completed');
            assert.deepEqual([data.audio.supported, data.audio.sampleRate, data.audio.channels, data.audio.bitsPerSample, data.audio.seconds, data.audio.silent], [true, 8000, 1, 16, 0.5, false]);
            assert.deepEqual(data.range, { left: '1.1.1.0', right: '9.1.1.0', duration: '8. 0. 0.  0' });
            assert.deepEqual(data.windows, { unexpected: [] });
            assert.equal(calls.some(entry => /^commands\./.test(entry.op || '')), false);
            assert.deepEqual(calls.filter(entry => entry.lifecycle === 'export_audio').map(entry => entry.args),
                [{ outputPath, sampleRate: 8000, bitDepth: 16, floatingPoint: false, confirmExport: true, timeoutMs: 180000 }]);
            assert.deepEqual(calls.filter(entry => entry.op === 'transport.time').map(entry => [entry.args.locator, entry.args.time, entry.args.display]),
                [['cycleLeft', '1.1.1.0', 'primary'], ['cycleRight', '9.1.1.0', 'primary']]);
            // Without a range the current locators are used and no locator is written.
            calls.length = 0;
            const again = await call('cubase_audio_export', { session: 'song', sampleRate: 8000, bitDepth: 16, confirmExport: true });
            assert.equal(again.ok, true, JSON.stringify(again));
            assert.notEqual(again.data.file.path, data.file.path);
            assert.equal(calls.some(entry => entry.op === 'transport.time'), false);
            assert.equal(again.data.archivedEarlierExports, undefined);
            calls.length = 0;
            const collision = await call('cubase_audio_export', { session: 'song', outputPath, confirmExport: true });
            assert.equal(collision.error.code, 'EXPORT_DESTINATION_EXISTS');
            assert.equal(calls.some(entry => entry.lifecycle === 'export_audio'), false);
        });
    } finally { project.remove(); }
});

test('audio export starts nothing while the transport runs, the range is empty or a host window is open', async () => {
    const project = temporaryProject();
    try {
        const running = exportScript(project);
        running.state.transport.playing = true;
        await withServer(running, async (call, calls) => {
            const result = await call('cubase_audio_export', { session: 'song', range: { left: '1.1.1.0', right: '9.1.1.0' }, confirmExport: true });
            assert.equal(result.error.code, 'TRANSPORT_RUNNING');
            assert.equal(calls.some(entry => entry.op === 'commands.execute' || entry.op === 'transport.time'), false);
        });
        await withServer(exportScript(project), async (call, calls) => {
            const result = await call('cubase_audio_export', { session: 'song', confirmExport: true });
            assert.equal(result.error.code, 'EXPORT_RANGE_EMPTY');
            assert.equal(result.error.execution, 'not_started');
            assert.equal(calls.some(entry => entry.op === 'commands.execute'), false);
        });
        await withServer(exportScript(project, { emptyRange: true }), async (call, calls) => {
            const result = await call('cubase_audio_export', { session: 'song', range: { left: '3.1.1.0', right: '3.1.1.0' }, confirmExport: true });
            assert.equal(result.error.code, 'EXPORT_RANGE_EMPTY');
            assert.equal(result.error.execution, 'submitted');
            assert.equal(calls.some(entry => entry.op === 'commands.execute'), false);
        });
        await withServer(exportScript(project, { promptOpen: true }), async (call, calls) => {
            const result = await call('cubase_audio_export', { session: 'song', range: { left: '1.1.1.0', right: '9.1.1.0' }, confirmExport: true });
            assert.equal(result.error.code, 'HOST_WINDOW_OPEN');
            assert.deepEqual(result.error.details.unexpected, [{ title: 'Cubase AI', className: 'W' }]);
            assert.equal(calls.some(entry => entry.op === 'commands.execute' || entry.op === 'transport.time'), false);
        });
        assert.equal(fs.existsSync(path.join(project.directory, 'Mixdown')), false);
    } finally { project.remove(); }
});

test('audio export refuses metadata mismatch and missing output without replay', async () => {
    const project = temporaryProject();
    try {
        await withServer(exportScript(project), async (call, calls) => {
            const result = await call('cubase_audio_export', { session: 'song', range: { left: '1.1.1.0', right: '9.1.1.0' }, confirmExport: true });
            assert.equal(result.error.code, 'EXPORT_SETTINGS_NOT_OBSERVED');
            assert.equal(result.error.execution, 'submitted');
            assert.equal(result.error.details.audio.sampleRate, 8000);
            assert.equal(calls.filter(entry => entry.lifecycle === 'export_audio').length, 1);
            assert.equal(calls.some(entry => /^commands\./.test(entry.op || '')), false);
        });
        await withServer(exportScript(project, { writeNothing: true }), async (call, calls) => {
            const result = await call('cubase_audio_export', { session: 'song', range: { left: '1.1.1.0', right: '9.1.1.0' }, confirmExport: true, timeoutMs: 5000 });
            assert.equal(result.error.code, 'EXPORT_FILE_NOT_OBSERVED');
            assert.equal(result.error.execution, 'submitted');
            assert.equal(calls.filter(entry => entry.lifecycle === 'export_audio').length, 1);
            assert.equal(calls.some(entry => /^commands\./.test(entry.op || '')), false);
        });
    } finally { project.remove(); }
});

test('an unreadable project rate stops the import unless the caller chooses to ignore the rate', async () => {
    const project = temporaryProject(), source = path.join(project.directory, 'Layer.wav'), seen = [];
    fs.writeFileSync(source, smallWav(0.5));
    try {
        fs.writeFileSync(project.projectPath, Buffer.alloc(64));     // a project file without the setup record
        await withServer(importScript(project, seen), async (call) => {
            for (const policy of ['convert', 'reject']) {
                const refused = await call('cubase_audio_import', { session: 'song', audioPath: source, confirmImport: true, sampleRateMismatch: policy });
                assert.equal(refused.ok, false);
                assert.equal(refused.error.code, 'AUDIO_SAMPLE_RATE_UNKNOWN');
                assert.equal(refused.error.execution, 'not_started');
            }
            assert.equal(seen.length, 0);
            assert.equal(fs.existsSync(path.join(project.directory, 'Audio')), false);
            const reply = await call('cubase_audio_import', { session: 'song', audioPath: source, confirmImport: true, sampleRateMismatch: 'ignore' });
            assert.equal(reply.ok, true, JSON.stringify(reply));
            assert.equal(reply.data.sampleRate.check, 'project_rate_unknown');
            assert.equal(seen.length, 1);
        });
    } finally { project.remove(); }
});

test('an import that adds no channel while the project holds 32 audio channels reports the Cubase AI track limit', async () => {
    const project = temporaryProject(), source = path.join(project.directory, 'Layer.wav'), seen = [];
    fs.writeFileSync(source, smallWav(0.5));
    writeProjectFile(project, 8000);
    const channels = [channel(1, 'OutputChannel', 'Stereo Out'), ...Array.from({ length: 32 }, (_, k) => channel(10 + k, 'AudioChannel', 'Audio ' + k))];
    try {
        await withServer({
            bridge(op) {
                if (op === 'transport.state') return { playing: false, recording: false };
                if (op === 'channels.list') return { nextOffset: null, items: channels };
                throw new Error('unexpected ' + op);
            },
            lifecycle(action, args) {
                if (action === 'status') return project.status;
                assert.equal(action, 'import_audio');
                seen.push(args.audioPath);
                return { ok: true, native: { importReturned: true, audioClips: 1 } };      // the host says yes and adds nothing
            }
        }, async (call) => {
            const reply = await call('cubase_audio_import', { session: 'song', audioPath: source, confirmImport: true });
            assert.equal(reply.ok, false);
            assert.equal(reply.error.code, 'AUDIO_TRACK_LIMIT_SUSPECTED');
            assert.equal(reply.error.execution, 'submitted');
            assert.equal(reply.error.details.audioChannelsBefore, 32);
            assert.match(reply.error.message, /32 audio tracks/);
            assert.equal(seen.length, 1);
        });
    } finally { project.remove(); }
});
