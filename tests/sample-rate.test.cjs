'use strict';

// Sample-rate safety of the audio import (session 38): the project rate is read from the .cpr, a WAV at another
// rate is converted before the host sees it. Cubase itself does not convert on this import path.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { findProjectRate, readProjectSampleRate } = require('../dist/src/project-rate.js');
const { designPhases, resampleChannel, resampleWavFile } = require('../dist/src/resample.js');
const { inspectWav } = require('../dist/src/wav.js');

function setupRecord(rate, depth = 16, lead = 300) {
    const bytes = Buffer.alloc(lead + 200);
    const at = lead;
    bytes.write('PArrangeSetup\0', at, 'latin1');
    bytes.writeFloatBE(rate, at + 72);
    bytes.writeUInt32BE(depth, at + 76);
    return bytes;
}

test('the project sample rate is found 72 bytes after the setup record name', () => {
    assert.deepEqual(findProjectRate(setupRecord(44100)), { sampleRate: 44100, bitDepth: 16, source: 'PArrangeSetup', offset: 372 });
    assert.equal(findProjectRate(setupRecord(48000, 24)).sampleRate, 48000);
    assert.equal(findProjectRate(setupRecord(48000, 24)).bitDepth, 24);
});

test('a value that is not a standard rate, or a file without the record, reads as unknown', async () => {
    assert.equal(findProjectRate(setupRecord(44099)), null);
    assert.equal(findProjectRate(Buffer.from('RIFF....no setup here')), null);
    assert.equal(await readProjectSampleRate(path.join(os.tmpdir(), 'does-not-exist-' + process.pid + '.cpr')), null);
});

test('a second record is used when the first one does not hold a rate', () => {
    const bytes = Buffer.concat([setupRecord(1234), setupRecord(96000, 32)]);
    assert.equal(findProjectRate(bytes).sampleRate, 96000);
});

test('every filter phase has unity gain and the bank matches the ratio', () => {
    const down = designPhases(147, 160), up = designPhases(160, 147);
    assert.equal(down.taps.length, 147);
    assert.equal(up.taps.length, 160);
    assert.equal(up.half, 64);
    assert.equal(down.half, 70);                      // 64 zero crossings at the lower (output) rate
    for (const row of [...down.taps, ...up.taps]) {
        let sum = 0;
        for (const value of row) sum += value;
        assert.ok(Math.abs(sum - 1) < 1e-9);
    }
});

function sine(rate, seconds, hz, level) {
    const out = new Float32Array(Math.round(rate * seconds));
    for (let n = 0; n < out.length; n++) out[n] = level * Math.sin(2 * Math.PI * hz * n / rate);
    return out;
}

function rms(signal, from, to) {
    let sum = 0;
    for (let n = from; n < to; n++) sum += signal[n] * signal[n];
    return Math.sqrt(sum / (to - from));
}

test('48 kHz to 44.1 kHz keeps length, pitch and level of a tone and removes what cannot be represented', () => {
    const tone = resampleChannel(sine(48000, 1, 1000, 0.5), 147, 160);
    assert.equal(tone.length, 44100);
    const level = rms(tone, 4410, 39690);
    assert.ok(Math.abs(20 * Math.log10(level / (0.5 / Math.SQRT2))) < 0.01, 'level changed: ' + level);
    let crossings = 0;
    for (let n = 4411; n < 39690; n++) if (tone[n - 1] < 0 && tone[n] >= 0) crossings++;
    assert.ok(Math.abs(crossings - 800) <= 1, 'tone is not at 1 kHz: ' + crossings);   // 0.8 s at 1 kHz
    const high = resampleChannel(sine(48000, 1, 18000, 0.5), 147, 160);                 // still inside the pass band
    assert.ok(Math.abs(20 * Math.log10(rms(high, 4410, 39690) / (0.5 / Math.SQRT2))) < 0.1);
    const above = resampleChannel(sine(48000, 1, 23000, 0.5), 147, 160);                // above the new Nyquist: would alias
    assert.ok(20 * Math.log10(rms(above, 4410, 39690) / (0.5 / Math.SQRT2)) < -90);
});

function wavBuffer(rate, channels, bits, float, frames, fill) {
    const width = bits / 8, data = Buffer.alloc(frames * channels * width);
    for (let frame = 0, at = 0; frame < frames; frame++) {
        for (let channel = 0; channel < channels; channel++, at += width) {
            const value = fill(frame, channel);
            if (float) data.writeFloatLE(value, at);
            else if (bits === 16) data.writeInt16LE(Math.round(value * 32767), at);
            else data.writeIntLE(Math.round(value * 8388607), at, 3);
        }
    }
    const header = Buffer.alloc(44);
    header.write('RIFF', 0, 'latin1'); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8, 'latin1');
    header.write('fmt ', 12, 'latin1'); header.writeUInt32LE(16, 16); header.writeUInt16LE(float ? 3 : 1, 20); header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * channels * width, 28); header.writeUInt16LE(channels * width, 32); header.writeUInt16LE(bits, 34);
    header.write('data', 36, 'latin1'); header.writeUInt32LE(data.length, 40);
    return Buffer.concat([header, data]);
}

test('a stereo 24-bit file is converted to the project rate as a new 32-bit float file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resample-test-'));
    try {
        const source = path.join(dir, 'layer.wav'), target = path.join(dir, 'layer-44100Hz.wav');
        const bytes = wavBuffer(48000, 2, 24, false, 48000, (frame, channel) => (channel ? 0.25 : 0.5) * Math.sin(2 * Math.PI * 440 * frame / 48000));
        fs.writeFileSync(source, bytes);
        const result = await resampleWavFile(source, target, 44100);
        assert.deepEqual({ up: result.up, down: result.down, frames: result.frames, channels: result.channels, sourceBits: result.sourceBits },
            { up: 147, down: 160, frames: 44100, channels: 2, sourceBits: 24 });
        assert.deepEqual(fs.readFileSync(source), bytes);                              // the source is untouched
        const info = await inspectWav(target);
        assert.equal(info.sampleRate, 44100);
        assert.equal(info.float, true);
        assert.equal(info.bitsPerSample, 32);
        assert.equal(info.seconds, 1);
        assert.ok(Math.abs(info.peak - 0.5) < 0.01);
        await assert.rejects(resampleWavFile(source, target, 44100), /EEXIST/);        // never overwrites
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('44.1 kHz to 48 kHz works in the other direction and unsupported data is refused', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resample-test-'));
    try {
        const source = path.join(dir, 'a.wav');
        fs.writeFileSync(source, wavBuffer(44100, 1, 16, false, 22050, frame => 0.3 * Math.sin(2 * Math.PI * 2000 * frame / 44100)));
        const result = await resampleWavFile(source, path.join(dir, 'b.wav'), 48000);
        assert.equal(result.frames, 24000);
        assert.equal(result.tapsPerPhase, 128);
        const junk = path.join(dir, 'junk.wav');
        fs.writeFileSync(junk, Buffer.from('not audio at all, just text'));
        await assert.rejects(resampleWavFile(junk, path.join(dir, 'c.wav'), 48000), /RIFF/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- session 39: findings of an external code review, each pinned by a test

function floatWav(rate, samples, { claim } = {}) {
    const data = Buffer.alloc(samples.length * 4);
    samples.forEach((value, index) => data.writeFloatLE(value, index * 4));
    const header = Buffer.alloc(44);
    header.write('RIFF', 0, 'latin1'); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8, 'latin1');
    header.write('fmt ', 12, 'latin1'); header.writeUInt32LE(16, 16); header.writeUInt16LE(3, 20); header.writeUInt16LE(1, 22);
    header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(32, 34);
    header.write('data', 36, 'latin1'); header.writeUInt32LE(claim ?? data.length, 40);
    return Buffer.concat([header, data]);
}

async function convertIn(dir, name, bytes, target) {
    const source = path.join(dir, name), out = path.join(dir, 'out-' + name);
    fs.writeFileSync(source, bytes);
    return { out, result: await resampleWavFile(source, out, target) };
}

test('tones above the target Nyquist are removed: -80 dB at the band edge, -110 dB from 0.5 % above it (measured -87 / -118)', () => {
    const bank = designPhases(147, 160), rate = 48000, level = 0.5;
    const rms = (x) => { let sum = 0; for (let n = 2000; n < x.length - 2000; n++) sum += x[n] * x[n]; return Math.sqrt(sum / (x.length - 4000)); };
    for (const [hz, limit] of [[22050 * 1.0005, -80], [22050 * 1.005, -110], [22050 * 1.02, -110], [23153, -110]]) {
        const out = resampleChannel(sine(rate, 0.5, hz, level), 147, 160, bank);
        assert.ok(20 * Math.log10(rms(out) / (level / Math.SQRT2)) < limit, hz + ' Hz');
    }
});

test('the converted file is a complete IEEE-float WAVE: 18-byte fmt chunk, fact chunk, data chunk', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubase-rate-'));
    try {
        const { out, result } = await convertIn(dir, 'a.wav', floatWav(8000, Array.from({ length: 800 }, (_, n) => Math.sin(n / 9))), 16000);
        const bytes = fs.readFileSync(out);
        assert.equal(bytes.toString('latin1', 12, 16), 'fmt ');
        assert.equal(bytes.readUInt32LE(16), 18);
        assert.equal(bytes.readUInt16LE(20), 3);
        assert.equal(bytes.toString('latin1', 38, 42), 'fact');
        assert.equal(bytes.readUInt32LE(46), result.frames);
        assert.equal(bytes.toString('latin1', 50, 54), 'data');
        assert.equal(bytes.readUInt32LE(54), result.frames * 4);
        assert.equal(bytes.length, 58 + result.frames * 4);
        assert.equal(inspectWav ? (await inspectWav(out)).sampleRate : 16000, 16000);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a truncated data chunk, a streaming size, a broken frame, a non-finite sample and absurd rates are refused, nothing is written', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubase-rate-'));
    try {
        const good = Array.from({ length: 400 }, (_, n) => Math.sin(n / 7));
        const cases = [
            ['short.wav', floatWav(8000, good, { claim: 4000 }), 16000, /claims 4000 bytes/],
            ['stream.wav', floatWav(8000, good, { claim: 0xffffffff }), 16000, /streaming size/],
            ['frame.wav', Buffer.concat([floatWav(8000, good, { claim: 1601 }), Buffer.from([0])]), 16000, /ends inside a frame/],
            ['nan.wav', floatWav(8000, [0, 0.5, NaN, 0.25]), 16000, /non-finite sample/],
            ['inf.wav', floatWav(8000, [0, Infinity, 0, 0]), 16000, /non-finite sample/],
            ['slow.wav', floatWav(4000, good), 16000, /outside 8000\.\.384000 Hz/],
            ['fast.wav', floatWav(8000, good), 768000, /outside 8000\.\.384000 Hz/],
        ];
        for (const [name, bytes, target, pattern] of cases) {
            await assert.rejects(convertIn(dir, name, bytes, target), pattern, name);
            assert.equal(fs.existsSync(path.join(dir, 'out-' + name)), false, name);
        }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a filter bank beyond the caps is refused before it is built', () => {
    assert.throws(() => designPhases(4000, 1000000001), /not supported/);
    assert.throws(() => designPhases(4096, 4095 * 40), /not supported/);
    assert.equal(designPhases(147, 320).half, 140);                 // 96 -> 44.1 kHz stays inside them
});
