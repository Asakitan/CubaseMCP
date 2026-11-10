'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const wav = require('../dist/src/wav.js');

async function withTempDir(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wav-test-'));
    try {
        return await fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

async function inspectBuffer(buffer) {
    return withTempDir(async (dir) => {
        const file = path.join(dir, 'input.wav');
        fs.writeFileSync(file, buffer);
        return wav.inspectWav(file);
    });
}

function encodeSample(value, tag, bits) {
    if (tag === 3) {
        const out = Buffer.alloc(bits / 8);
        if (bits === 32) {
            out.writeFloatLE(value, 0);
        } else {
            out.writeDoubleLE(value, 0);
        }
        return out;
    }
    const scale = { 16: 32767, 24: 8388607, 32: 2147483647 }[bits];
    const int = Math.round(value * scale);
    const out = Buffer.alloc(bits / 8);
    if (bits === 16) {
        out.writeInt16LE(int, 0);
    } else if (bits === 24) {
        out.writeIntLE(int, 0, 3);
    } else {
        out.writeInt32LE(int, 0);
    }
    return out;
}

function formatBody({ tag, channels, sampleRate, bits, extensible, subTag }) {
    const blockAlign = channels * bits / 8;
    const body = Buffer.alloc(extensible ? 40 : 16);
    body.writeUInt16LE(extensible ? 0xfffe : tag, 0);
    body.writeUInt16LE(channels, 2);
    body.writeUInt32LE(sampleRate, 4);
    body.writeUInt32LE(sampleRate * blockAlign, 8);
    body.writeUInt16LE(blockAlign, 12);
    body.writeUInt16LE(bits, 14);
    if (extensible) {
        body.writeUInt16LE(22, 16);          // cbSize
        body.writeUInt16LE(bits, 18);        // validBits
        body.writeUInt32LE(channels === 2 ? 3 : 4, 20); // channelMask
        body.writeUInt16LE(subTag, 24);      // sub-format GUID, first two bytes = real tag
        Buffer.from('00000000' + '0010' + '800000aa00389b71', 'hex').copy(body, 26);
    }
    return body;
}

function chunk(id, data) {
    const header = Buffer.alloc(8);
    header.write(id, 0, 'latin1');
    header.writeUInt32LE(data.length, 4);
    const pad = data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0);
    return Buffer.concat([header, data, pad]);
}

function riff(chunks) {
    const body = Buffer.concat([Buffer.from('WAVE', 'latin1'), ...chunks]);
    const header = Buffer.alloc(8);
    header.write('RIFF', 0, 'latin1');
    header.writeUInt32LE(body.length, 4);
    return Buffer.concat([header, body]);
}

function buildWav({ tag, channels, sampleRate, bits, samples, extensible = false, leadingChunks = [], trailingChunks = [] }) {
    const pcm = Buffer.concat(samples.map((value) => encodeSample(value, tag, bits)));
    return riff([
        ...leadingChunks.map((item) => chunk(item.id, item.data)),
        chunk('fmt ', formatBody({ tag, channels, sampleRate, bits, extensible, subTag: tag })),
        chunk('data', pcm),
        ...trailingChunks.map((item) => chunk(item.id, item.data)),
    ]);
}

test('float32 stereo reports format, length, peak and silence edges', async () => {
    const samples = [];
    for (let frame = 0; frame < 4410; frame++) {
        samples.push(frame < 2205 ? 0.5 : 0, 0);
    }
    const info = await inspectBuffer(buildWav({ tag: 3, channels: 2, sampleRate: 44100, bits: 32, samples }));

    assert.equal(info.supported, true);
    assert.equal(info.sampleRate, 44100);
    assert.equal(info.channels, 2);
    assert.equal(info.bitsPerSample, 32);
    assert.equal(info.float, true);
    assert.equal(info.frames, 4410);
    assert.equal(info.seconds, 0.1);
    assert.equal(info.peak, 0.5);
    assert.equal(info.peakDb, -6);
    assert.ok(typeof info.rmsDb === 'number' && info.rmsDb > -13 && info.rmsDb < -11, `rmsDb was ${info.rmsDb}`);
    assert.equal(info.silent, false);
    assert.equal(info.lastSoundSeconds, 0.05);
    assert.equal(info.scannedFrames, 4410);
});

test('PCM 16-bit mono reports a single half-scale sample', async () => {
    const samples = new Array(100).fill(0);
    samples[42] = 0.5;
    const info = await inspectBuffer(buildWav({ tag: 1, channels: 1, sampleRate: 48000, bits: 16, samples }));

    assert.equal(info.supported, true);
    assert.equal(info.float, false);
    assert.equal(info.bitsPerSample, 16);
    assert.ok(Math.abs(info.peak - 0.5) < 0.001, `peak was ${info.peak}`);
    assert.equal(info.silent, false);
});

test('PCM 24-bit stereo reports the largest written magnitude', async () => {
    const samples = [0.25, -0.75, 0.1, 0, -0.5, 0.3];
    const info = await inspectBuffer(buildWav({ tag: 1, channels: 2, sampleRate: 44100, bits: 24, samples }));

    assert.equal(info.supported, true);
    assert.equal(info.bitsPerSample, 24);
    assert.equal(info.float, false);
    assert.ok(Math.abs(info.peak - 0.75) < 0.001, `peak was ${info.peak}`);
});

test('PCM 32-bit and float64 variants report bit depth, float flag and peak', async () => {
    const samples = [0.1, -0.9, 0.2];

    const pcm32 = await inspectBuffer(buildWav({ tag: 1, channels: 1, sampleRate: 44100, bits: 32, samples }));
    assert.equal(pcm32.supported, true);
    assert.equal(pcm32.bitsPerSample, 32);
    assert.equal(pcm32.float, false);
    assert.ok(Math.abs(pcm32.peak - 0.9) < 0.001, `peak was ${pcm32.peak}`);

    const float64 = await inspectBuffer(buildWav({ tag: 3, channels: 1, sampleRate: 44100, bits: 64, samples }));
    assert.equal(float64.supported, true);
    assert.equal(float64.bitsPerSample, 64);
    assert.equal(float64.float, true);
    assert.ok(Math.abs(float64.peak - 0.9) < 0.001, `peak was ${float64.peak}`);
});

test('all-zero data is reported as silent with null decibel values', async () => {
    const samples = new Array(200).fill(0);
    const info = await inspectBuffer(buildWav({ tag: 3, channels: 2, sampleRate: 44100, bits: 32, samples }));

    assert.equal(info.supported, true);
    assert.equal(info.silent, true);
    assert.equal(info.peak, 0);
    assert.equal(info.peakDb, null);
    assert.equal(info.rmsDb, null);
    assert.equal(info.lastSoundSeconds, null);
});

test('leading and trailing chunks do not change the measurements', async () => {
    const samples = [0.5, -0.5, 0.25, 0, 0, 0.125];
    const plain = buildWav({ tag: 1, channels: 2, sampleRate: 8000, bits: 16, samples });
    const padded = buildWav({
        tag: 1, channels: 2, sampleRate: 8000, bits: 16, samples,
        leadingChunks: [
            { id: 'JUNK', data: Buffer.alloc(28) },
            { id: 'Fake', data: Buffer.from('abc') },
        ],
        trailingChunks: [{ id: 'iXML', data: Buffer.from('<xml/>') }],
    });

    const expected = await inspectBuffer(plain);
    const actual = await inspectBuffer(padded);

    assert.equal(actual.supported, true);
    assert.equal(actual.sampleRate, expected.sampleRate);
    assert.equal(actual.bitsPerSample, expected.bitsPerSample);
    assert.equal(actual.frames, expected.frames);
    assert.equal(actual.frames, 3);
    assert.equal(actual.peak, expected.peak);
    assert.equal(actual.peak, 0.5);
    assert.equal(actual.bytes, padded.length);
});

test('WAVE_FORMAT_EXTENSIBLE is resolved through the sub-format tag', async () => {
    const samples = [0.2, -0.4, 0.6, 0];

    const floatInfo = await inspectBuffer(buildWav({
        tag: 3, channels: 2, sampleRate: 44100, bits: 32, samples, extensible: true,
    }));
    assert.equal(floatInfo.supported, true);
    assert.equal(floatInfo.float, true);
    assert.equal(floatInfo.bitsPerSample, 32);
    assert.ok(Math.abs(floatInfo.peak - 0.6) < 0.001, `peak was ${floatInfo.peak}`);

    const pcmInfo = await inspectBuffer(buildWav({
        tag: 1, channels: 2, sampleRate: 44100, bits: 24, samples, extensible: true,
    }));
    assert.equal(pcmInfo.supported, true);
    assert.equal(pcmInfo.float, false);
    assert.equal(pcmInfo.bitsPerSample, 24);
});

test('a text file is reported as not a RIFF/WAVE file', async () => {
    const info = await inspectBuffer(Buffer.from('hello world, not audio'));
    assert.equal(info.supported, false);
    assert.equal(info.reason, 'not a RIFF/WAVE file');
    assert.equal(info.bytes, 22);
});

test('a WAVE file without a data chunk reports the missing chunk', async () => {
    const fmtOnly = riff([chunk('fmt ', formatBody({ tag: 1, channels: 1, sampleRate: 44100, bits: 16 }))]);
    const info = await inspectBuffer(fmtOnly);
    assert.equal(info.supported, false);
    assert.equal(info.reason, 'format or data chunk missing');
});

test('unsupported sample formats are reported with a reason', async () => {
    const mp3Tag = riff([
        chunk('fmt ', formatBody({ tag: 85, channels: 1, sampleRate: 44100, bits: 16 })),
        chunk('data', Buffer.alloc(16)),
    ]);
    const mp3Info = await inspectBuffer(mp3Tag);
    assert.equal(mp3Info.supported, false);
    assert.ok(mp3Info.reason.startsWith('unsupported sample format'), `reason was ${mp3Info.reason}`);

    const pcm8 = riff([
        chunk('fmt ', formatBody({ tag: 1, channels: 1, sampleRate: 44100, bits: 8 })),
        chunk('data', Buffer.alloc(8, 128)),
    ]);
    const pcm8Info = await inspectBuffer(pcm8);
    assert.equal(pcm8Info.supported, false);
    assert.ok(pcm8Info.reason.startsWith('unsupported sample format'), `reason was ${pcm8Info.reason}`);
});

test('a data chunk larger than the file is clamped to the bytes present', async () => {
    const samples = new Array(100).fill(0.25);
    const wavBuffer = buildWav({ tag: 3, channels: 2, sampleRate: 44100, bits: 32, samples });
    assert.equal(wavBuffer.indexOf('data'), 36);
    wavBuffer.writeUInt32LE(4000, wavBuffer.indexOf('data') + 4);

    const info = await inspectBuffer(wavBuffer);
    assert.equal(info.supported, true);
    assert.equal(info.frames, 400 / 8);
    assert.equal(info.frames, 50);
});

test('inspectWav rejects when the path does not exist', async () => {
    await withTempDir(async (dir) => {
        await assert.rejects(wav.inspectWav(path.join(dir, 'missing.wav')));
    });
});
