'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/client');
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');

async function main() {
    const label = process.argv[2];
    if (!/^[a-z0-9-]+$/.test(label || '')) throw new Error('Supply a unique evidence label.');
    const root = path.resolve(__dirname, '..');
    const evidence = fs.openSync(path.join(root, 'artifacts', 'ipc', `plugin-unload33-${label}.jsonl`), 'wx');
    const record = value => { fs.writeSync(evidence, JSON.stringify({ utc: new Date().toISOString(), ...value }) + '\n'); fs.fsyncSync(evidence); };
    const client = new Client({ name: 'plugin-unload33', version: '1' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dist/src/server.js')],
        env: { ...process.env, CUBASE_MCP_CONFIG: path.join(root, 'cubase.config.json') }, stderr: 'pipe' });
    transport.stderr.on('data', data => process.stderr.write(data));
    let session;
    async function call(name, args = {}) {
        const input = name === 'cubase_status' || name.startsWith('cubase_runtime_') ? args : { session, ...args };
        record({ stage: 'submit_once', name, arguments: input });
        const reply = await client.callTool({ name, arguments: input }, { timeout: 180000 });
        const body = reply.structuredContent || JSON.parse(reply.content.find(item => item.type === 'text').text);
        record({ stage: 'result', name, result: body });
        if (!body.ok) throw new Error(`${name}: ${body.error.code} ${body.error.message}`);
        if (typeof body.data.session === 'string') session = body.data.session;
        return body.data;
    }
    async function slots() {
        const channels = await call('cubase_channels_list', { limit: 32 });
        const channel = channels.items.find(item => item.typeName === 'GroupChannel' && item.title === 'Native33 MasterBus');
        if (!channel) throw new Error('The named owned Group fixture is absent.');
        const children = await call('cubase_objects_list', { root: 'mixConsole', parentId: channel.objectId, limit: 16 });
        const inserts = children.items.find(item => item.typeName === 'Inserts');
        if (!inserts) throw new Error('No insert container on the Group fixture.');
        return (await call('cubase_objects_list', { root: 'mixConsole', parentId: inserts.objectId, limit: 16 })).items;
    }
    try {
        await client.connect(transport);
        await call('cubase_status');
        const project = await call('cubase_events_list', { limit: 1 });
        let slot = (await slots())[0];
        if (!slot || slot.childCount !== 0) throw new Error('The first fixture slot is not empty; it was preserved.');
        let selected = null;
        for (let offset = 0; offset !== null && !selected;) {
            const page = await call('cubase_plugins_list', { root: 'mixConsole', objectId: slot.objectId, offset, limit: 64 });
            selected = page.items.find(item => item.name === 'MonoDelay') || null;
            offset = page.nextOffset;
        }
        if (!selected) throw new Error('MonoDelay is not offered for this slot.');
        await call('cubase_plugin_set', { root: 'mixConsole', objectId: slot.objectId, pluginUid: selected.pluginUid, confirmReplacement: true });
        slot = (await slots())[0];
        const children = await call('cubase_objects_list', { root: 'mixConsole', parentId: slot.objectId, limit: 16 });
        if (children.total !== 1 || children.items.length !== 1) throw new Error('Loaded plugin was not observed as one child.');
        const result = await call('cubase_plugin_unload', { root: 'mixConsole', projectRoot: project.root,
            objectId: slot.objectId, expectedUniqueId: slot.uniqueIdString,
            expectedPluginObjectId: children.items[0].objectId, confirmUnload: true });
        if (!result.confirmed || result.after.childCount !== 0) throw new Error('Plugin unload did not reach an empty slot.');
        const windows = await call('cubase_runtime_windows');
        if (windows.unexpected.length) throw new Error('Unexpected host window after plugin unload.');
        record({ stage: 'passed', slotId: slot.objectId, plugin: selected.name });
        process.stdout.write(JSON.stringify({ passed: true, slotId: slot.objectId, plugin: selected.name, afterChildren: 0 }) + '\n');
    } catch (error) {
        record({ stage: 'failed', error: String(error), noReplay: true });
        throw error;
    } finally {
        await client.close();
        fs.closeSync(evidence);
    }
}

main().catch(error => { process.stderr.write(String(error) + '\n'); process.exitCode = 1; });