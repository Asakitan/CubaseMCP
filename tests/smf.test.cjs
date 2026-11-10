'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const smf = require(process.env.SMF_TEST_MODULE || '../dist/src/smf.js');

function ascii(text) {
    return Array.from(text, (c) => c.charCodeAt(0));
}

function u16(value) {
    return [(value >> 8) & 0xff, value & 0xff];
}

function u32(value) {
    return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function header({ format = 1, ntrks = 1, division = 96, length = 6 } = {}) {
    return Uint8Array.from([...ascii('MThd'), ...u32(length), ...u16(format), ...u16(ntrks), ...u16(division)]);
}

function chunk(tag, body) {
    const data = Uint8Array.from(body);
    const out = new Uint8Array(8 + data.length);
    out.set(ascii(tag), 0);
    out.set(u32(data.length), 4);
    out.set(data, 8);
    return out;
}

function concat(...parts) {
    const total = parts.reduce((n, part) => n + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

function indexOfSequence(bytes, sequence) {
    for (let i = 0; i + sequence.length <= bytes.length; i++) {
        let match = true;
        for (let j = 0; j < sequence.length; j++) {
            if (bytes[i + j] !== sequence[j]) {
                match = false;
                break;
            }
        }
        if (match) {
            return i;
        }
    }
    return -1;
}

function assertCode(fn, code) {
    assert.throws(fn, (err) => err instanceof smf.SmfError && err.code === code);
}

function assertInvalidInput(input) {
    assertCode(() => smf.buildSmf(input), 'SMF_INVALID_INPUT');
}

const END_OF_TRACK = [0x00, 0xff, 0x2f, 0x00];

test('build then parse round trip preserves every field', () => {
    const bytes = smf.buildSmf({
        ppq: 480,
        tempos: [{ ticks: 0, bpm: 120 }, { ticks: 1920, bpm: 90 }],
        timeSignatures: [{ ticks: 0, numerator: 3, denominator: 4 }, { ticks: 1440, numerator: 6, denominator: 8 }],
        markers: [{ ticks: 0, text: 'Intro' }, { ticks: 1920, text: 'Verse ü' }],
        tracks: [
            {
                name: 'Lead',
                notes: [
                    { pitch: 60, velocity: 90, releaseVelocity: 40, startTicks: 0, durationTicks: 480 },
                    { pitch: 64, startTicks: 480, durationTicks: 240 },
                ],
                controlChanges: [
                    { controller: 7, value: 100, ticks: 0 },
                    { controller: 64, value: 127, ticks: 960 },
                ],
                pitchBends: [
                    { value: -4096, ticks: 100 },
                    { value: 8191, ticks: 200 },
                ],
                programChanges: [{ program: 5, ticks: 0 }],
            },
            {
                name: 'Bass',
                channel: 2,
                notes: [{ pitch: 36, velocity: 127, releaseVelocity: 10, startTicks: 960, durationTicks: 960 }],
            },
        ],
    });

    const model = smf.parseSmf(bytes);

    assert.equal(model.format, 1);
    assert.equal(model.ppq, 480);
    assert.deepEqual(model.warnings, []);
    assert.equal(model.durationTicks, 1920);

    // Track 0 is the conductor; input tracks follow in order.
    assert.equal(model.tracks.length, 3);
    assert.deepEqual(model.tracks[0], { index: 0, name: null, eventCount: 7, noteCount: 0, endTicks: 1920 });
    assert.deepEqual(model.tracks[1], { index: 1, name: 'Lead', eventCount: 11, noteCount: 2, endTicks: 960 });
    assert.deepEqual(model.tracks[2], { index: 2, name: 'Bass', eventCount: 4, noteCount: 1, endTicks: 1920 });

    assert.deepEqual(model.notes, [
        { track: 1, channel: 0, pitch: 60, velocity: 90, releaseVelocity: 40, startTicks: 0, durationTicks: 480 },
        { track: 1, channel: 0, pitch: 64, velocity: 100, releaseVelocity: 64, startTicks: 480, durationTicks: 240 },
        { track: 2, channel: 2, pitch: 36, velocity: 127, releaseVelocity: 10, startTicks: 960, durationTicks: 960 },
    ]);

    assert.deepEqual(model.controlChanges, [
        { track: 1, channel: 0, controller: 7, value: 100, ticks: 0 },
        { track: 1, channel: 0, controller: 64, value: 127, ticks: 960 },
    ]);

    assert.deepEqual(model.pitchBends, [
        { track: 1, channel: 0, value: -4096, ticks: 100 },
        { track: 1, channel: 0, value: 8191, ticks: 200 },
    ]);

    assert.deepEqual(model.programChanges, [{ track: 1, channel: 0, program: 5, ticks: 0 }]);
    assert.deepEqual(model.channelPressures, []);
    assert.deepEqual(model.polyPressures, []);
    assert.deepEqual(model.keySignatures, []);

    assert.equal(model.tempos.length, 2);
    assert.deepEqual(model.tempos[0], { ticks: 0, microsecondsPerQuarter: 500000, bpm: 120 });
    assert.equal(model.tempos[1].ticks, 1920);
    assert.equal(model.tempos[1].microsecondsPerQuarter, 666667);
    assert.ok(Math.abs(model.tempos[1].bpm - 90) < 0.001);

    assert.deepEqual(model.timeSignatures, [
        { ticks: 0, numerator: 3, denominator: 4 },
        { ticks: 1440, numerator: 6, denominator: 8 },
    ]);
    assert.deepEqual(model.markers, [
        { ticks: 0, text: 'Intro' },
        { ticks: 1920, text: 'Verse ü' },
    ]);
});

test('hand-written file with running status and Note On velocity 0', () => {
    const body = [
        0x00, 0x90, 0x3c, 0x64,   // t0    Note On 60 velocity 100 (sets running status 0x90)
        0x60, 0x3c, 0x00,         // t96   running status: Note On 60 velocity 0 = Note Off, release 64
        0x00, 0x3e, 0x50,         // t96   running status: Note On 62 velocity 80
        0x30, 0x3e, 0x00,         // t144  Note On 62 velocity 0 = Note Off
        0x00, 0xb0, 0x07, 0x7f,   // t144  Control Change 7 = 127 (sets running status 0xB0)
        0x10, 0x07, 0x40,         // t160  running status: Control Change 7 = 64
        ...END_OF_TRACK,          // t160
    ];
    const bytes = concat(header({ format: 0, ntrks: 1, division: 96 }), chunk('MTrk', body));

    const model = smf.parseSmf(bytes);

    assert.equal(model.format, 0);
    assert.equal(model.ppq, 96);
    assert.deepEqual(model.warnings, []);
    assert.deepEqual(model.tracks, [{ index: 0, name: null, eventCount: 7, noteCount: 2, endTicks: 160 }]);
    assert.deepEqual(model.notes, [
        { track: 0, channel: 0, pitch: 60, velocity: 100, releaseVelocity: 64, startTicks: 0, durationTicks: 96 },
        { track: 0, channel: 0, pitch: 62, velocity: 80, releaseVelocity: 64, startTicks: 96, durationTicks: 48 },
    ]);
    assert.deepEqual(model.controlChanges, [
        { track: 0, channel: 0, controller: 7, value: 127, ticks: 144 },
        { track: 0, channel: 0, controller: 7, value: 64, ticks: 160 },
    ]);
    assert.equal(model.durationTicks, 160);
});

test('running status is cancelled by a meta event', () => {
    const body = [
        0x00, 0x90, 0x3c, 0x64,
        0x00, 0xff, 0x03, 0x00,   // empty track name cancels running status
        0x00, 0x3c, 0x64,         // data byte with no running status
        ...END_OF_TRACK,
    ];
    const bytes = concat(header(), chunk('MTrk', body));
    assertCode(() => smf.parseSmf(bytes), 'SMF_BAD_EVENT');
});

test('overlapping same-pitch notes pair FIFO with the earliest open Note On', () => {
    const bytes = smf.buildSmf({
        tracks: [{
            notes: [
                { pitch: 60, velocity: 100, releaseVelocity: 10, startTicks: 0, durationTicks: 20 },
                { pitch: 60, velocity: 90, releaseVelocity: 20, startTicks: 10, durationTicks: 20 },
            ],
        }],
    });
    const model = smf.parseSmf(bytes);
    assert.deepEqual(model.warnings, []);
    assert.deepEqual(model.notes, [
        { track: 1, channel: 0, pitch: 60, velocity: 100, releaseVelocity: 10, startTicks: 0, durationTicks: 20 },
        { track: 1, channel: 0, pitch: 60, velocity: 90, releaseVelocity: 20, startTicks: 10, durationTicks: 20 },
    ]);
});

test('Note Off is written before Note On at the same tick', () => {
    const bytes = smf.buildSmf({
        tracks: [{
            notes: [
                { pitch: 60, startTicks: 0, durationTicks: 20 },
                { pitch: 60, velocity: 77, startTicks: 20, durationTicks: 20 },
            ],
        }],
    });
    const noteOff = indexOfSequence(bytes, [0x80, 0x3c, 0x40]);
    const noteOn = indexOfSequence(bytes, [0x90, 0x3c, 0x4d]);
    assert.ok(noteOff >= 0, 'Note Off bytes not found');
    assert.ok(noteOn >= 0, 'Note On bytes not found');
    assert.ok(noteOff < noteOn, 'Note Off must precede Note On at the same tick');

    const model = smf.parseSmf(bytes);
    assert.deepEqual(model.warnings, []);
    assert.equal(model.notes.length, 2);
    assert.equal(model.notes[0].durationTicks, 20);
    assert.equal(model.notes[1].durationTicks, 20);
});

test('zero-duration notes are kept without warnings', () => {
    const bytes = smf.buildSmf({
        tracks: [{ notes: [{ pitch: 48, startTicks: 100, durationTicks: 0 }] }],
    });
    const model = smf.parseSmf(bytes);
    assert.deepEqual(model.warnings, []);
    assert.equal(model.notes.length, 1);
    assert.equal(model.notes[0].startTicks, 100);
    assert.equal(model.notes[0].durationTicks, 0);
});

test('orphan Note Off and unclosed note produce warnings instead of errors', () => {
    const orphan = concat(header({ format: 0 }), chunk('MTrk', [0x00, 0x80, 0x3c, 0x40, ...END_OF_TRACK]));
    const orphanModel = smf.parseSmf(orphan);
    assert.equal(orphanModel.warnings.length, 1);
    assert.equal(orphanModel.notes.length, 0);

    const open = concat(header({ format: 0 }), chunk('MTrk', [0x00, 0x90, 0x3c, 0x64, 0x60, 0xff, 0x2f, 0x00]));
    const openModel = smf.parseSmf(open);
    assert.equal(openModel.warnings.length, 1);
    assert.equal(openModel.notes.length, 1);
    assert.equal(openModel.notes[0].durationTicks, 96);
    assert.equal(openModel.notes[0].releaseVelocity, 64);
});

test('SysEx events are skipped by length and cancel running status', () => {
    const body = [
        0x00, 0xf0, 0x02, 0x41, 0xf7,   // SysEx with 2 data bytes
        0x00, 0x90, 0x3c, 0x64,
        0x60, 0x3c, 0x00,
        ...END_OF_TRACK,
    ];
    const model = smf.parseSmf(concat(header({ format: 0 }), chunk('MTrk', body)));
    assert.deepEqual(model.warnings, []);
    assert.equal(model.tracks[0].eventCount, 4);
    assert.equal(model.notes.length, 1);
    assert.equal(model.notes[0].durationTicks, 96);
});

test('end-of-track stops reading and ignores trailing bytes in the chunk', () => {
    const body = [0x00, 0x90, 0x3c, 0x64, 0x10, 0x3c, 0x00, ...END_OF_TRACK, 0x00, 0x90, 0x40, 0x64];
    const model = smf.parseSmf(concat(header({ format: 0 }), chunk('MTrk', body)));
    assert.equal(model.notes.length, 1);
    assert.equal(model.tracks[0].eventCount, 3);
});

test('unknown chunks are skipped by length', () => {
    const bytes = concat(
        header({ ntrks: 1 }),
        chunk('XYZW', [1, 2, 3]),
        chunk('MTrk', [0x00, 0xb0, 0x07, 0x64, ...END_OF_TRACK]),
    );
    const model = smf.parseSmf(bytes);
    assert.deepEqual(model.warnings, []);
    assert.equal(model.tracks.length, 1);
    assert.equal(model.controlChanges.length, 1);
});

test('missing MTrk chunks and extra trailing bytes produce warnings', () => {
    const missing = concat(
        header({ ntrks: 2 }),
        chunk('XYZW', [9, 9]),
        chunk('MTrk', END_OF_TRACK),
    );
    const missingModel = smf.parseSmf(missing);
    assert.equal(missingModel.tracks.length, 1);
    assert.equal(missingModel.warnings.length, 1);
    assert.match(missingModel.warnings[0], /declares 2/);

    const trailing = concat(header({ ntrks: 1 }), chunk('MTrk', END_OF_TRACK), Uint8Array.from([0xde, 0xad]));
    const trailingModel = smf.parseSmf(trailing);
    assert.equal(trailingModel.tracks.length, 1);
    assert.equal(trailingModel.warnings.length, 1);
    assert.match(trailingModel.warnings[0], /2 extra byte/);
});

test('wrong-length known meta events are skipped with a warning', () => {
    const body = [
        0x00, 0xff, 0x51, 0x02, 0x07, 0xa1,   // tempo with length 2
        0x00, 0xff, 0x58, 0x03, 0x04, 0x02, 0x18,   // time signature with length 3
        ...END_OF_TRACK,
    ];
    const model = smf.parseSmf(concat(header({ format: 0 }), chunk('MTrk', body)));
    assert.equal(model.tempos.length, 0);
    assert.equal(model.timeSignatures.length, 0);
    assert.equal(model.warnings.length, 2);
});

test('key signature, track name and marker meta events decode', () => {
    const body = [
        0x00, 0xff, 0x03, 0x04, ...ascii('Keys'),
        0x00, 0xff, 0x59, 0x02, 0xfd, 0x01,   // 3 flats, minor
        0x00, 0xff, 0x06, 0x02, ...ascii('ab'),
        0x00, 0xff, 0x03, 0x02, ...ascii('no'),  // second name ignored
        ...END_OF_TRACK,
    ];
    const model = smf.parseSmf(concat(header({ format: 0 }), chunk('MTrk', body)));
    assert.equal(model.tracks[0].name, 'Keys');
    assert.deepEqual(model.keySignatures, [{ ticks: 0, sharpsFlats: -3, minor: true }]);
    assert.deepEqual(model.markers, [{ ticks: 0, text: 'ab' }]);
});

test('parser errors: file too large', () => {
    assertCode(() => smf.parseSmf(new Uint8Array(16 * 1024 * 1024 + 1)), 'SMF_TOO_LARGE');
});

test('parser errors: bad header', () => {
    assertCode(() => smf.parseSmf(new Uint8Array(14)), 'SMF_HEADER');
    assertCode(() => smf.parseSmf(header({ length: 5 })), 'SMF_HEADER');
    assertCode(() => smf.parseSmf(concat(header({ format: 2 }), chunk('MTrk', END_OF_TRACK))), 'SMF_HEADER');
    assertCode(() => smf.parseSmf(header({ ntrks: 0 })), 'SMF_HEADER');
    assertCode(() => smf.parseSmf(header({ ntrks: 257 })), 'SMF_HEADER');
    assertCode(() => smf.parseSmf(concat(header({ format: 0, ntrks: 2 }), chunk('MTrk', END_OF_TRACK))), 'SMF_HEADER');
});

test('parser errors: SMPTE division', () => {
    assertCode(() => smf.parseSmf(concat(header({ division: 0xe250 }), chunk('MTrk', END_OF_TRACK))), 'SMF_SMPTE_DIVISION');
});

test('parser errors: truncated input', () => {
    assertCode(() => smf.parseSmf(header({ length: 6 }).subarray(0, 10)), 'SMF_TRUNCATED');
    assertCode(() => smf.parseSmf(concat(header(), Uint8Array.from([...ascii('MTrk'), ...u32(100), 0, 0, 0]))), 'SMF_TRUNCATED');
    // Note On whose velocity byte is past the end of the chunk
    assertCode(() => smf.parseSmf(concat(header(), chunk('MTrk', [0x00, 0x90, 0x3c]))), 'SMF_TRUNCATED');
    // Variable-length delta cut off by the end of the chunk
    assertCode(() => smf.parseSmf(concat(header(), chunk('MTrk', [0x80]))), 'SMF_TRUNCATED');
});

test('parser errors: bad events', () => {
    assertCode(() => smf.parseSmf(concat(header(), chunk('MTrk', [0x00, 0x3c, 0x64, ...END_OF_TRACK]))), 'SMF_BAD_EVENT');
    assertCode(() => smf.parseSmf(concat(header(), chunk('MTrk', [0x80, 0x80, 0x80, 0x80, 0x00, ...END_OF_TRACK]))), 'SMF_BAD_EVENT');
});

test('parser errors: too many events', () => {
    const count = 500001;
    const body = new Uint8Array(count * 4);
    for (let i = 0; i < count; i++) {
        body.set([0x00, 0xff, 0x01, 0x00], i * 4);   // empty text meta event
    }
    const bytes = concat(header(), chunk('MTrk', body));
    assertCode(() => smf.parseSmf(bytes), 'SMF_TOO_MANY_EVENTS');
});

test('builder rejects invalid input', () => {
    assertInvalidInput({ tracks: [] });
    assertInvalidInput({ tracks: Array.from({ length: 65 }, () => ({})) });
    assertInvalidInput({ ppq: 23, tracks: [{}] });
    assertInvalidInput({ ppq: 961, tracks: [{}] });
    assertInvalidInput({ ppq: 480.5, tracks: [{}] });
    assertInvalidInput({ tracks: [{ notes: [{ pitch: 128, startTicks: 0, durationTicks: 1 }] }] });
    assertInvalidInput({ tracks: [{ notes: [{ pitch: 60, velocity: 0, startTicks: 0, durationTicks: 1 }] }] });
    assertInvalidInput({ tracks: [{ notes: [{ pitch: 60, velocity: 128, startTicks: 0, durationTicks: 1 }] }] });
    assertInvalidInput({ tracks: [{ notes: [{ pitch: 60, releaseVelocity: 128, startTicks: 0, durationTicks: 1 }] }] });
    assertInvalidInput({ tracks: [{ channel: 16 }] });
    assertInvalidInput({ tracks: [{ notes: [{ pitch: 60, channel: -1, startTicks: 0, durationTicks: 1 }] }] });
    assertInvalidInput({ tracks: [{ notes: [{ pitch: 60, startTicks: -1, durationTicks: 1 }] }] });
    assertInvalidInput({ tracks: [{ notes: [{ pitch: 60, startTicks: 1.5, durationTicks: 1 }] }] });
    assertInvalidInput({ tracks: [{ notes: [{ pitch: 60, startTicks: 0, durationTicks: 0x10000000 }] }] });
    assertInvalidInput({ tracks: [{ notes: [{ pitch: 60, startTicks: 0x0fffffff, durationTicks: 1 }] }] });
    assertInvalidInput({ tracks: [{ controlChanges: [{ controller: 128, value: 0, ticks: 0 }] }] });
    assertInvalidInput({ tracks: [{ controlChanges: [{ controller: 1, value: 128, ticks: 0 }] }] });
    assertInvalidInput({ tracks: [{ pitchBends: [{ value: 8192, ticks: 0 }] }] });
    assertInvalidInput({ tracks: [{ pitchBends: [{ value: -8193, ticks: 0 }] }] });
    assertInvalidInput({ tracks: [{ programChanges: [{ program: 128, ticks: 0 }] }] });
    assertInvalidInput({ tempos: [{ ticks: 0, bpm: 0 }], tracks: [{}] });
    assertInvalidInput({ tempos: [{ ticks: 0, bpm: Number.NaN }], tracks: [{}] });
    assertInvalidInput({ tempos: [{ ticks: 0, bpm: 1000 }], tracks: [{}] });
    assertInvalidInput({ tempos: [{ ticks: 0, bpm: 2 }], tracks: [{}] });
    assertInvalidInput({ timeSignatures: [{ ticks: 0, numerator: 0, denominator: 4 }], tracks: [{}] });
    assertInvalidInput({ timeSignatures: [{ ticks: 0, numerator: 256, denominator: 4 }], tracks: [{}] });
    assertInvalidInput({ timeSignatures: [{ ticks: 0, numerator: 3, denominator: 3 }], tracks: [{}] });
    assertInvalidInput({ markers: [{ ticks: 0, text: 'x'.repeat(256) }], tracks: [{}] });
    assertInvalidInput({ tracks: [{ name: 'a'.repeat(256) }] });
    assertInvalidInput({ tracks: [{ name: '€'.repeat(86) }] });   // 258 UTF-8 bytes
    assertInvalidInput({
        tracks: [{ controlChanges: Array.from({ length: 200001 }, () => ({ controller: 1, value: 1, ticks: 0 })) }],
    });
});

test('builder accepts the boundary values', () => {
    const bytes = smf.buildSmf({
        ppq: 24,
        tempos: [{ ticks: 0, bpm: 999 }],
        timeSignatures: [{ ticks: 0, numerator: 255, denominator: 64 }],
        tracks: [{
            name: 'x'.repeat(255),
            notes: [{ pitch: 127, velocity: 127, releaseVelocity: 0, startTicks: 0x0fffffff, durationTicks: 0 }],
            pitchBends: [{ value: -8192, ticks: 0 }, { value: 8191, ticks: 0 }],
        }],
    });
    const model = smf.parseSmf(bytes);
    assert.equal(model.ppq, 24);
    assert.equal(model.tracks[1].name.length, 255);
    assert.equal(model.notes[0].startTicks, 0x0fffffff);
    assert.deepEqual(model.pitchBends.map((b) => b.value), [-8192, 8191]);
    assert.equal(model.timeSignatures[0].denominator, 64);
});

test('builder uses default ppq, velocity, release velocity and channel', () => {
    const bytes = smf.buildSmf({ tracks: [{ channel: 9, notes: [{ pitch: 40, startTicks: 0, durationTicks: 480 }] }] });
    const model = smf.parseSmf(bytes);
    assert.equal(model.ppq, 480);
    assert.deepEqual(model.notes, [
        { track: 1, channel: 9, pitch: 40, velocity: 100, releaseVelocity: 64, startTicks: 0, durationTicks: 480 },
    ]);
    assert.deepEqual(model.tempos, []);
});

test('marker text of 128 to 255 bytes uses a variable-length meta size', () => {
    const text = 'm'.repeat(200);
    const model = smf.parseSmf(smf.buildSmf({ markers: [{ ticks: 96, text }], tracks: [{ notes: [{ pitch: 60, startTicks: 0, durationTicks: 480 }] }] }));
    assert.deepEqual(model.markers, [{ ticks: 96, text }]);
    assert.equal(model.notes.length, 1);
    assert.deepEqual(model.warnings, []);
});
