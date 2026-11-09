'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { Client } = require('@modelcontextprotocol/client');
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');

async function volumeWriteAndRestore(original, target, setValue, observeUntil) {
    await setValue(target);
    const changed = await observeUntil(value => Number.isFinite(value) && Math.abs(value - target) < 0.00001);
    assert.ok(Number.isFinite(changed) && Math.abs(changed - target) < 0.00001, 'Requested value was not observed.');
    await setValue(original);
    const restored = await observeUntil(value => Number.isFinite(value) && Math.abs(value - original) < 0.00001);
    assert.ok(Number.isFinite(restored) && Math.abs(restored - original) < 0.00001, 'Original value was not restored.');
    return { original, requested: target, observed: changed, restored };
}

async function main() {
    const args = process.argv.slice(2);
    if (args.some(argument => argument !== '--write')) throw new Error('Usage: npm run verify:live -- [--write]');
    const root = resolve(__dirname, '..');
    const client = new Client({ name: 'cubase-ai16-live-verifier', version: '0.1.0' });
    const transport = new StdioClientTransport({
        command: process.execPath, args: [join(root, 'dist/src/server.js')],
        env: { ...process.env, CUBASE_MCP_CONFIG: join(root, 'cubase.config.json') }, stderr: 'pipe'
    });
    transport.stderr.on('data', data => process.stderr.write(data));
    const report = { timestamp: new Date().toISOString(), backend: 'midi', writesRequested: args.includes('--write'), checks: [] };
    async function call(name, argumentsValue = {}) {
        const result = await client.callTool({ name, arguments: argumentsValue });
        const body = JSON.parse(result.content.find(part => part.type === 'text').text);
        if (result.isError || !body.ok) throw new Error(JSON.stringify(body.error));
        return body.data;
    }
    async function check(name, action) {
        try { report.checks.push({ name, passed: true, result: await action() }); }
        catch (error) { report.checks.push({ name, passed: false, error: error.message }); }
    }
    try {
        await client.connect(transport);
        const tools = await client.listTools();
        report.toolCount = tools.tools.length;
        const status = await call('cubase_status');
        report.hostVersion = status.appVersion;
        report.session = status.session;
        assert.equal(status.active, true);
        assert.equal(status.policy.fallback, false);
        assert.equal(status.serverCompatibility.upgradeRequired, false, 'Reload the installed coverage controller before live verification.');
        await check('direct-access-discovery', async () => {
            const objects = await call('cubase_objects_list', { session: status.session, root: 'mixConsole', limit: 8 });
            return { baseObjectId: objects.baseObjectId, childCount: objects.total, returned: objects.items.length };
        });
        await check('selected-track-parameters', async () => {
            const objects = await call('cubase_objects_list', { session: status.session, root: 'trackSelection', limit: 8 });
            const candidates = [objects.baseObject, ...objects.items].filter(object => object.parameterCount > 0);
            candidates.sort((left, right) => right.parameterCount - left.parameterCount);
            const target = candidates[0];
            assert.ok(target, 'No parameter-bearing host object was discovered.');
            const parameters = await call('cubase_parameters_list', {
                session: status.session, root: 'trackSelection', objectId: target.objectId, limit: 8
            });
            return { objectId: target.objectId, title: target.title, parameterCount: parameters.total, returned: parameters.items.length };
        });
        await check('live-control-feedback', async () => {
            const volume = (await call('cubase_control_get', { session: status.session, key: 'track.volume' })).control;
            assert.equal(volume.available, true);
            assert.equal(typeof volume.observed.value, 'number');
            return { volume: volume.observed.value };
        });
        if (args.includes('--write')) {
            await check('volume-write-read-restore', async () => {
                const track = await call('cubase_selected_track', { session: status.session });
                const before = await call('cubase_control_get', { session: status.session, key: 'track.volume' });
                const original = before.control.observed && before.control.observed.value;
                assert.ok(Number.isFinite(original), 'No original track volume was observed.');
                const target = original >= 0.5 ? 0.25 : 0.75;
                async function observeUntil(predicate) {
                    const deadline = Date.now() + 2000;
                    let observed;
                    do {
                        const control = await call('cubase_control_get', { session: status.session, key: 'track.volume' });
                        observed = control.control.observed && control.control.observed.value;
                        if (predicate(observed)) return observed;
                        await new Promise(resolve => setTimeout(resolve, 50));
                    } while (Date.now() < deadline);
                    return observed;
                }
                async function setValue(value) {
                    await call('cubase_control_set', { session: status.session, key: 'track.volume', value,
                        expectedTrackUniqueId: track.uniqueId, expectedTrackRuntimeId: track.runtimeId });
                }
                return volumeWriteAndRestore(original, target, setValue, observeUntil);
            });
        }
    } catch (error) {
        report.checks.push({ name: 'live-connection', passed: false, error: error.message });
    } finally {
        await client.close();
        report.passed = report.checks.length > 0 && report.checks.every(check => check.passed);
        const directory = join(root, 'artifacts/live-smoke');
        mkdirSync(directory, { recursive: true });
        report.outputPath = join(directory, `verification-coverage-${randomUUID()}.json`);
        writeFileSync(report.outputPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
        if (!report.passed) process.exitCode = 1;
    }
}

module.exports = { volumeWriteAndRestore };
if (require.main === module) {
    main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
