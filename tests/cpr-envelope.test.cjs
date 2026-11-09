'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inspectCprEnvelope } = require('../scripts/inspect-cpr-envelope.cjs');

function word(value) { const bytes = Buffer.alloc(4); bytes.writeUInt32BE(value); return bytes; }
function chunk(tag, bytes) { return Buffer.concat([Buffer.from(tag, 'ascii'), word(bytes.length), bytes]); }
function rootField(value) { const bytes = Buffer.from(value, 'utf8'); return Buffer.concat([word(bytes.length), bytes]); }
function envelope(chunks) {
    const body = Buffer.concat(chunks);
    return Buffer.concat([Buffer.from('RIFF'), word(body.length), Buffer.from('NUND'), body]);
}

test('observed CPR envelope is inspected without treating archive framing as content verification', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubase-cpr-envelope-'));
    const file = path.join(dir, 'fixture.cpr');
    try {
        const valid = envelope([chunk('ROOT', Buffer.concat([rootField('Arrangement1'), rootField('PArrangement')])),
            chunk('ARCH', Buffer.from([0, 255, 2]))]);
        fs.writeFileSync(file, valid);
        const result = inspectCprEnvelope(file);
        assert.equal(result.size, valid.length);
        assert.deepEqual(result.chunks.map(item => item.tag), ['ROOT', 'ARCH']);
        assert.deepEqual(result.chunks[0].fields, ['Arrangement1', 'PArrangement']);
        assert.match(result.limitation, /not validated/);

        const badSize = Buffer.from(valid); badSize.writeUInt32BE(valid.length - 13, 4);
        fs.writeFileSync(file, badSize);
        assert.throws(() => inspectCprEnvelope(file), { code: 'SIZE_MISMATCH' });

        const badChunk = Buffer.from(valid); badChunk.writeUInt32BE(0xffffffff, 16);
        fs.writeFileSync(file, badChunk);
        assert.throws(() => inspectCprEnvelope(file), { code: 'TRUNCATED_CHUNK' });

        fs.writeFileSync(file, envelope([chunk('ROOT', Buffer.from([0, 0, 0, 3, 65]))]));
        assert.throws(() => inspectCprEnvelope(file), { code: 'INVALID_ROOT' });

        fs.writeFileSync(file, Buffer.from('not a project'));
        assert.throws(() => inspectCprEnvelope(file), { code: 'UNRECOGNIZED_ENVELOPE' });
    } finally {
        if (fs.existsSync(file)) fs.unlinkSync(file);
        fs.rmdirSync(dir);
    }
});
