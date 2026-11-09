'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { Client, InMemoryTransport } = require('@modelcontextprotocol/client');
const lifecycle = require('../dist/src/lifecycle.js');
const { MidiClient } = require('../dist/src/midi.js');
const { EXPECTED_BRIDGE_REVISION } = require('../dist/src/bridge-contract.js');
const { createServer } = require('../dist/src/server.js');

test('lifecycle tools use the explicit initializer and one new-host handshake without Save replay', async () => {
    const originalRun = lifecycle.runLifecycle, originalRequest = MidiClient.prototype.request;
    const calls = [];
    lifecycle.runLifecycle = async (action, args) => {
        calls.push({ action, args });
        return { ok: true, action, owned: true, managedProject: { projectPath: args.projectPath } };
    };
    MidiClient.prototype.request = async function (op) {
        calls.push({ op });
        assert.equal(op, 'bridge.status');
        return { session: 'new-runtime', active: true, appVersion: '16.0.5', bridgeRevision: EXPECTED_BRIDGE_REVISION };
    };
    const runtime = createServer(), client = new Client({ name: 'lifecycle-contract', version: '1' });
    const [left, right] = InMemoryTransport.createLinkedPair();
    const body = response => JSON.parse(response.content.find(p => p.type === 'text').text);
    try {
        await Promise.all([runtime.server.connect(right), client.connect(left)]);
        assert.equal((await client.listTools()).tools.length, 30);
        const status = body(await client.callTool({ name: 'cubase_runtime_status', arguments: {} }));
        assert.equal(status.ok, true);
        assert.deepEqual(calls, [{ action: 'status', args: {} }]); calls.length = 0;
        const args = { projectPath: 'E:\\Projects\\New\\Song.cpr', replaceCurrent: true, confirmDiscardChanges: true };
        const created = body(await client.callTool({ name: 'cubase_project_create', arguments: args }));
        assert.equal(created.data.host.session, 'new-runtime');
        assert.deepEqual(calls, [{ action: 'create', args }, { op: 'bridge.status' }]); calls.length = 0;
        const opened = body(await client.callTool({ name: 'cubase_project_open', arguments: args }));
        assert.equal(opened.data.host.session, 'new-runtime');
        assert.deepEqual(calls, [{ action: 'open', args }, { op: 'bridge.status' }]); calls.length = 0;
        const asArgs = { session: 'new-runtime', projectPath: 'E:\\Projects\\New\\Other.cpr', confirmSaveAs: true };
        const saved = body(await client.callTool({ name: 'cubase_project_save_as', arguments: asArgs }));
        assert.equal(saved.data.host.session, 'new-runtime');
        assert.deepEqual(calls, [{ op: 'bridge.status' }, { action: 'save_as', args: asArgs }, { op: 'bridge.status' }]); calls.length = 0;
        const stopped = body(await client.callTool({ name: 'cubase_runtime_stop', arguments: { confirmDiscardChanges: true } }));
        assert.equal(stopped.ok, true);
        assert.deepEqual(calls, [{ action: 'stop', args: { confirmDiscardChanges: true } }]);
    } finally {
        await client.close(); await runtime.server.close(); runtime.close();
        lifecycle.runLifecycle = originalRun; MidiClient.prototype.request = originalRequest;
    }
});
