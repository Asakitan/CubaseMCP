'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const song = require('../dist/src/song.js');
const smf = require('../dist/src/smf.js');

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function twoTrackSong() {
    return {
        ppq: 480,
        tracks: [
            {
                name: 'Keys',
                channel: 0,
                program: 4,
                notes: [
                    { pitch: 60, start: 0, duration: 1, velocity: 90 },
                    { pitch: 64, start: 1.5, duration: 0.5 },
                    { pitch: 67, start: 2, duration: 2, velocity: 110 },
                ],
            },
            {
                name: 'Drums',
                channel: 9,
                notes: [
                    { pitch: 36, start: 0, duration: 0.25 },
                    { pitch: 38, start: 1, duration: 0.25, velocity: 120 },
                ],
                controlChanges: [{ controller: 7, value: 90, beat: 0 }],
                pitchBends: [{ value: -200, beat: 2 }],
            },
        ],
    };
}

function minimalSong() {
    return { tracks: [{ notes: [{ pitch: 60, start: 0, duration: 1 }] }] };
}

async function withTempDir(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-test-'));
    try {
        await fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('songToSmf round trip preserves beats, ticks, names and conductor events', () => {
    const { bytes, summary } = song.songToSmf(twoTrackSong());
    const model = smf.parseSmf(bytes);

    assert.equal(model.format, 1);
    assert.equal(model.ppq, 480);

    // Track 0 is the conductor; the two song tracks follow.
    assert.equal(model.tracks.length, 3);
    assert.equal(model.tracks[0].name, null);
    assert.equal(model.tracks[1].name, 'Keys');
    assert.equal(model.tracks[2].name, 'Drums');

    assert.deepEqual(
        model.notes.filter((note) => note.track === 1).map((note) => ({
            pitch: note.pitch, channel: note.channel, velocity: note.velocity, startTicks: note.startTicks, durationTicks: note.durationTicks,
        })),
        [
            { pitch: 60, channel: 0, velocity: 90, startTicks: 0, durationTicks: 480 },
            { pitch: 64, channel: 0, velocity: 100, startTicks: 720, durationTicks: 240 },
            { pitch: 67, channel: 0, velocity: 110, startTicks: 960, durationTicks: 960 },
        ],
    );
    assert.deepEqual(
        model.notes.filter((note) => note.track === 2).map((note) => ({
            pitch: note.pitch, channel: note.channel, velocity: note.velocity, startTicks: note.startTicks, durationTicks: note.durationTicks,
        })),
        [
            { pitch: 36, channel: 9, velocity: 100, startTicks: 0, durationTicks: 120 },
            { pitch: 38, channel: 9, velocity: 120, startTicks: 480, durationTicks: 120 },
        ],
    );

    assert.deepEqual(model.programChanges, [{ track: 1, channel: 0, program: 4, ticks: 0 }]);
    assert.deepEqual(model.controlChanges, [{ track: 2, channel: 9, controller: 7, value: 90, ticks: 0 }]);
    assert.deepEqual(model.pitchBends, [{ track: 2, channel: 9, value: -200, ticks: 960 }]);

    assert.equal(model.tempos.length, 1);
    assert.equal(model.tempos[0].ticks, 0);
    assert.ok(Math.abs(model.tempos[0].bpm - 120) < 0.01);
    assert.deepEqual(model.timeSignatures, [{ ticks: 0, numerator: 4, denominator: 4 }]);

    assert.deepEqual(summary, {
        ppq: 480,
        trackCount: 2,
        noteCount: 5,
        durationBeats: 4,
        tracks: [
            { name: 'Keys', channel: 0, program: 4, noteCount: 3, lowestPitch: 60, highestPitch: 67, endBeat: 4 },
            { name: 'Drums', channel: 9, program: null, noteCount: 2, lowestPitch: 36, highestPitch: 38, endBeat: 1.25 },
        ],
    });
});

test('conductor values are written into track 0', () => {
    const { bytes } = song.songToSmf(minimalSong(), { bpm: 96, numerator: 3, denominator: 4 });
    const model = smf.parseSmf(bytes);

    assert.equal(model.tempos.length, 1);
    assert.equal(model.tempos[0].ticks, 0);
    assert.ok(Math.abs(model.tempos[0].bpm - 96) < 0.01, `bpm was ${model.tempos[0].bpm}`);
    assert.deepEqual(model.timeSignatures, [{ ticks: 0, numerator: 3, denominator: 4 }]);
});

test('songToSmf rejects invalid input with SMF_INVALID_INPUT', () => {
    assert.throws(
        () => song.songToSmf({ tracks: [{ name: 'Empty' }] }),
        (error) => error.code === 'SMF_INVALID_INPUT',
    );
    assert.throws(
        () => song.songToSmf({ tracks: [{ notes: [{ pitch: 60, start: -1, duration: 1 }] }] }),
        (error) => error.code === 'SMF_INVALID_INPUT',
    );
    assert.throws(
        () => song.songToSmf({ tracks: [{ notes: [{ pitch: 60, start: 0, duration: 0 }] }] }),
        (error) => error.code === 'SMF_INVALID_INPUT',
    );
});

test('a very short duration is kept as at least one tick', () => {
    const { bytes } = song.songToSmf({ ppq: 480, tracks: [{ notes: [{ pitch: 60, start: 0, duration: 0.0001 }] }] });
    const model = smf.parseSmf(bytes);

    assert.equal(model.notes.length, 1);
    assert.ok(model.notes[0].durationTicks >= 1, `durationTicks was ${model.notes[0].durationTicks}`);
});

test('describeMidi restores beats, track details and controller counts', () => {
    const { bytes } = song.songToSmf(twoTrackSong());
    const model = smf.parseSmf(bytes);
    const described = song.describeMidi(model);

    assert.deepEqual(
        described.notes.map((note) => ({ track: note.track, pitch: note.pitch, start: note.start, duration: note.duration })),
        [
            { track: 1, pitch: 60, start: 0, duration: 1 },
            { track: 2, pitch: 36, start: 0, duration: 0.25 },
            { track: 2, pitch: 38, start: 1, duration: 0.25 },
            { track: 1, pitch: 64, start: 1.5, duration: 0.5 },
            { track: 1, pitch: 67, start: 2, duration: 2 },
        ],
    );

    assert.deepEqual(described.tracks[1].channels, [0]);
    assert.deepEqual(described.tracks[1].programs, [{ channel: 0, program: 4, beat: 0 }]);
    assert.equal(described.tracks[2].controlChangeCount, 1);
    assert.equal(described.tracks[2].pitchBendCount, 1);
    assert.equal(described.noteTotal, 5);
    assert.equal(described.nextNoteOffset, null);
    assert.equal(Object.prototype.hasOwnProperty.call(described, 'controlChanges'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(described, 'pitchBends'), false);

    const withControllers = song.describeMidi(model, { includeControllers: true });
    assert.deepEqual(withControllers.controlChanges, [
        { track: 2, channel: 9, controller: 7, value: 90, beat: 0 },
    ]);
    assert.deepEqual(withControllers.pitchBends, [
        { track: 2, channel: 9, value: -200, beat: 2 },
    ]);
});

test('describeMidi pages and filters notes', () => {
    const { bytes } = song.songToSmf(twoTrackSong());
    const model = smf.parseSmf(bytes);

    const limited = song.describeMidi(model, { noteLimit: 2 });
    assert.deepEqual(limited.notes.map((note) => note.pitch), [60, 36]);
    assert.equal(limited.nextNoteOffset, 2);
    assert.equal(limited.noteTotal, 5);

    const last = song.describeMidi(model, { noteOffset: 4 });
    assert.equal(last.notes.length, 1);
    assert.equal(last.notes[0].pitch, 67);
    assert.equal(last.nextNoteOffset, null);

    const filtered = song.describeMidi(model, { track: 2 });
    assert.equal(filtered.noteTotal, 2);
    assert.ok(filtered.notes.every((note) => note.track === 2));
    assert.deepEqual(filtered.notes.map((note) => note.pitch), [36, 38]);

    const countOnly = song.describeMidi(model, { noteLimit: 0 });
    assert.deepEqual(countOnly.notes, []);
    assert.equal(countOnly.noteTotal, 5);
});

test('awaitWrittenMidiFile resolves a new file with identical bytes', async () => {
    await withTempDir(async (dir) => {
        const bytes = Buffer.from(song.songToSmf(twoTrackSong()).bytes);
        fs.writeFileSync(path.join(dir, 'Song.mid'), bytes);

        const result = await song.awaitWrittenMidiFile(dir, new Map(), 3000);
        assert.ok(result, 'expected the written file to be found');
        assert.equal(result.path, path.join(dir, 'Song.mid'));
        assert.ok(Buffer.from(result.bytes).equals(bytes));
    });
});

test('awaitWrittenMidiFile resolves a file overwritten after the snapshot', async () => {
    await withTempDir(async (dir) => {
        const first = Buffer.from(song.songToSmf(minimalSong()).bytes);
        const second = Buffer.from(song.songToSmf(twoTrackSong()).bytes);
        assert.notEqual(first.length, second.length);
        fs.writeFileSync(path.join(dir, 'Song.mid'), first);

        const before = await song.listMidiFiles(dir);
        await sleep(30);
        setTimeout(() => fs.writeFileSync(path.join(dir, 'Song.mid'), second), 100);

        const result = await song.awaitWrittenMidiFile(dir, before, 3000);
        assert.ok(result, 'expected the overwritten file to be found');
        assert.equal(result.path, path.join(dir, 'Song.mid'));
        assert.ok(Buffer.from(result.bytes).equals(second));
    });
});

test('awaitWrittenMidiFile resolves null when nothing changed', async () => {
    await withTempDir(async (dir) => {
        fs.writeFileSync(path.join(dir, 'Song.mid'), Buffer.from(song.songToSmf(minimalSong()).bytes));
        const before = await song.listMidiFiles(dir);

        const result = await song.awaitWrittenMidiFile(dir, before, 400);
        assert.equal(result, null);
    });
});

test('awaitWrittenMidiFile ignores a changed file that does not start with MThd', async () => {
    await withTempDir(async (dir) => {
        const before = await song.listMidiFiles(dir);
        fs.writeFileSync(path.join(dir, 'Other.mid'), Buffer.from('not a midi file at all.....'));

        const result = await song.awaitWrittenMidiFile(dir, before, 400);
        assert.equal(result, null);
    });
});

test('listMidiFiles matches .mid case-insensitively and ignores other files', async () => {
    await withTempDir(async (dir) => {
        fs.writeFileSync(path.join(dir, 'notes.txt'), 'text');
        fs.writeFileSync(path.join(dir, 'UPPER.MID'), Buffer.from([1, 2, 3]));

        const found = await song.listMidiFiles(dir);
        assert.deepEqual([...found.keys()], ['UPPER.MID']);
        assert.equal(found.get('UPPER.MID').size, 3);
        assert.equal(typeof found.get('UPPER.MID').mtimeMs, 'number');
    });
});
