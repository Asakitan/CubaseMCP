'use strict';

const assert = require('node:assert/strict');
const { join } = require('node:path');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const { Client, InMemoryTransport } = require('@modelcontextprotocol/client');
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');
const { verifyBridge, inspectBridge, EXPECTED_BRIDGE_REVISION } = require('../dist/src/bridge-contract.js');
const { createServer } = require('../dist/src/server.js');
const { MidiClient } = require('../dist/src/midi.js');

test('all session operations reject an obsolete bridge before host dispatch', async () => {
    const original = MidiClient.prototype.request;
    const requests = [];
    MidiClient.prototype.request = async function (operation) {
        requests.push(operation);
        return operation === 'bridge.status'
            ? { session: 'old', appVersion: '16.0.5', active: true }
            : { execution: 'submitted' };
    };
    const runtime = createServer();
    const client = new Client({ name: 'bridge-gate-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const ref = { session: 'old', root: 'mixConsole', objectId: 1 };
    const cases = [
        ['cubase_host_info', { session: 'old' }],
        ['cubase_objects_list', { session: 'old', root: 'mixConsole' }],
        ['cubase_object_get', ref],
        ['cubase_mixer_channel_info', ref],
        ['cubase_parameters_list', ref],
        ['cubase_parameter_get', { ...ref, tag: 1 }],
        ['cubase_parameter_set', { ...ref, tag: 1, mode: 'normalized', value: 0.2 }],
        ['cubase_parameter_edit_lock_set', { ...ref, tag: 1, locked: true, expectedLocked: false }],
        ['cubase_plugins_list', ref],
        ['cubase_plugin_set', { ...ref, pluginUid: 'test', confirmReplacement: true }],
        ['cubase_controls_list', { session: 'old' }],
        ['cubase_control_get', { session: 'old', key: 'track.volume' }],
        ['cubase_control_set', { session: 'old', key: 'track.volume', value: 0.2 }],
        ['cubase_tempo_set', { session: 'old', bpm: 120 }],
        ['cubase_transport_get', { session: 'old' }],
        ['cubase_locator_set', { session: 'old', display: 'primary', locator: 'cursor', time: '1.1.1.0' }],
        ['cubase_commands_list', { session: 'old' }],
        ['cubase_command_execute', { session: 'old', key: 'edit.undo', confirmCurrentSelection: true }],
        ['cubase_project_save', { session: 'old', projectPath: 'E:\\VC\\CubaseMCP\\artifacts\\unopened.cpr', confirmCurrentProjectPath: true }],
        ['cubase_project_save_as', { session: 'old', projectPath: 'E:\\VC\\CubaseMCP\\artifacts\\new-save-as.cpr', confirmSaveAs: true }],
        ['cubase_selected_track', { session: 'old' }],
        ['cubase_track_navigate', { session: 'old', direction: 'next', expectedUniqueId: 'track' }],
        ['cubase_command_get', { session: 'old', key: 'edit.undo' }],
        ['cubase_pages_list', { session: 'old' }],
        ['cubase_page_activate', { session: 'old', page: 'mixer' }],
        ['cubase_channels_list', { session: 'old' }],
        ['cubase_channel_set', { session: 'old', objectId: 1, expectedUniqueId: 'uid', field: 'mute', value: true }],
        ['cubase_transport_state', { session: 'old' }],
        ['cubase_transport_set', { session: 'old', field: 'cycle', value: true }],
        ['cubase_transport_action', { session: 'old', action: 'stop' }],
        ['cubase_track_edit', { session: 'old', objectId: 1, expectedUniqueId: 'uid', action: 'duplicate', confirmEdit: true }],
        ['cubase_midi_import', { session: 'old', song: { tracks: [{ notes: [{ pitch: 60, start: 0, duration: 1 }] }] }, confirmImport: true }],
        ['cubase_midi_read', { session: 'old' }],
        ['cubase_audio_import', { session: 'old', audioPath: 'E:\\Audio\\source.wav', confirmImport: true }],
        ['cubase_events_list', { session: 'old' }],
        ['cubase_midi_note_edit', { session: 'old', root: '0x1234', eventId: '0x5678', path: [2, 0, 1], expected: { name: 'Note', pitch: 60, velocity: 96, channel: 0, velocityNormalized: 0.75, startSeconds: 0, durationSeconds: 2 }, field: 'pitch', value: 62, confirmEdit: true }],
        ['cubase_event_edit', { session: 'old', root: '0x1234', path: [0, 0], expected: { type: 'MAudioEvent', name: 'Audio', startSeconds: 0, durationSeconds: 1 }, field: 'position', seconds: 2, confirmEdit: true }],
        ['cubase_audio_export', { session: 'old', confirmExport: true }]
    ];
    try {
        await Promise.all([runtime.server.connect(serverTransport), client.connect(clientTransport)]);
        for (const [name, args] of cases) {
            requests.length = 0;
            const response = await client.callTool({ name, arguments: args });
            assert.equal(response.isError, true, name);
            const body = JSON.parse(response.content.find(part => part.type === 'text').text);
            assert.equal(body.error.code, 'BRIDGE_UPGRADE_REQUIRED', name);
            assert.equal(body.error.execution, 'not_started', name);
            assert.deepEqual(requests, ['bridge.status'], name);
        }
    } finally {
        await client.close();
        await runtime.server.close();
        runtime.close();
        MidiClient.prototype.request = original;
    }
});

test('bridge contract rejects old scripts, inactive mappings and stale sessions', () => {
    const current = { appVersion: '16.0.5', active: true, session: 'new', bridgeRevision: EXPECTED_BRIDGE_REVISION };
    assert.throws(() => verifyBridge({ ...current, bridgeRevision: undefined }, 'new'),
        { code: 'BRIDGE_UPGRADE_REQUIRED', execution: 'not_started' });
    assert.throws(() => verifyBridge({ ...current, active: false }, 'new'),
        { code: 'BRIDGE_INACTIVE', execution: 'not_started' });
    assert.throws(() => verifyBridge({ ...current, appVersion: '15.0.5' }, 'new'),
        { code: 'HOST_VERSION_MISMATCH', execution: 'not_started' });
    assert.throws(() => verifyBridge(current, 'old'),
        { code: 'STALE_SESSION', execution: 'not_started' });
    assert.doesNotThrow(() => verifyBridge(current, 'new'));
    assert.equal(inspectBridge(current).readyForOperations, true);
    assert.equal(inspectBridge({ ...current, bridgeRevision: undefined }).readyForOperations, false);
    assert.equal(inspectBridge(null).readyForOperations, false);
    const remoteSource = readFileSync(join(__dirname, '../remote/controller.js'), 'utf8');
    assert.ok(remoteSource.includes(`var BRIDGE_REVISION = '${EXPECTED_BRIDGE_REVISION}';`));
});

test('MCP Save uses the prepared input route rather than the legacy surface pulse', async () => {
    const originalRequest = MidiClient.prototype.request, originalSave = MidiClient.prototype.executeSave;
    const calls = [];
    MidiClient.prototype.request = async function (op) {
        calls.push(op);
        if (op !== 'bridge.status') throw new Error('Unexpected legacy request');
        return { session: 'save', active: true, appVersion: '16.0.5', bridgeRevision: EXPECTED_BRIDGE_REVISION };
    };
    MidiClient.prototype.executeSave = async function (args) { calls.push({ save: args }); return { execution: 'submitted', bindingObserved: true }; };
    const runtime = createServer(), client = new Client({ name: 'save-route-test', version: '1' });
    const [left, right] = InMemoryTransport.createLinkedPair();
    try {
        await Promise.all([runtime.server.connect(right), client.connect(left)]);
        const args = { session: 'save', key: 'project.save', confirmCurrentSelection: true };
        const response = await client.callTool({ name: 'cubase_command_execute', arguments: args });
        assert.notEqual(response.isError, true);
        assert.deepEqual(calls, ['bridge.status', { save: args }]);
    } finally {
        await client.close(); await runtime.server.close(); runtime.close();
        MidiClient.prototype.request = originalRequest; MidiClient.prototype.executeSave = originalSave;
    }
});

test('MCP forwards selected-channel runtime guards to the current bridge', async () => {
    const original = MidiClient.prototype.request;
    const requests = [];
    MidiClient.prototype.request = async function (operation, args) {
        requests.push({ operation, args });
        return operation === 'bridge.status'
            ? { session: 'current', appVersion: '16.0.5', active: true, bridgeRevision: EXPECTED_BRIDGE_REVISION }
            : { execution: 'submitted' };
    };
    const runtime = createServer();
    const client = new Client({ name: 'runtime-guard-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
        await Promise.all([runtime.server.connect(serverTransport), client.connect(clientTransport)]);
        const control = { session: 'current', key: 'track.volume', value: 0.5,
            expectedTrackUniqueId: 'track', expectedTrackRuntimeId: 7 };
        assert.equal((await client.callTool({ name: 'cubase_control_set', arguments: { ...control, settleMs: 0 } })).isError, undefined);
        assert.deepEqual(requests.at(-1), { operation: 'controls.set', args: control });
        const plugin = { ...control, key: 'track.instrument.parameter.0', expectedPluginIdentity: {
            name: 'Synth', vendor: 'Vendor', version: '1', formatVersion: '3' } };
        assert.equal((await client.callTool({ name: 'cubase_control_set', arguments: { ...plugin, settleMs: 0 } })).isError, undefined);
        assert.deepEqual(requests.at(-1), { operation: 'controls.set', args: plugin });
        const editLock = { session: 'current', root: 'trackSelection', objectId: 2, tag: 101,
            locked: true, expectedLocked: false };
        assert.equal((await client.callTool({ name: 'cubase_parameter_edit_lock_set', arguments: editLock })).isError, undefined);
        assert.deepEqual(requests.at(-1), { operation: 'parameters.lock', args: editLock });
        const navigation = { session: 'current', direction: 'next', expectedUniqueId: 'track', expectedRuntimeId: 7 };
        assert.equal((await client.callTool({ name: 'cubase_track_navigate', arguments: navigation })).isError, undefined);
        assert.deepEqual(requests.at(-1), { operation: 'track.navigate', args: navigation });
        const before = requests.length;
        const invalid = await client.callTool({ name: 'cubase_control_set', arguments: { ...control, expectedTrackRuntimeId: -1 } });
        assert.equal(invalid.isError, true);
        assert.equal(requests.length, before);
        const invalidPlugin = await client.callTool({ name: 'cubase_control_set', arguments: {
            ...plugin, expectedPluginIdentity: { ...plugin.expectedPluginIdentity, extra: 'unexpected' } } });
        assert.equal(invalidPlugin.isError, true);
        assert.equal(requests.length, before);
        const invalidLock = await client.callTool({ name: 'cubase_parameter_edit_lock_set', arguments: {
            ...editLock, expectedLocked: 'false' } });
        assert.equal(invalidLock.isError, true);
        assert.equal(requests.length, before);
    } finally {
        await client.close();
        await runtime.server.close();
        runtime.close();
        MidiClient.prototype.request = original;
    }
});

test('real stdio server exposes tools and rejects missing MIDI without fallback', async () => {
    const root = join(__dirname, '..');
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [join(root, 'dist/src/server.js')],
        env: {
            ...process.env,
            CUBASE_ADAPTER: 'midi',
            CUBASE_MCP_CONFIG: join(root, 'cubase.config.json'),
            CUBASE_MIDI_INPUT: 'Cubase MCP missing test input 31fbd028',
            CUBASE_MIDI_OUTPUT: 'Cubase MCP missing test output 31fbd028'
        },
        stderr: 'pipe'
    });
    const client = new Client({ name: 'cubase-mcp-smoke', version: '1.0.0' });
    const diagnostics = [];
    transport.stderr?.on('data', chunk => diagnostics.push(String(chunk)));
    try {
        await client.connect(transport);
        const listed = await client.listTools();
        assert.equal(listed.tools.length, 53);
        assert.ok(listed.tools.some(tool => tool.name === 'cubase_parameter_set'));
        assert.ok(listed.tools.some(tool => tool.name === 'cubase_parameter_get'));
        assert.ok(listed.tools.some(tool => tool.name === 'cubase_parameter_edit_lock_set'));
        assert.ok(listed.tools.some(tool => tool.name === 'cubase_track_navigate'));
        assert.ok(listed.tools.some(tool => tool.name === 'cubase_transport_get'));
        assert.ok(listed.tools.some(tool => tool.name === 'cubase_mixer_channel_info'));
        assert.ok(listed.tools.some(tool => tool.name === 'cubase_control_get'));
        assert.ok(listed.tools.some(tool => tool.name === 'cubase_host_info'));
        const parameterSchema = listed.tools.find(tool => tool.name === 'cubase_parameter_set').inputSchema;
        assert.equal(parameterSchema.properties.tag.minimum, -2147483648);
        assert.ok(!listed.tools.some(tool => /shell|keyboard|mouse|screenshot|eval|fallback/.test(tool.name)));
        const resource = await client.readResource({ uri: 'cubase://constraints' });
        const policy = JSON.parse(resource.contents[0].text);
        assert.equal(policy.fallback, false);
        assert.equal(policy.backgroundOnly, true);
        assert.equal(policy.fullCubaseCoverage, false);
        const response = await client.callTool({ name: 'cubase_status', arguments: {} });
        assert.equal(response.isError, true);
        const body = JSON.parse(response.content.find(part => part.type === 'text').text);
        assert.equal(body.ok, false);
        assert.match(body.error.code, /MIDI|PORT/);
        assert.notEqual(body.error.execution, 'submitted');
        const invalid = await client.callTool({
            name: 'cubase_control_set', arguments: { session: 'invalid', key: 'track.volume', value: 2 }
        });
        assert.equal(invalid.isError, true);
    } finally {
        await client.close();
    }
});
