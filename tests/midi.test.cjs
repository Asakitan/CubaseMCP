'use strict';

const assert = require('node:assert/strict');
const { EventEmitter, getEventListeners } = require('node:events');
const Module = require('node:module');
const test = require('node:test');
const protocol = require('../remote/protocol.js');
const { MidiClient, BridgeError, DEFAULT_INPUT, DEFAULT_OUTPUT } =
    require(process.env.MIDI_TEST_MODULE || '../dist/src/midi.js');

const options = { input: DEFAULT_INPUT, output: DEFAULT_OUTPUT, timeoutMs: 1000 };

function native(config = {}) {
    const state = {
        inputNames: config.inputNames || [DEFAULT_INPUT],
        outputNames: config.outputNames || [DEFAULT_OUTPUT],
        inputs: [], outputs: [], frames: [], requests: [], sends: 0
    };
    const decoder = protocol.createDecoder();
    class Port {
        constructor(direction) {
            this.direction = direction;
            this.opens = [];
            this.closes = 0;
            this.destroys = 0;
            this.opened = false;
            state[`${direction}s`].push(this);
        }
        getPortCount() { return state[`${this.direction}Names`].length; }
        getPortName(index) { return state[`${this.direction}Names`][index]; }
        openPort(index) {
            this.opens.push(index);
            if (config.openFail === this.direction) throw new Error('native open failed');
            this.opened = true;
            if (config.disconnectOnOpen === this.direction) this.emit('disconnect');
        }
        isPortOpen() { return this.opened; }
        closePort() {
            this.closes++;
            this.opened = false;
            if (config.closeFail) throw new Error('native close failed');
        }
        destroy() { this.destroys++; }
    }
    class Input extends Port {
        constructor() {
            super('input');
            this.events = new EventEmitter();
        }
        ignoreTypes(...values) { this.ignored = values; }
        on(...values) { this.events.on(...values); return this; }
        removeListener(...values) { this.events.removeListener(...values); return this; }
        emit(...values) { return this.events.emit(...values); }
    }
    class Output extends Port {
        constructor() {
            if (config.outputConstructorFail) throw new Error('native constructor failed');
            super('output');
        }
        sendMessage(frame) {
            state.sends++;
            state.frames.push(frame.slice());
            if (state.sends === config.sendFailAt) throw new Error('native send failed');
            const request = decoder.accept(frame, Date.now());
            if (request) state.requests.push(request);
        }
    }
    return { state, driver: { Input, Output } };
}

function reply(state, index, response = { ok: true, data: null }) {
    const frames = protocol.encode({ v: 1, id: state.requests[index].id, ...response });
    for (const frame of frames) state.inputs[0].emit('message', 0, frame);
}

function released(state) {
    for (const port of [...state.inputs, ...state.outputs]) {
        assert.equal(port.closes, 1);
        assert.equal(port.destroys, 1);
        if (port.events) assert.deepEqual(port.events.eventNames(), []);
    }
}

async function withNative(driver, action) {
    const original = Module._load;
    const loads = [];
    Module._load = function (name, ...rest) {
        if (name === '@julusian/midi/lazy') {
            loads.push(name);
            return driver;
        }
        return original.call(this, name, ...rest);
    };
    try { return await action(loads); }
    finally { Module._load = original; }
}

test('lifecycle preparation rejects pending requests and closes only after completion', async () => {
    const { state, driver } = native(), client = new MidiClient(options, driver);
    const pending = client.request('read');
    assert.throws(() => client.prepareLifecycle(), { code: 'MIDI_BUSY', execution: 'not_started' });
    assert.equal(state.inputs[0].closes, 0);
    reply(state, 0);
    await pending;
    client.prepareLifecycle(); released(state);
});

test('Save uses one validated input and releases only after a binding observation', async () => {
    const { state, driver } = native(), client = new MidiClient(options, driver);
    const operation = client.executeSave({ session: 'save-session', key: 'project.save', confirmCurrentSelection: true });
    const token = state.requests[0].id;
    assert.equal(state.requests[0].op, 'commands.prepare');
    reply(state, 0, { ok: true, data: { originSession: 'save-session', session: 'save-page-session', key: 'project.save', token,
        inputDeadline: state.requests[0].args.inputDeadline, execution: 'prepared_not_submitted' } });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(state.frames.filter(frame => frame.length === 3), [[144, 1, 127]]);
    assert.equal(state.requests[1].op, 'commands.result');
    reply(state, 1, { ok: true, data: { session: 'save-page-session', token, execution: 'submitted', bindingObserved: true, inputReleased: true } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(state.requests[2].op, 'commands.finish');
    reply(state, 2, { ok: true, data: { session: 'returned-session', token, execution: 'submitted', bindingObserved: true, returnedToMain: true } });
    assert.equal((await operation).execution, 'submitted');
    assert.deepEqual(state.frames.filter(frame => frame.length === 3), [[144, 1, 127], [128, 1, 0]]);
    client.close(); released(state);
});

test('Save rejects a changed preparation before input and never repeats an unobserved press', async () => {
    const first = native(), invalid = new MidiClient(options, first.driver);
    const rejected = invalid.executeSave({ session: 's', key: 'project.save', confirmCurrentSelection: true });
    reply(first.state, 0, { ok: true, data: { originSession: 'other', session: 'save', key: 'project.save', token: first.state.requests[0].id,
        inputDeadline: Date.now() + 1000, execution: 'prepared_not_submitted' } });
    await assert.rejects(rejected, { execution: 'not_started' });
    assert.equal(first.state.frames.some(frame => frame.length === 3), false);
    invalid.close();
    const second = native(), timeout = new MidiClient({ ...options, timeoutMs: 40 }, second.driver);
    const pending = timeout.executeSave({ session: 's', key: 'project.save', confirmCurrentSelection: true });
    const token = second.state.requests[0].id;
    reply(second.state, 0, { ok: true, data: { originSession: 's', session: 'save', key: 'project.save', token,
        inputDeadline: second.state.requests[0].args.inputDeadline, execution: 'prepared_not_submitted' } });
    await assert.rejects(pending, { execution: 'unknown' });
    assert.deepEqual(second.state.frames.filter(frame => frame.length === 3), [[144, 1, 127]]);
    await assert.rejects(timeout.request('probe'), { code: 'MIDI_FAULTED' });
    released(second.state);
});

test('lazy exact selection enables SysEx and opens each configured port only once', async () => {
    const { state, driver } = native({
        inputNames: ['Other input', DEFAULT_INPUT, `${DEFAULT_INPUT} extra`],
        outputNames: ['Other output', DEFAULT_OUTPUT]
    });
    const client = new MidiClient(options, driver);
    assert.equal(state.inputs.length, 0);
    const pending = client.request('probe', { text: 'x'.repeat(1500) });
    assert.deepEqual(state.inputs[0].opens, [1]);
    assert.deepEqual(state.outputs[0].opens, [1]);
    assert.deepEqual(state.inputs[0].ignored, [false, true, true]);
    assert.match(state.requests[0].id, /^[a-f0-9]{32}$/);
    assert.equal(state.requests[0].op, 'probe');
    assert.ok(Number.isFinite(state.requests[0].deadline));
    assert.ok(state.requests[0].deadline >= Date.now());
    assert.ok(state.requests[0].deadline <= Date.now() + options.timeoutMs);
    assert.equal(state.requests[0].args.text.length, 1500);
    assert.ok(state.frames.length > 1);
    assert.ok(state.frames.every(frame => frame.length <= 1024));
    reply(state, 0, { ok: true, data: { ready: true } });
    assert.deepEqual(await pending, { ready: true });
    const next = client.request('next');
    assert.deepEqual(state.requests[1].args, {});
    assert.notEqual(state.requests[0].id, state.requests[1].id);
    reply(state, 1);
    await next;
    assert.deepEqual(state.inputs[0].opens, [1]);
    assert.deepEqual(state.outputs[0].opens, [1]);
    client.close();
    client.close();
    released(state);
});

test('missing, fuzzy, duplicate and same-name ports cannot select a fallback', async () => {
    for (const config of [
        { inputNames: [] }, { outputNames: [] },
        { inputNames: [`${DEFAULT_INPUT} 1`] },
        { inputNames: [DEFAULT_INPUT, DEFAULT_INPUT] },
        { outputNames: [DEFAULT_OUTPUT, DEFAULT_OUTPUT] }
    ]) {
        const { state, driver } = native(config);
        const client = new MidiClient(options, driver);
        await assert.rejects(client.request('probe'), error => {
            assert.ok(error instanceof BridgeError);
            assert.match(error.code, /^MIDI_PORT_(NOT_FOUND|AMBIGUOUS)$/);
            assert.equal(error.execution, 'not_started');
            return true;
        });
        assert.ok([...state.inputs, ...state.outputs].every(port => port.opens.length === 0));
        await assert.rejects(client.request('retry'), { code: 'MIDI_FAULTED', execution: 'not_started' });
        assert.equal(state.inputs.length, 1);
        released(state);
    }
    assert.throws(() => new MidiClient({ ...options, output: DEFAULT_INPUT }), { code: 'INVALID_MIDI_OPTIONS' });
});

test('native construction and open failures release partial resources without retry', async () => {
    for (const config of [{ openFail: 'input' }, { openFail: 'output' }, { outputConstructorFail: true }]) {
        const { state, driver } = native(config);
        const client = new MidiClient(options, driver);
        await assert.rejects(client.request('probe'), { code: 'MIDI_OPEN_FAILED', execution: 'not_started' });
        await assert.rejects(client.request('again'), { code: 'MIDI_FAULTED' });
        assert.equal(state.sends, 0);
        assert.equal(state.inputs.length, 1);
        assert.ok([...state.inputs, ...state.outputs].every(port => port.opens.length <= 1));
        released(state);
    }
});

test('a synchronous disconnect while opening remains not_started', async () => {
    const { state, driver } = native({ disconnectOnOpen: 'input' });
    const client = new MidiClient(options, driver);
    await assert.rejects(client.request('probe'), { code: 'MIDI_DISCONNECTED', execution: 'not_started' });
    assert.equal(state.sends, 0);
    assert.equal(state.outputs[0].opens.length, 0);
    released(state);
});

test('timeout marks every pending submission unknown and permanently faults the client', async () => {
    const { state, driver } = native();
    const client = new MidiClient({ ...options, timeoutMs: 20 }, driver);
    const outcomes = await Promise.allSettled([client.request('first'), client.request('second')]);
    for (const outcome of outcomes) {
        assert.equal(outcome.status, 'rejected');
        assert.equal(outcome.reason.code, 'MIDI_TIMEOUT');
        assert.equal(outcome.reason.execution, 'unknown');
    }
    await assert.rejects(client.request('again'), { code: 'MIDI_FAULTED', execution: 'not_started' });
    assert.equal(state.sends, 2);
    released(state);
});

test('a read-only miss reports not_started and leaves the channel reusable without replay', async () => {
    const { state, driver } = native(), client = new MidiClient(options, driver);
    await assert.rejects(client.request('bridge.status', {}, undefined, { readOnly: true, timeoutMs: 20 }),
        { code: 'MIDI_TIMEOUT', execution: 'not_started' });
    assert.deepEqual(state.requests.map(request => request.op), ['bridge.status']);
    assert.ok(state.requests[0].deadline - Date.now() <= 20);
    assert.equal(state.inputs[0].closes, 1);
    assert.equal(state.outputs[0].closes, 1);
    const next = client.request('read');
    assert.equal(state.inputs.length, 2);
    const frames = protocol.encode({ v: 1, id: state.requests[1].id, ok: true, data: 'reopened' });
    for (const frame of frames) state.inputs[1].emit('message', 0, frame);
    assert.equal(await next, 'reopened');
    assert.deepEqual(state.requests.map(request => request.op), ['bridge.status', 'read']);
    client.close();
});

test('remote failures preserve code, details and execution receipts without transport retries', async () => {
    const { state, driver } = native();
    const client = new MidiClient(options, driver);
    for (const receipt of [undefined, 'not_started', 'submitted', 'unknown']) {
        const pending = client.request('mutation');
        reply(state, state.requests.length - 1, {
            ok: false, error: { code: 'REMOTE_REJECTED', message: 'Rejected', details: { receipt: 7 }, execution: receipt }
        });
        await assert.rejects(pending, {
            code: 'REMOTE_REJECTED', message: 'Rejected', details: { receipt: 7 }, execution: receipt || 'not_started'
        });
    }
    assert.equal(state.sends, 4);
    assert.equal(state.inputs[0].opens.length, 1);
    client.close();
    released(state);
});

test('IDs correlate out-of-order responses while unrelated MIDI and foreign IDs are ignored', async () => {
    const { state, driver } = native();
    const client = new MidiClient(options, driver);
    const first = client.request('first');
    const second = client.request('second');
    state.inputs[0].emit('message', 0, [144, 60, 100]);
    for (const frame of protocol.encode({ v: 1, id: 'f'.repeat(32), ok: true, data: 'foreign' })) {
        state.inputs[0].emit('message', 0, frame);
    }
    reply(state, 1, { ok: true, data: 'second' });
    assert.equal(await second, 'second');
    const data = '\u97f3\u8f68'.repeat(150);
    const frames = protocol.encode({ v: 1, id: state.requests[0].id, ok: true, data });
    for (const frame of frames.reverse()) state.inputs[0].emit('message', 0, frame);
    assert.equal(await first, data);
    client.close();
    released(state);
});

test('pre-aborted requests allocate no handles and do not poison the client', async () => {
    const { state, driver } = native();
    const client = new MidiClient(options, driver);
    await assert.rejects(client.request('skip', {}, AbortSignal.abort()), {
        code: 'MIDI_CANCELLED', execution: 'not_started'
    });
    assert.equal(state.inputs.length, 0);
    const pending = client.request('allowed');
    reply(state, 0);
    await pending;
    client.close();
    released(state);
});

test('cancellation after sending faults all pending requests and removes abort listeners', async () => {
    const { state, driver } = native();
    const client = new MidiClient(options, driver);
    const controller = new AbortController();
    const outcomes = Promise.allSettled([
        client.request('first', {}, controller.signal), client.request('second')
    ]);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
    controller.abort();
    for (const result of await outcomes) {
        assert.equal(result.status, 'rejected');
        assert.equal(result.reason.execution, 'unknown');
        assert.equal(result.reason.code, 'MIDI_CANCELLED');
    }
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    await assert.rejects(client.request('again'), { code: 'MIDI_FAULTED' });
    assert.equal(state.sends, 2);
    released(state);
});

test('a send exception is unknown even on the first frame and never resubmits', async () => {
    for (const sendFailAt of [1, 2]) {
        const { state, driver } = native({ sendFailAt });
        const client = new MidiClient(options, driver);
        await assert.rejects(client.request('large', { data: 'x'.repeat(1500) }), {
            code: 'MIDI_SEND_FAILED', execution: 'unknown'
        });
        await assert.rejects(client.request('again'), { code: 'MIDI_FAULTED' });
        assert.equal(state.sends, sendFailAt);
        released(state);
    }
});

test('invalid correlated envelopes and bridge protocol errors fault explicitly', async () => {
    for (const response of [
        { ok: true }, { ok: 'true', data: null },
        { ok: false, error: null },
        { ok: false, error: { code: 'BAD', message: 'bad', execution: 'done' } },
        { ok: true, data: null, error: { code: 'BAD', message: 'bad' } }
    ]) {
        const { state, driver } = native();
        const client = new MidiClient(options, driver);
        const pending = client.request('probe');
        reply(state, 0, response);
        await assert.rejects(pending, { code: 'MIDI_PROTOCOL_ERROR', execution: 'unknown' });
        released(state);
    }
    const { state, driver } = native();
    const client = new MidiClient(options, driver);
    const pending = client.request('probe');
    const frame = protocol.encode({ v: 1, id: state.requests[0].id, ok: true, data: null })[0];
    frame[frame.length - 1] = 0;
    state.inputs[0].emit('message', 0, frame);
    await assert.rejects(pending, { code: 'MIDI_PROTOCOL_ERROR', execution: 'unknown' });
    released(state);
});

test('disconnect events and disappearing outputs fault without reopening', async () => {
    for (const mode of ['event', 'enumeration']) {
        const { state, driver } = native();
        const client = new MidiClient(options, driver);
        const pending = client.request('probe');
        if (mode === 'event') state.inputs[0].emit('error', new Error('unplugged'));
        else state.outputNames = [];
        await assert.rejects(pending, { code: 'MIDI_DISCONNECTED', execution: 'unknown' });
        await assert.rejects(client.request('again'), { code: 'MIDI_FAULTED' });
        assert.equal(state.sends, 1);
        assert.equal(state.outputs[0].opens.length, 1);
        released(state);
    }
});

test('close rejects pending submissions, clears listeners and destroys after close failure', async () => {
    const { state, driver } = native({ closeFail: true });
    const client = new MidiClient(options, driver);
    const controller = new AbortController();
    const pending = client.request('probe', {}, controller.signal);
    client.close();
    client.close();
    await assert.rejects(pending, { code: 'MIDI_CLOSED', execution: 'unknown' });
    await assert.rejects(client.request('again'), { code: 'MIDI_CLOSED', execution: 'not_started' });
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    released(state);
});

test('32 pending requests are admitted; the 33rd is rejected without disturbing them', async () => {
    const { state, driver } = native();
    const client = new MidiClient(options, driver);
    const pending = Array.from({ length: 32 }, () => client.request('probe'));
    await assert.rejects(client.request('overflow'), { code: 'MIDI_BUSY', execution: 'not_started' });
    assert.equal(state.sends, 32);
    assert.equal(new Set(state.requests.map(request => request.id)).size, 32);
    for (let index = 31; index >= 0; index--) reply(state, index, { ok: true, data: index });
    assert.deepEqual(await Promise.all(pending), Array.from({ length: 32 }, (_, index) => index));
    client.close();
    released(state);
});

test('ports lists exact names without opening and default loading uses only the lazy entry', async () => {
    const listing = native({ inputNames: ['Input', 'Input'], outputNames: ['Output'] });
    await withNative(listing.driver, async loads => {
        const client = new MidiClient(options);
        assert.deepEqual(loads, []);
        assert.deepEqual(MidiClient.ports(), { inputs: ['Input', 'Input'], outputs: ['Output'] });
        assert.deepEqual(loads, ['@julusian/midi/lazy']);
        assert.ok([...listing.state.inputs, ...listing.state.outputs].every(port => port.opens.length === 0));
        client.close();
    });
    released(listing.state);
    const { state, driver } = native();
    await withNative(driver, async loads => {
        const client = new MidiClient(options);
        const pending = client.request('probe');
        reply(state, 0);
        await pending;
        assert.deepEqual(loads, ['@julusian/midi/lazy']);
        client.close();
    });
    released(state);
    const failed = native({ outputConstructorFail: true });
    await withNative(failed.driver, () => {
        assert.throws(() => MidiClient.ports(), { code: 'MIDI_PORTS_FAILED', execution: 'not_started' });
    });
    released(failed.state);
});

// ---- session 30: a lost response is read again by request ID, the operation is never resent ----

async function untilRequest(state, count) {
    for (let waited = 0; state.requests.length < count; waited += 25) {
        assert.ok(waited < 3000, 'the client did not send the expected request');
        await new Promise(resolve => setTimeout(resolve, 25));
    }
}

test('a lost response is recovered through the stored response of the bridge without resending the operation', async () => {
    const { state, driver } = native();
    const client = new MidiClient({ ...options, timeoutMs: 4000 }, driver);
    const pending = client.request('parameters.set', { session: 'instance-7', value: 1 });
    // The bridge executed the request, but its response frames never arrive.
    await untilRequest(state, 2);
    const [operation, lookup] = state.requests;
    assert.equal(operation.op, 'parameters.set');
    assert.deepEqual([lookup.op, lookup.args], ['bridge.response', { requestId: operation.id, session: 'instance-7' }]);
    reply(state, 1, { ok: true, data: { state: 'completed', sameInstance: true,
        response: { v: 1, id: operation.id, ok: true, data: { execution: 'submitted', requestId: operation.id } } } });
    assert.deepEqual(await pending, { execution: 'submitted', requestId: operation.id });
    assert.deepEqual(state.requests.map(request => request.op), ['parameters.set', 'bridge.response']);
    // The client is still usable.
    const next = client.request('read');
    reply(state, 2, { ok: true, data: 'fine' });
    assert.equal(await next, 'fine');
    client.close();
    released(state);
});

test('a stored error response keeps its code and execution receipt', async () => {
    const { state, driver } = native();
    const client = new MidiClient({ ...options, timeoutMs: 4000 }, driver);
    const pending = client.request('commands.execute', { session: 'instance-7' });
    await untilRequest(state, 2);
    reply(state, 1, { ok: true, data: { state: 'completed', sameInstance: true,
        response: { v: 1, id: state.requests[0].id, ok: false, error: { code: 'COMMAND_UNAVAILABLE', message: 'Not now', execution: 'not_started' } } } });
    await assert.rejects(pending, { code: 'COMMAND_UNAVAILABLE', execution: 'not_started' });
    client.close();
    released(state);
});

test('a request the same bridge instance never admitted is settled as not started', async () => {
    const { state, driver } = native();
    const client = new MidiClient({ ...options, timeoutMs: 4000 }, driver);
    const pending = client.request('parameters.set', { session: 'instance-7' });
    await untilRequest(state, 2);
    reply(state, 1, { ok: true, data: { state: 'unknown', sameInstance: true } });
    await assert.rejects(pending, { code: 'REQUEST_NOT_ADMITTED', execution: 'not_started' });
    const next = client.request('read');
    reply(state, 2, { ok: true, data: 'fine' });
    assert.equal(await next, 'fine');
    client.close();
    released(state);
});

test('an inconclusive look-up leaves the outcome unknown and the request times out as before', async () => {
    const { state, driver } = native();
    const client = new MidiClient({ ...options, timeoutMs: 2200 }, driver);
    const pending = client.request('parameters.set', { session: 'instance-7' });
    await untilRequest(state, 2);
    // Another script instance cannot vouch for this request ID.
    reply(state, 1, { ok: true, data: { state: 'unknown', sameInstance: false } });
    await assert.rejects(pending, { code: 'MIDI_TIMEOUT', execution: 'unknown' });
    assert.equal(state.requests.filter(request => request.op === 'parameters.set').length, 1);
    await assert.rejects(client.request('again'), { code: 'MIDI_FAULTED', execution: 'not_started' });
    released(state);
});
