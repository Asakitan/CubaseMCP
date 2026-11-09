'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { volumeWriteAndRestore } = require('../scripts/verify-live.cjs');

test('live volume verifier never restores after an uncertain write or unobserved target', async () => {
    const writes = [];
    await assert.rejects(volumeWriteAndRestore(0.2, 0.75, async value => {
        writes.push(value);
        throw new Error('unknown write');
    }, async () => { throw new Error('must not observe'); }), /unknown write/);
    assert.deepEqual(writes, [0.75]);
    writes.length = 0;
    await assert.rejects(volumeWriteAndRestore(0.2, 0.75, async value => { writes.push(value); },
        async predicate => { assert.equal(predicate(0.3), false); return 0.3; }), /Requested value was not observed/);
    assert.deepEqual(writes, [0.75]);
});

test('live volume verifier restores once only after observing the requested value', async () => {
    const writes = [];
    const values = [0.75, 0.2];
    const result = await volumeWriteAndRestore(0.2, 0.75, async value => { writes.push(value); },
        async predicate => { const value = values.shift(); assert.equal(predicate(value), true); return value; });
    assert.deepEqual(writes, [0.75, 0.2]);
    assert.deepEqual(result, { original: 0.2, requested: 0.75, observed: 0.75, restored: 0.2 });
    const failingWrites = [];
    await assert.rejects(volumeWriteAndRestore(0.2, 0.75, async value => {
        failingWrites.push(value);
        if (value === 0.2) throw new Error('unknown restore');
    }, async () => 0.75), /unknown restore/);
    assert.deepEqual(failingWrites, [0.75, 0.2]);
});
