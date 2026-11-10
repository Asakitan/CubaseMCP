'use strict';

// Offline smoke test for the session-30 diagnostic controller. The generic fake host only
// checks ES5 syntax, construction and the request loop; it does not model Cubase binding
// propagation and is not evidence about the real host.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
const protocol = require('../remote/protocol.js');
const directory = path.join(__dirname, '../diagnostics/binding-scale-30');

function auto(name, overrides) {
    const store = Object.assign({}, overrides);
    return new Proxy(function () {}, {
        get(target, key) {
            if (typeof key === 'symbol' || key === 'then' || key === 'toJSON') return undefined;
            if (!(key in store)) store[key] = auto(name + '.' + String(key));
            return store[key];
        },
        set(target, key, value) { store[key] = value; return true; },
        apply() {
            if (/\.(getSize|getNumberOfInsertEffectSlots)$/.test(name)) return 4;
            return auto(name + '()');
        }
    });
}

function harness() {
    const frames = [], pages = [], lines = [];
    const input = {};
    const output = { sendMidi(device, frame) { frames.push(frame); } };
    const driver = auto('driver', {
        mPorts: { makeMidiInput: () => input, makeMidiOutput: () => output },
        mMapping: { makePage(name) { const page = auto('page:' + name); pages.push(page); return page; } }
    });
    const api = auto('api', { makeDeviceDriver: () => driver });
    const controller = require(path.join(directory, 'controller.js')).createController(api, { log: line => lines.push(line) });
    const device = {}, mapping = {};
    const decoder = protocol.createDecoder();
    let counter = 0;
    function call(op, args) {
        const id = (++counter).toString(16).padStart(32, '0');
        for (const frame of protocol.encode({ v: 1, id, deadline: Date.now() + 5000, op, args: args || {} })) input.mOnSysex(device, frame);
        for (let turn = 0; turn < 400; turn++) {
            pages[0].mOnIdle(device, mapping);
            while (frames.length) {
                const reply = decoder.accept(frames.shift(), Date.now());
                if (reply && reply.id === id) return reply;
            }
        }
        throw new Error('no reply');
    }
    pages[0].mOnActivate(device, mapping);
    return { controller, pages, lines, call };
}

test('binding-scale-30 diagnostic files are ES5 and construct thirteen pages', () => {
    for (const name of ['controller.js', 'command-sample.js', 'protocol.js', 'CubaseAI_MCP.js'])
        acorn.parse(fs.readFileSync(path.join(directory, name), 'utf8'), { ecmaVersion: 5, sourceType: 'script', allowReturnOutsideFunction: true });
    const instance = harness();
    assert.equal(instance.pages.length, 13);
    const status = instance.call('diag.status');
    assert.equal(status.ok, true, JSON.stringify(status));
    assert.equal(status.data.profile, 'binding-scale-30');
    assert.equal(status.data.page, 0);
    assert.equal(status.data.pages[0].bindings, 0);
    assert.equal(status.data.pages[3].bindings, 200);
    assert.ok(status.data.pages[5].bindings > 2000, String(status.data.pages[5].bindings));
    assert.deepEqual(status.data.pages.map(page => page.probeErrors.length), new Array(13).fill(0));
    assert.ok(instance.lines.includes('[CubaseAI MCP] DIAGNOSTIC binding-scale-30 (not the production controller)'));
    assert.equal(instance.call('diag.script', { probe: 'B' }).data.pulsed, true);
    assert.equal(instance.call('diag.read').data.page, 0);
    assert.equal(instance.call('diag.script', { probe: 'Z' }).ok, false);
});
