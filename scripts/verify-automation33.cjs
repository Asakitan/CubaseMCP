'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { Client } = require('@modelcontextprotocol/client');
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');

async function main() {
    const label = process.argv[2];
    if (!/^[a-z0-9-]+$/.test(label || '')) throw new Error('Supply a unique evidence label.');
    const root = path.resolve(__dirname, '..');
    const file = fs.openSync(path.join(root, 'artifacts', 'ipc', `automation33-${label}.jsonl`), 'wx');
    const record = value => { fs.writeSync(file, JSON.stringify({ utc: new Date().toISOString(), ...value }) + '\n'); fs.fsyncSync(file); };
    const client = new Client({ name: 'automation33', version: '1' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dist/src/server.js')],
        env: { ...process.env, CUBASE_MCP_CONFIG: path.join(root, 'cubase.config.json') }, stderr: 'pipe' });
    transport.stderr.on('data', data => process.stderr.write(data));
    let session, running = false;
    async function call(name, args = {}) {
        const input = name === 'cubase_status' ? args : { session, ...args };
        record({ stage: 'submit_once', name, arguments: input });
        const reply = await client.callTool({ name, arguments: input }, { timeout: 180000 });
        const body = reply.structuredContent || JSON.parse(reply.content.find(item => item.type === 'text').text);
        record({ stage: 'result', name, result: body });
        if (!body.ok) throw new Error(`${name}: ${body.error.code} ${body.error.message}`);
        if (typeof body.data.session === 'string') session = body.data.session;
        return body.data;
    }
    try {
        await client.connect(transport);
        await call('cubase_status');
        const model = await call('cubase_events_list', { limit: 1 });
        const name = process.argv[3] || `Native33 Automation ${label}`;
        let target;
        if (process.argv[3]) {
            target = (await call('cubase_channels_list', { limit: 32 })).items.find(item => item.title === name);
        } else {
            const created = await call('cubase_track_create', { root: model.root, kind: 'group', name, confirmCreate: true });
            if (!created.confirmed) throw new Error('Automation fixture track not confirmed.');
            target = created.channels.added.find(item => item.title === name);
        }
        if (!target) throw new Error('Automation fixture track is absent.');
        const channels = await call('cubase_channels_list', { limit: 32 });
        const channel = channels.items.find(item => item.uniqueIdString === target.uniqueIdString);
        const identity = { objectId: channel.objectId, expectedUniqueId: channel.uniqueIdString };
        const before = await call('cubase_transport_state');
        if (before.playing || before.recording) throw new Error('The fixture requires stopped transport.');
        await call('cubase_channel_set', { ...identity, field: 'selected', value: true });
        await call('cubase_locator_set', { display: 'primary', locator: 'cursor', time: '33.1.1.0' });
        await call('cubase_channel_set', { ...identity, field: 'automationWrite', value: true });
        running = true;
        await call('cubase_transport_action', { action: 'start', settleMs: 100 });
        await call('cubase_control_set', { key: 'track.volume', value: 0.25, expectedTrackUniqueId: channel.uniqueIdString, settleMs: 100 });
        await delay(250);
        await call('cubase_control_set', { key: 'track.volume', value: 0.7, expectedTrackUniqueId: channel.uniqueIdString, settleMs: 100 });
        await delay(250);
        await call('cubase_transport_action', { action: 'stop', settleMs: 100 });
        running = false;
        await call('cubase_channel_set', { ...identity, field: 'automationWrite', value: false });
        await call('cubase_channel_set', { ...identity, field: 'volume', value: channel.fields.volume.value });
        if (before.position && typeof before.position.primary === 'string')
            await call('cubase_locator_set', { display: 'primary', locator: 'cursor', time: before.position.primary });
        const after = await call('cubase_events_list', { limit: 128 });
        const track = after.items.find(item => item.name === name);
        record({ stage: 'fixture_recorded', root: after.root, track, channel: identity });
        process.stdout.write(JSON.stringify({ recorded: true, root: after.root, track, channel: identity }) + '\n');
    } catch (error) {
        record({ stage: 'failed', error: String(error) });
        throw error;
    } finally {
        if (running) {
            try { await call('cubase_transport_action', { action: 'stop', settleMs: 0 }); }
            catch (error) { record({ stage: 'stop_failed', error: String(error) }); }
        }
        await client.close();
        fs.closeSync(file);
    }
}

main().catch(error => { process.stderr.write(String(error) + '\n'); process.exitCode = 1; });