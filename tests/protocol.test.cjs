'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const protocol = require('../remote/protocol.js');

test('bounded 7-bit SysEx preserves Unicode, out-of-order chunks and duplicate fragments', () => {
    const request = { v: 1, id: '0123456789abcdef0123456789abcdef', op: 'probe', args: { text: '\u97f3\u8f68\ud83c\udfb5'.repeat(300) } };
    const frames = protocol.encode(request);
    assert.ok(frames.length > 1);
    assert.ok(frames.every(frame => frame.length <= 1024 && frame.slice(1, -1).every(byte => byte < 128)));
    const decoder = protocol.createDecoder();
    assert.equal(decoder.accept(frames.at(-1), 0), null);
    assert.equal(decoder.accept(frames.at(-1), 1), null);
    let result;
    for (const frame of frames.slice(0, -1).reverse()) result = decoder.accept(frame, 2);
    assert.deepEqual(result, request);
});

test('rejects corruption, oversize payloads and foreign protocol versions', () => {
    const request = { v: 1, id: '0123456789abcdef0123456789abcdef', op: 'probe' };
    const bad = protocol.encode(request)[0].slice();
    const payload = String.fromCharCode(...bad.slice(7, -1));
    const changed = payload.replace('probe', 'probf');
    const corrupted = bad.slice(0, 7).concat(Array.from(changed, character => character.charCodeAt(0)), 247);
    assert.throws(() => protocol.createDecoder().accept(corrupted, 0), /CHECKSUM_MISMATCH/);
    assert.throws(() => protocol.encode({ ...request, text: 'x'.repeat(protocol.maxBytes) }), /PAYLOAD_TOO_LARGE/);
    assert.throws(() => protocol.createDecoder().accept(protocol.encode({ ...request, v: 2 })[0], 0), /PROTOCOL_MISMATCH/);
    assert.equal(protocol.createDecoder().accept([144, 60, 100], 0), null);
});