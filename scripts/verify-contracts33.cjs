'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/client');
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');

async function main() {
    const [phase, label] = process.argv.slice(2);
    if (!['bootstrap', 'prepare', 'reopen', 'extended-prepare', 'extended-reopen'].includes(phase) || !/^[a-z0-9-]+$/.test(label || '')) throw new Error('Expected a supported phase and unique label.');
    const extended = phase.startsWith('extended-');
    const actionPhase = extended ? phase.slice('extended-'.length) : phase;
    const root = path.resolve(__dirname, '..');
    const prefix = path.join(root, 'artifacts', 'ipc', `contracts33-${label}`);
    const expectedPath = `${prefix}-expected.json`;
    if (actionPhase === 'prepare' && fs.existsSync(expectedPath)) throw new Error('Prepared evidence already exists.');
    const evidence = fs.openSync(`${prefix}-${phase}.jsonl`, 'wx');
    const record = value => { fs.writeSync(evidence, JSON.stringify({ utc: new Date().toISOString(), ...value }) + '\n'); fs.fsyncSync(evidence); };
    const client = new Client({ name: 'contracts33', version: '1' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dist/src/server.js')],
        env: { ...process.env, CUBASE_MCP_CONFIG: path.join(root, 'cubase.config.json') }, stderr: 'pipe' });
    transport.stderr.on('data', data => process.stderr.write(data));
    let session;
    async function call(name, args = {}) {
        const independent = name === 'cubase_status' || name.startsWith('cubase_runtime_') || name === 'cubase_project_open';
        const input = independent ? args : { session, ...args };
        record({ stage: 'submit_once', name, arguments: input });
        const reply = await client.callTool({ name, arguments: input }, { timeout: 360000 });
        const body = reply.structuredContent || JSON.parse(reply.content.find(item => item.type === 'text').text);
        record({ stage: 'result', name, result: body });
        if (!body.ok) throw new Error(`${name}: ${body.error.code} ${body.error.message}`);
        if (typeof body.data.session === 'string') session = body.data.session;
        if (typeof body.data.host?.session === 'string') session = body.data.host.session;
        return body.data;
    }
    async function pages(name, args, limit) {
        const items = [];
        let offset = 0, first;
        do {
            const page = await call(name, { ...args, offset, limit });
            first ||= page;
            items.push(...page.items);
            const next = page.nextOffset;
            if (next !== null && (!Number.isInteger(next) || next <= offset)) throw new Error('Invalid host pagination.');
            offset = next;
        } while (offset !== null);
        return { ...first, items };
    }
    const returnName = `Native33 Persist Return ${label}`;
    async function state() {
        const events = await pages('cubase_events_list', {}, 128);
        const channelPage = await pages('cubase_channels_list', {}, 32);
        const channels = [...new Map(channelPage.items.map(item => [item.uniqueIdString, item])).values()];
        const names = ['Native33 MasterBus', 'Native33 MIDI', 'Native33 Automation a', returnName];
        if (extended) names.push('Native34 Instrument', 'Native34 Folder');
        for (const name of names) assert.equal(events.items.filter(item => item.name === name && item.track).length, 1, `Track ${name}`);
        assert.equal(events.items.find(item => item.name === 'Native33 MIDI').type, 'MMidiTrackEvent');
        const group = channels.find(item => item.title === 'Native33 MasterBus' && item.typeName === 'GroupChannel');
        assert.ok(group, 'Group mixer channel');
        assert.ok(channels.some(item => item.title === returnName && item.typeName.toLowerCase() === 'fxchannel'), 'FX mixer channel');
        const track = events.items.find(item => item.name === 'Native33 Automation a');
        const automation = await pages('cubase_automation_read', { root: events.root, trackEventId: track.eventId }, 128);
        const lanes = automation.items.filter(item => item.type === 'MAutomationTrackEvent');
        const points = automation.items.filter(item => item.type === 'MParamEvent').map(item => {
            const lane = lanes.find(candidate => candidate.path[0] === item.path[0]);
            assert.ok(lane, 'Automation lane membership');
            return { parameterTag: lane.parameterTag, startSeconds: item.startSeconds, normalizedValue: item.normalizedValue };
        }).sort((left, right) => left.parameterTag - right.parameterTag || left.startSeconds - right.startSeconds);
        assert.equal(points.length, 6, 'Six persistent automation points');
        assert.ok(lanes.some(item => item.parameterTag === 1027), 'Created mute lane');
        const children = await call('cubase_objects_list', { root: 'mixConsole', parentId: group.objectId, limit: 16 });
        const inserts = children.items.find(item => item.typeName === 'Inserts');
        assert.ok(inserts, 'Group insert container');
        const slots = await call('cubase_objects_list', { root: 'mixConsole', parentId: inserts.objectId, limit: 16 });
        assert.equal(slots.items[0].childCount, 0, 'Unloaded insert remains empty');
        const route = await call('cubase_routes_list', { root: events.root, objectId: group.objectId,
            expectedUniqueId: group.uniqueIdString, field: 'output' });
        let extension;
        if (extended) {
            assert.equal(events.items.find(item => item.name === 'Native34 Instrument').type, 'MInstrumentTrackEvent');
            assert.equal(events.items.find(item => item.name === 'Native34 Folder').type, 'MFolderTrack');
            const instrument = channels.find(item => item.title === 'Native34 Instrument');
            assert.ok(instrument, 'Instrument mixer channel');
            assert.ok(!channels.some(item => item.title === 'Native34 Folder'), 'Folders have no mixer channel');
            const instrumentChildren = await call('cubase_objects_list', { root: 'mixConsole', parentId: instrument.objectId, limit: 64 });
            const slot = instrumentChildren.items.find(item => item.typeName === 'Slot');
            assert.ok(slot && slot.childCount === 1, 'Assigned instrument slot');
            const plugins = await call('cubase_objects_list', { root: 'mixConsole', parentId: slot.objectId, limit: 8 });
            assert.equal(plugins.items.length, 1);
            const send = await call('cubase_routes_list', { root: events.root, objectId: group.objectId,
                expectedUniqueId: group.uniqueIdString, field: 'send', sendIndex: 0 });
            assert.equal(send.current.name, 'Native33 Return', 'Persistent send target');
            extension = { instrumentType: plugins.items[0].typeName, instrumentTitle: plugins.items[0].title, sendName: send.current.name };
        }
        const windows = await call('cubase_runtime_windows');
        assert.equal(windows.unexpected.length, 0, 'No unexpected host window');
        return { names, laneTags: lanes.map(item => item.parameterTag).sort((left, right) => left - right), points,
            emptyInsert: true, routeName: route.current.name, ...(extension ? { extension } : {}) };
    }
    try {
        await client.connect(transport);
        const before = await call('cubase_runtime_status');
        if (phase !== 'bootstrap') assert.ok(before.owned && before.running, 'An owned fixture must already be running.');
        if (phase === 'bootstrap') {
            const source = path.join(root, 'artifacts', 'managed-projects', 'session-32', 'contracts-a', 'Contracts32.cpr');
            await call('cubase_project_open', { projectPath: source, replaceCurrent: true, confirmDiscardChanges: true });
            let events = await pages('cubase_events_list', {}, 128);
            assert.ok(!events.items.some(item => item.name.startsWith('Native33')), 'Clean source contains no failed session-33 objects');
            for (const [kind, name] of [['group', 'Native33 MasterBus'], ['fx', 'Native33 Return'], ['midi', 'Native33 MIDI'], ['group', 'Native33 Automation a']]) {
                const created = await call('cubase_track_create', { root: events.root, kind, name, confirmCreate: true });
                assert.equal(created.confirmed, true, `${kind} creation`);
            }
            events = await pages('cubase_events_list', {}, 128);
            const track = events.items.find(item => item.name === 'Native33 Automation a');
            const channels = await pages('cubase_channels_list', {}, 32);
            const channel = channels.items.find(item => item.title === track.name);
            let automation = await pages('cubase_automation_read', { root: events.root, trackEventId: track.eventId }, 128);
            let lanes = automation.items.filter(item => item.type === 'MAutomationTrackEvent');
            let volume = lanes.find(item => item.parameterTag === 1025);
            if (!volume) {
                const created = await call('cubase_automation_edit', { root: events.root, trackEventId: track.eventId,
                    action: 'createLane', objectId: channel.objectId, expectedUniqueId: channel.uniqueIdString,
                    parameterTag: 1025, expected: { laneCount: lanes.length }, confirmEdit: true });
                assert.equal(created.confirmed, true, 'Volume lane creation');
                volume = created.lane;
                lanes = [...lanes, volume];
            }
            assert.ok(!automation.items.some(item => item.type === 'MParamEvent'), 'Clean automation contains no points');
            for (let index = 0; index < 6; ++index) {
                const inserted = await call('cubase_automation_edit', { root: events.root, trackEventId: track.eventId,
                    action: 'insert', laneEventId: volume.eventId, parameterTag: 1025, expected: { pointCount: index },
                    positionSeconds: 60 + index, value: (index + 1) / 10, confirmEdit: true });
                assert.equal(inserted.confirmed, true, 'Clean automation point insertion');
            }
            const mute = await call('cubase_automation_edit', { root: events.root, trackEventId: track.eventId,
                action: 'createLane', objectId: channel.objectId, expectedUniqueId: channel.uniqueIdString,
                parameterTag: 1027, expected: { laneCount: lanes.length }, confirmEdit: true });
            assert.equal(mute.confirmed, true, 'Mute lane creation');
            const result = { passed: true, source, stage: 'clean_fixture_rebuilt' };
            record({ stage: 'passed', ...result });
            fs.writeFileSync(`${prefix}-${phase}-result.json`, JSON.stringify(result, null, 2), { flag: 'wx' });
            process.stdout.write(JSON.stringify(result) + '\n');
        } else if (actionPhase === 'prepare') {
            await call('cubase_status');
            const events = await call('cubase_events_list', { limit: 1 });
            if (extended) {
                const tree = await pages('cubase_events_list', {}, 128);
                const track = tree.items.find(item => item.name === 'Native33 Automation a');
                const automation = await pages('cubase_automation_read', { root: events.root, trackEventId: track.eventId }, 128);
                const lane = automation.items.find(item => item.type === 'MAutomationTrackEvent' && item.parameterTag === 1025);
                const points = automation.items.filter(item => item.type === 'MParamEvent' && item.path[0] === lane.path[0]);
                assert.equal(points.length, 6);
                const reference = { root: events.root, trackEventId: track.eventId, laneEventId: lane.eventId, parameterTag: 1025, confirmEdit: true };
                const original = points[0];
                const changed = await call('cubase_automation_edit', { ...reference, action: 'setValue', pointEventId: original.eventId,
                    expected: { pointCount: 6, startSeconds: original.startSeconds, normalizedValue: original.normalizedValue }, value: 0.33 });
                assert.equal(changed.confirmed, true, 'MCP point value change');
                const moved = await call('cubase_automation_edit', { ...reference, action: 'move', pointEventId: changed.after.eventId,
                    expected: { pointCount: 6, startSeconds: changed.after.startSeconds, normalizedValue: changed.after.normalizedValue },
                    positionSeconds: original.startSeconds + 0.125 });
                assert.equal(moved.confirmed, true, 'MCP point position change');
                const inserted = await call('cubase_automation_edit', { ...reference, action: 'insert', expected: { pointCount: 6 }, positionSeconds: 70, value: 0.42 });
                assert.equal(inserted.confirmed, true, 'MCP temporary point insertion');
                const removed = await call('cubase_automation_edit', { ...reference, action: 'delete', pointEventId: inserted.after.eventId,
                    expected: { pointCount: 7, startSeconds: inserted.after.startSeconds, normalizedValue: inserted.after.normalizedValue } });
                assert.equal(removed.confirmed, true, 'MCP exact temporary point removal');
            }
            const created = await call('cubase_track_create', { root: events.root, kind: 'fx', name: returnName, confirmCreate: true });
            assert.equal(created.confirmed, true, 'Persistent FX creation');
            const channelPage = await pages('cubase_channels_list', {}, 32);
            const group = channelPage.items.find(item => item.title === 'Native33 MasterBus');
            assert.ok(group, 'Routing source');
            const reference = { root: events.root, objectId: group.objectId, expectedUniqueId: group.uniqueIdString, field: 'output' };
            const routes = await call('cubase_routes_list', reference);
            const targets = routes.choices.filter(item => item.name === returnName && item.enabled);
            assert.equal(targets.length, 1, 'Unique persistent route destination');
            const routed = await call('cubase_routing_set', { ...reference, expectedValue: routes.current.id,
                targetId: targets[0].id, targetName: returnName, confirmRouting: true });
            assert.equal(routed.confirmed, true, 'Route write and independent MIDI feedback');
            const expected = await state();
            assert.equal(expected.routeName, returnName);
            const projectPath = path.join(root, 'artifacts', 'managed-projects', extended ? 'session-34' : 'session-33', `verified-${label}`, extended ? 'Contracts34.cpr' : 'Contracts33.cpr');
            await call('cubase_project_save_as', { projectPath, confirmSaveAs: true });
            assert.ok(fs.statSync(projectPath).size > 0, 'Saved CPR exists');
            fs.writeFileSync(expectedPath, JSON.stringify({ projectPath, pid: before.pid, state: expected }, null, 2) + '\n', { flag: 'wx' });
            const result = { prepared: true, projectPath, pid: before.pid, automationPoints: expected.points.length };
            record({ stage: 'passed', ...result });
            fs.writeFileSync(`${prefix}-${phase}-result.json`, JSON.stringify(result, null, 2), { flag: 'wx' });
            process.stdout.write(JSON.stringify(result) + '\n');
        } else {
            const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
            await call('cubase_project_open', { projectPath: expected.projectPath, replaceCurrent: true, confirmDiscardChanges: true });
            const after = await call('cubase_runtime_status');
            assert.notEqual(after.pid, expected.pid, 'Fresh owned Cubase process');
            const actual = await state();
            assert.deepEqual(actual.names, expected.state.names);
            assert.deepEqual(actual.laneTags, expected.state.laneTags);
            assert.equal(actual.routeName, expected.state.routeName);
            assert.equal(actual.emptyInsert, true);
            if (extended) assert.deepEqual(actual.extension, expected.state.extension);
            assert.equal(actual.points.length, expected.state.points.length);
            actual.points.forEach((point, index) => {
                const original = expected.state.points[index];
                assert.equal(point.parameterTag, original.parameterTag);
                assert.ok(Math.abs(point.startSeconds - original.startSeconds) < 1e-6, 'Persistent point position');
                assert.ok(Math.abs(point.normalizedValue - original.normalizedValue) < 1e-6, 'Persistent point value');
            });
            const result = { passed: true, projectPath: expected.projectPath, previousPid: expected.pid, pid: after.pid,
                automationPoints: actual.points.length, routeName: actual.routeName, emptyInsert: true,
                ...(extended ? { extension: actual.extension } : {}) };
            record({ stage: 'passed', ...result });
            fs.writeFileSync(`${prefix}-${phase}-result.json`, JSON.stringify(result, null, 2), { flag: 'wx' });
            process.stdout.write(JSON.stringify(result) + '\n');
        }
    } catch (error) {
        record({ stage: 'failed', error: String(error), noReplay: true });
        fs.writeFileSync(`${prefix}-${phase}-result.json`, JSON.stringify({ passed: false, error: String(error) }, null, 2), { flag: 'wx' });
        throw error;
    } finally {
        await client.close();
        fs.closeSync(evidence);
    }
}

main().catch(error => { process.stderr.write(String(error) + '\n'); process.exitCode = 1; });