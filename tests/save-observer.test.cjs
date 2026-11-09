'use strict';

const assert = require('node:assert/strict');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { dirname, join, resolve } = require('node:path');
const { Client, InMemoryTransport } = require('@modelcontextprotocol/client');
const test = require('node:test');
const { MidiClient } = require('../dist/src/midi.js');
const { EXPECTED_BRIDGE_REVISION } = require('../dist/src/bridge-contract.js');
const { createServer } = require('../dist/src/server.js');

test('observed MCP Save admits its file before one mutation and distinguishes changed from unchanged bytes', async () => {
    const { mkdir } = require('node:fs/promises');
    const parent = join(__dirname, '../artifacts/scratch-temp');
    await mkdir(parent, { recursive: true });
    const directory = await mkdtemp(join(parent, 'save-observer-'));
    const projectPath = join(directory, 'owned.cpr');
    const originalRequest = MidiClient.prototype.request, originalSave = MidiClient.prototype.executeSave;
    const before = Buffer.from('RIFF1234NUNDoriginal'), after = Buffer.from('RIFF1234NUNDsaved-content');
    let writes = 0, mutate = true;
    MidiClient.prototype.request = async function (op) {
        assert.equal(op, 'bridge.status');
        return { session: 'save', active: true, appVersion: '16.0.5', bridgeRevision: EXPECTED_BRIDGE_REVISION };
    };
    MidiClient.prototype.executeSave = async function (args) {
        assert.deepEqual(args, { session: 'save', key: 'project.save', confirmCurrentSelection: true });
        writes++;
        if (mutate) await writeFile(projectPath, after);
        return { session: 'returned', execution: 'submitted', bindingObserved: true };
    };
    const runtime = createServer(), client = new Client({ name: 'observed-save-test', version: '1' });
    const [left, right] = InMemoryTransport.createLinkedPair();
    const call = path => client.callTool({ name: 'cubase_project_save', arguments: {
        session: 'save', projectPath: path, confirmCurrentProjectPath: true, observationTimeoutMs: 650
    } });
    const body = response => JSON.parse(response.content.find(part => part.type === 'text').text);
    try {
        await writeFile(projectPath, before);
        await Promise.all([runtime.server.connect(right), client.connect(left)]);
        assert.equal((await client.listTools()).tools.length, 25);
        const changed = body(await call(projectPath));
        assert.equal(changed.ok, true);
        assert.equal(changed.data.file.state, 'changed_stable');
        assert.equal(changed.data.save.session, 'returned');
        assert.equal(changed.data.semanticReopenVerified, false);
        assert.equal(writes, 1);
        mutate = false;
        const unchanged = body(await call(projectPath));
        assert.equal(unchanged.data.file.state, 'change_not_observed');
        assert.equal(unchanged.data.file.contentChanged, false);
        assert.equal(writes, 2);
        const invalid = body(await call(join(directory, 'missing.cpr')));
        assert.equal(invalid.ok, false);
        assert.equal(invalid.error.execution, 'not_started');
        assert.equal(writes, 2);
    } finally {
        await client.close(); await runtime.server.close(); runtime.close();
        MidiClient.prototype.request = originalRequest; MidiClient.prototype.executeSave = originalSave;
        assert.equal(dirname(directory), resolve(parent));
        await rm(directory, { recursive: true, force: true });
    }
});
