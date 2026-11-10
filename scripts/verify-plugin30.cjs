'use strict';

// Session-30 live check of plug-in loading through the real stdio MCP server: load an insert
// effect into the first insert slot of the instrument channel of the current managed project,
// write four of its insert-viewer controls with host feedback, write them back, and replace the
// effect with another one. Nothing is unloaded: the host call for that opens a prompt.
// Usage (from a PowerShell-started process, with a project that has an instrument channel): node scripts/verify-plugin30.cjs <label>
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/client');
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');

const root = path.resolve(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    const label = process.argv[2];
    if (!label || !/^[a-z0-9-]+$/.test(label)) throw new Error('usage: verify-plugin30.cjs <label>');
    const evidencePath = path.join(root, 'artifacts', 'ipc', `plugin-insert30-live-${label}.json`);
    if (fs.existsSync(evidencePath)) throw new Error('label already used: ' + label);
    const evidence = { label, startedUtc: new Date().toISOString(), checks: [] };
    const client = new Client({ name: 'plugin30-live', version: '0.1.0' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dist/src/server.js')],
        env: { ...process.env, CUBASE_MCP_CONFIG: path.join(root, 'cubase.config.json') }, stderr: 'pipe' });
    transport.stderr.on('data', data => process.stderr.write(data));
    let session = null;
    async function call(name, args = {}) {
        const sessionless = /^cubase_(status|runtime_)/.test(name);
        const response = await client.callTool({ name, arguments: sessionless ? args : { session, ...args } });
        const body = JSON.parse(response.content.find(item => item.type === 'text').text);
        if (!body.ok) throw new Error(`${name}: ${body.error.code} ${body.error.message}`);
        if (body.data && typeof body.data.session === 'string') session = body.data.session;
        return body.data;
    }
    const check = (name, passed, detail) => { evidence.checks.push({ name, passed: !!passed, detail }); process.stdout.write(`${passed ? 'PASS' : 'FAIL'} ${name}${passed ? '' : ' ' + JSON.stringify(detail).slice(0, 500)}\n`); };
    try {
        await client.connect(transport);
        const status = await call('cubase_status');
        evidence.bridgeRevision = status.bridgeRevision;
        const synth = (await call('cubase_channels_list', {})).items.find(channel => channel.typeName === 'Synth');
        if (!synth) throw new Error('the managed project has no instrument channel');
        await call('cubase_channel_set', { objectId: synth.objectId, expectedUniqueId: synth.uniqueIdString, field: 'selected', value: true });
        await sleep(400);
        const track = await call('cubase_selected_track', {});
        const slots = async () => {
            await call('cubase_objects_list', { root: 'mixConsole', limit: 64 });
            const children = await call('cubase_objects_list', { root: 'mixConsole', parentId: synth.objectId, limit: 32 });
            const inserts = children.items.find(item => item.typeName === 'Inserts');
            return (await call('cubase_objects_list', { root: 'mixConsole', parentId: inserts.objectId, limit: 16 })).items;
        };
        let slot = (await slots())[0];
        const offered = [];
        for (let offset = 0; offset !== null && offset !== undefined;) {
            const page = await call('cubase_plugins_list', { root: 'mixConsole', objectId: slot.objectId, offset, limit: 64 });
            offered.push(...page.items); offset = page.nextOffset;
        }
        evidence.offered = offered.map(item => item.name);
        const pick = name => offered.find(item => item.name === name);
        const first = pick('MonoDelay') || offered[0], second = pick('Chorus') || offered[1];
        check('the slot offers plug-ins', offered.length > 1, { count: offered.length });
        const load = async plugin => {
            // Listing objects again drops earlier observations, so the UID is listed for the slot before each assignment.
            for (let offset = 0, listed = false; !listed && offset !== null && offset !== undefined;) {
                const page = await call('cubase_plugins_list', { root: 'mixConsole', objectId: slot.objectId, offset, limit: 64 });
                listed = page.items.some(item => item.pluginUid === plugin.pluginUid); offset = page.nextOffset;
            }
            const result = await call('cubase_plugin_set', { root: 'mixConsole', objectId: slot.objectId, pluginUid: plugin.pluginUid, confirmReplacement: true });
            await sleep(1500);
            slot = (await slots())[0];
            const viewer = (await call('cubase_control_get', { key: 'track.insert.slot.0.on' })).control;
            const windows = (await call('cubase_runtime_windows')).unexpected.map(item => item.title);
            return { accepted: result.accepted, slotChildren: slot.childCount, viewerPlugin: viewer.pluginIdentity && viewer.pluginIdentity.name, windows };
        };
        const loaded = await load(first);
        check(`${first.name} loaded without a window`, loaded.accepted === true && loaded.slotChildren === 1 && loaded.viewerPlugin === first.name && !loaded.windows.length, loaded);
        const writes = {};
        for (const suffix of ['on', 'bypass', 'parameter.0', 'parameter.1']) {
            const key = `track.insert.slot.0.${suffix}`;
            const info = (await call('cubase_control_get', { key })).control;
            const previous = info.observed ? info.observed.value : null;
            const target = previous === null ? 1 : previous === 0 ? 1 : previous === 1 ? 0 : previous > 0.5 ? previous - 0.2 : previous + 0.2;
            const guard = { expectedTrackUniqueId: track.uniqueId, expectedTrackRuntimeId: track.runtimeId, expectedPluginIdentity: info.pluginIdentity };
            const write = await call('cubase_control_set', { key, value: target, settleMs: 1200, ...guard });
            const back = previous === null ? null : await call('cubase_control_set', { key, value: previous, settleMs: 800, ...guard });
            writes[suffix] = { previous, target, state: write.confirmation.state, observed: write.confirmation.observed && write.confirmation.observed.value,
                display: write.confirmation.display && write.confirmation.display.value, restored: back ? back.confirmation.state : null };
        }
        check('on, bypass and two parameters confirmed by host feedback and written back',
            Object.values(writes).every(item => item.state === 'feedback_observed' && (item.restored === null || item.restored === 'feedback_observed')), writes);
        const replaced = await load(second);
        check(`replaced by ${second.name} without a window`, replaced.accepted === true && replaced.viewerPlugin === second.name && !replaced.windows.length, replaced);
        evidence.writes = writes;
    } catch (error) {
        evidence.error = String(error && error.stack || error);
        process.stdout.write('ERROR ' + evidence.error + '\n');
    } finally {
        evidence.finishedUtc = new Date().toISOString();
        evidence.passed = evidence.checks.filter(item => item.passed).length;
        evidence.failed = evidence.checks.filter(item => !item.passed).length + (evidence.error ? 1 : 0);
        fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), { flag: 'wx' });
        await client.close().catch(() => {});
        process.stdout.write(`checks passed ${evidence.passed}, failed ${evidence.failed}; evidence ${evidencePath}\n`);
        if (evidence.failed) process.exitCode = 1;
    }
}

main().catch(error => { process.stderr.write(String(error && error.stack || error) + '\n'); process.exitCode = 1; });
