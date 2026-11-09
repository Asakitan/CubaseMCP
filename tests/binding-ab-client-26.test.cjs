'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const protocol = require('../diagnostics/binding-ab-26/protocol');
const { run } = require('../scripts/run-binding-ab26.cjs');
const uid = '604DE95A858E93754BEA0BE43A9D6B2';
function fake({ mode = 'default', observed = true, disconnectAt = '', dropAt = '', onRequest = () => {} } = {}) {
    const calls = [], decoder = protocol.createDecoder(), session = 'fixture-session', target = mode === 'default' ? .625 : .375;
    const read = value => ({ objectId: 264, uniqueId: uid, tag: 1025, locked: false, value });
    let input;
    class Port extends EventEmitter {
        getPortCount() { return 1; } getPortName() { return this.name; }
        openPort() { this.open = true; } isPortOpen() { return !!this.open; }
        closePort() { this.open = false; } destroy() {}
    }
    class Input extends Port { constructor() { super(); this.name = 'CubaseAI Binding26 From Cubase'; input = this; } ignoreTypes() {} }
    class Output extends Port {
        constructor() { super(); this.name = 'CubaseAI Binding26 To Cubase'; }
        sendMessage(bytes) {
            const req = decoder.accept(bytes, Date.now()); if (!req) return;
            calls.push(req.op); onRequest(req);
            if (disconnectAt === req.op) { this.emit('disconnect'); return; }
            if (dropAt === req.op) return;
            const responses = {
                status: { session, arm: mode, state: 'not_started', target },
                baseline: { state: 'not_started', baseline: read(.8) },
                write: { state: 'unknown', target, before: read(.8) },
                read: { state: observed ? 'target_observed' : 'unknown', read: read(observed ? target : .8), events: [] },
                restore: { state: 'restore_unknown', target: .8, before: read(target) }
            };
            for (const frame of protocol.encode({ v: 1, id: req.id, ok: true, data: responses[req.op] })) input.emit('message', 0, frame);
        }
    }
    return { driver: { Input, Output }, calls };
}
function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'binding26-test-')); }
function cleanup(dir) {
    const resolved = fs.realpathSync(dir), parent = fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(resolved).toLowerCase(), parent.toLowerCase());
    assert.match(path.basename(resolved), /^binding26-test-/);
    for (const name of fs.readdirSync(resolved)) {
        const file = path.join(resolved, name);
        assert.equal(fs.lstatSync(file).isFile(), true);
        fs.unlinkSync(file);
    }
    fs.rmdirSync(resolved);
}
const plan = { mode: 'default', pid: 42, creation: '123456' };
test('admission is durable before write and observed target permits a single restore', async () => {
    const dir = temp(); let existsBeforeWrite = false;
    try {
        const f = fake({ onRequest(req) { if (req.op === 'write') existsBeforeWrite = fs.existsSync(path.join(dir, 'binding26-42-123456.json')); } });
        const result = await run(plan, { driver: f.driver, admissionDir: dir });
        assert.equal(existsBeforeWrite, true); assert.equal(result.outcome, 'restore_unknown');
        assert.deepEqual(f.calls, ['status', 'baseline', 'write', 'read', 'restore']);
        const admission = JSON.parse(fs.readFileSync(result.admission)); assert.equal(admission.runId, result.runId); assert.equal(admission.interpretation, 'external_plan_claim_not_verified');
        const retry = fake(); const second = await run(plan, { driver: retry.driver, admissionDir: dir });
        assert.match(second.error, /^EEXIST:/);
        assert.deepEqual(retry.calls, ['status', 'baseline']);
    } finally { cleanup(dir); }
});
test('surface submission without independent target read stops without restore', async () => {
    const dir = temp(); try {
        const f = fake({ observed: false }); const result = await run(plan, { driver: f.driver, admissionDir: dir });
        assert.equal(result.outcome, 'unknown'); assert.deepEqual(f.calls, ['status', 'baseline', 'write', 'read']);
    } finally { cleanup(dir); }
});
test('disconnect at write stops without replay and admission remains consumed', async () => {
    const dir = temp(); try {
        const f = fake({ disconnectAt: 'write' }); const result = await run(plan, { driver: f.driver, admissionDir: dir });
        assert.equal(result.error, 'MIDI_DISCONNECTED'); assert.equal(result.outcome, 'unknown');
        assert.deepEqual(f.calls, ['status', 'baseline', 'write']); assert.ok(fs.existsSync(result.admission));
    } finally { cleanup(dir); }
});
test('fixed plan rejects arbitrary op and arm mismatch before admission', async () => {
    const dir = temp(); try {
        await assert.rejects(run({ ...plan, op: 'anything' }, { driver: fake().driver, admissionDir: dir }), /INVALID_PLAN/);
        const f = fake({ mode: 'jump' }); const result = await run(plan, { driver: f.driver, admissionDir: dir });
        assert.equal(result.error, 'STATUS_MISMATCH'); assert.deepEqual(f.calls, ['status']); assert.deepEqual(fs.readdirSync(dir), []);
    } finally { cleanup(dir); }
});

test('timeout after write consumes admission and does not replay', async () => {
    const dir = temp(); try {
        const f = fake({ dropAt: 'write' }); const result = await run(plan, { driver: f.driver, admissionDir: dir });
        assert.equal(result.error, 'MIDI_TIMEOUT'); assert.equal(result.outcome, 'unknown');
        assert.deepEqual(f.calls, ['status', 'baseline', 'write']); assert.ok(fs.existsSync(result.admission));
    } finally { cleanup(dir); }
});

test('partial MIDI construction closes and destroys the constructed input', async () => {
    const dir = temp(); let closed = 0, destroyed = 0;
    try {
        class Input { closePort() { closed++; } destroy() { destroyed++; } }
        class Output { constructor() { throw new Error('OUTPUT_CONSTRUCTOR_FAILED'); } }
        const result = await run(plan, { driver: { Input, Output }, admissionDir: dir });
        assert.equal(result.error, 'OUTPUT_CONSTRUCTOR_FAILED'); assert.equal(closed, 1); assert.equal(destroyed, 1);
    } finally { cleanup(dir); }
});

test('listener registration failure releases both constructed ports', async () => {
    const dir = temp(), released = [];
    class Input extends EventEmitter { closePort() { released.push('input-close'); } destroy() { released.push('input-destroy'); } }
    class Output extends EventEmitter {
        on() { throw new Error('LISTENER_FAILURE'); }
        closePort() { released.push('output-close'); } destroy() { released.push('output-destroy'); }
    }
    try {
        const result = await run(plan, { driver: { Input, Output }, admissionDir: dir });
        assert.equal(result.error, 'LISTENER_FAILURE');
        assert.equal(result.outcome, 'not_started');
        assert.deepEqual(released, ['input-close', 'output-close', 'input-destroy', 'output-destroy']);
    } finally { cleanup(dir); }
});
test('live CLI and non-injected run are blocked before opening ports', async () => {
    const { spawnSync } = require('node:child_process');
    const result = spawnSync(process.execPath, [require.resolve('../scripts/run-binding-ab26.cjs'), 'default', '42', '123456'], { encoding: 'utf8' });
    assert.equal(result.status, 1); assert.match(result.stderr, /LIVE_EXPERIMENT_NOT_ADMITTED/);
    await assert.rejects(run(plan), /LIVE_EXPERIMENT_NOT_ADMITTED/);
});
