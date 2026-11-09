'use strict';

const assert = require('node:assert/strict');
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { Client } = require('@modelcontextprotocol/client');
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');

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
                const original = before.control.observed.value;
                const target = original >= 0.5 ? 0.25 : 0.75;
                async function observeUntil(predicate) {
                    const deadline = Date.now() + 2000;
                    let observed;
                    do {
                        const control = await call('cubase_control_get', { session: status.session, key: 'track.volume' });
                        observed = control.control.observed.value;
                        if (predicate(observed)) return observed;
                        await new Promise(resolve => setTimeout(resolve, 50));
                    } while (Date.now() < deadline);
                    return observed;
                }
                let changed;
                try {
                    await call('cubase_control_set', { session: status.session, key: 'track.volume', value: target,
                        expectedTrackUniqueId: track.uniqueId });
                    changed = await observeUntil(value => Math.abs(value - original) > 0.000001);
                    assert.ok(Math.abs(changed - original) > 0.000001, 'No real value change observed.');
                } finally {
                    await call('cubase_control_set', { session: status.session, key: 'track.volume', value: original,
                        expectedTrackUniqueId: track.uniqueId });
                }
                const restored = await observeUntil(value => Math.abs(value - original) < 0.00001);
                assert.ok(Math.abs(restored - original) < 0.00001, 'Original value was not restored.');
                return { original, requested: target, observed: changed, restored };
            });
        }
    } catch (error) {
        report.checks.push({ name: 'live-connection', passed: false, error: error.message });
    } finally {
        await client.close();
        report.passed = report.checks.length > 0 && report.checks.every(check => check.passed);
        const directory = join(root, 'artifacts/live-smoke');
        mkdirSync(directory, { recursive: true });
        writeFileSync(join(directory, 'verification-coverage.json'), JSON.stringify(report, null, 2) + '\n');
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
        if (!report.passed) process.exitCode = 1;
    }
}

main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
