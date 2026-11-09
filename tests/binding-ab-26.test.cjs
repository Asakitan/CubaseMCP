'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const protocol = require('../diagnostics/binding-ab-26/protocol');
const { createController } = require('../diagnostics/binding-ab-26/controller');
function fixture(arm, propagate) {
    let input, output, page, surface, binding, channel, jumps = 0, hostValue = { }, current = .8, sent = [], writes = [];
    const uid = '604DE95A858E93754BEA0BE43A9D6B2', device = {}, mapping = {};
    const access = { activate() {}, deactivate() {}, update() {}, getObjectUniqueIDString: () => uid,
        getNumberOfParameters: () => 2, getParameterTagByIndex: (m, id, i) => [1, 1025][i],
        getParameterEditLockState: () => false, getParameterProcessValue: () => current };
    channel = { getRuntimeID: () => 264, getUniqueIDString: () => uid, mValue: { mVolume: hostValue } };
    surface = { setProcessValue(d, v) { writes.push(v); surface.mOnProcessValueChange(d, v, 0); if (propagate) current = v; } };
    binding = { setValueTakeOverModeJump() { jumps++; } };
    page = { mHostAccess: { mMixConsole: { makeMixerBankZone: () => ({ makeMixerBankChannel: () => channel }) },
        mTrackSelection: {}, makeDirectAccess: () => access }, makeValueBinding: () => binding };
    const driver = { mPorts: { makeMidiInput: () => (input = {}), makeMidiOutput: () => (output = { sendMidi: (d, bytes) => sent.push(bytes) }) },
        makeDetectionUnit: () => ({ detectPortPair: () => ({ expectInputNameEquals() {}, expectOutputNameEquals() {} }) }),
        mMapping: { makePage: () => page }, mSurface: { makeCustomValueVariable: () => surface } };
    createController({ makeDeviceDriver: () => driver }, arm); page.mOnActivate(device, mapping);
    let n = 0;
    function call(op, session) {
        const req = { v: 1, id: (++n).toString(16).padStart(32, '0'), op, deadline: Date.now() + 60000 };
        if (session !== undefined) req.session = session;
        for (const frame of protocol.encode(req)) input.mOnSysex(device, frame);
        for (let i = 0; i < 20; i++) page.mOnIdle(device, mapping);
        const decode = protocol.createDecoder(); let answer;
        for (const frame of sent.splice(0)) answer = decode.accept(frame, Date.now()) || answer;
        return answer;
    }
    function send(req) { for (const frame of protocol.encode(req)) input.mOnSysex(device, frame); }
    function drain(ticks = 100) { for (let i = 0; i < ticks; i++) page.mOnIdle(device, mapping); const decoder = protocol.createDecoder(), all = [];
        for (const frame of sent.splice(0)) { const result = decoder.accept(frame, Date.now()); if (result) all.push(result); } return all; }
    return { call, send, drain, access, channel, surface, writes, jumps, page, device, mapping, get current() { return current; } };
}
test('default distinguishes surface echo from independent read and blocks restore', () => {
    const f = fixture('default', false), session = f.call('status').data.session;
    assert.equal(f.jumps, 0); assert.equal(f.call('baseline', session).data.baseline.value, .8);
    assert.equal(f.call('write', session).data.state, 'unknown');
    const read = f.call('read', session).data; assert.equal(read.read.value, .8); assert.equal(read.state, 'unknown');
    assert.ok(read.events.some(e => e.kind === 'surface'));
    assert.equal(f.call('restore', session).error, 'RESTORE_NOT_ADMITTED');
    assert.equal(f.call('write', session).error, 'WRITE_NOT_ADMITTED'); assert.deepEqual(f.writes, [.625]);
});
test('jump requires observed target and allows only one restore', () => {
    const f = fixture('jump', true), session = f.call('status').data.session;
    assert.equal(f.jumps, 1); f.call('baseline', session); f.call('write', session);
    assert.equal(f.call('read', session).data.state, 'target_observed');
    assert.equal(f.call('restore', session).data.state, 'restore_unknown');
    assert.equal(f.call('read', session).data.state, 'restored_observed');
    assert.equal(f.call('restore', session).error, 'RESTORE_NOT_ADMITTED'); assert.deepEqual(f.writes, [.375, .8]);
});
test('identity and session gates reject prior to submission', () => {
    const f = fixture('default', false), session = f.call('status').data.session;
    f.channel.getUniqueIDString = () => 'different';
    assert.equal(f.call('baseline', session).error, 'IDENTITY_MISMATCH');
    assert.equal(f.call('write', 'stale').error, 'SESSION_MISMATCH'); assert.deepEqual(f.writes, []);
});


test('deadline admission and dispatch reject expired writes including exact boundary', () => {
    const realNow = Date.now; let now = 1000; Date.now = () => now;
    try {
        const f = fixture('default', false), session = f.call('status').data.session; f.call('baseline', session);
        const id = 'a'.repeat(32);
        f.send({ v: 1, id, op: 'write', session, deadline: 1001 }); now = 1001;
        let result = f.drain().find(x => x.id === id);
        assert.equal(result.error, 'DEADLINE_EXPIRED'); assert.equal(result.execution, 'not_started'); assert.deepEqual(f.writes, []);
        f.send({ v: 1, id, op: 'write', session, deadline: 2000 });
        result = f.drain().find(x => x.id === id); assert.equal(result.error, 'DUPLICATE_ID'); assert.deepEqual(f.writes, []);
        const id2 = 'b'.repeat(32); f.send({ v: 1, id: id2, op: 'status', deadline: now });
        assert.equal(f.drain().find(x => x.id === id2).error, 'DEADLINE_EXPIRED');
        const id3 = 'c'.repeat(32); f.send({ v: 1, id: id3, op: 'status' });
        assert.equal(f.drain().find(x => x.id === id3).error, 'INVALID_DEADLINE');
    } finally { Date.now = realNow; }
});

test('saturated queue consumes and rejects ninth ID without executing it', () => {
    const f = fixture('default', false), session = f.call('status').data.session;
    for (let i = 0; i < 9; i++) f.send({ v: 1, id: (100 + i).toString(16).padStart(32, '0'), op: 'read', session, deadline: Date.now() + 60000 });
    const answers = f.drain(); const ninth = answers.find(x => x.id === (108).toString(16).padStart(32, '0'));
    assert.equal(ninth.error, 'QUEUE_FULL'); assert.equal(ninth.execution, 'not_started'); assert.equal(answers.length, 9); assert.deepEqual(f.writes, []);
});

test('reactivation invalidates session and preserves one-shot write guard', () => {
    const f = fixture('default', false), session = f.call('status').data.session;
    f.call('baseline', session); f.call('write', session);
    f.page.mOnDeactivate(f.device, f.mapping); f.page.mOnActivate(f.device, f.mapping);
    const next = f.call('status').data.session; assert.notEqual(next, session);
    assert.equal(f.call('baseline', next).error, 'BASELINE_CONSUMED');
    assert.equal(f.call('write', next).error, 'WRITE_NOT_ADMITTED'); assert.deepEqual(f.writes, [.625]);
});

test('deadline reached during identity checks prevents write', () => {
    const realNow = Date.now; let now = 1000; Date.now = () => now;
    try {
        const f = fixture('jump', false), session = f.call('status').data.session; f.call('baseline', session);
        const original = f.access.getParameterProcessValue;
        f.access.getParameterProcessValue = (...args) => { const value = original(...args); now = 1001; return value; };
        const id = 'd'.repeat(32); f.send({ v: 1, id, op: 'write', session, deadline: 1001 });
        const result = f.drain().find(x => x.id === id); assert.equal(result.error, 'DEADLINE_EXPIRED');
        assert.equal(result.execution, 'not_started'); assert.deepEqual(f.writes, []);
    } finally { Date.now = realNow; }
});

test('setter throwing deadline-named error remains unknown and write is consumed', () => {
    const f = fixture('default', false), session = f.call('status').data.session;
    f.call('baseline', session);
    f.surface.setProcessValue = () => { throw new Error('DEADLINE_EXPIRED'); };
    const result = f.call('write', session);
    assert.equal(result.error, 'DEADLINE_EXPIRED'); assert.equal(result.execution, 'unknown');
    assert.equal(result.state, 'unknown'); assert.equal(f.call('write', session).error, 'WRITE_NOT_ADMITTED');
});
