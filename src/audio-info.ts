import { open } from 'node:fs/promises';
import { inspectWav, type WavInfo } from './wav.js';

export interface AudioInfo extends WavInfo { format?: 'wav' | 'aiff' | 'flac' }

/** Read format metadata from the emitted file. Only WAVE has amplitude analysis. */
export async function inspectAudio(path: string): Promise<AudioInfo> {
    const file = await open(path, 'r');
    let wave = false;
    try {
        const bytes = (await file.stat()).size;
        const read = async (offset: number, length: number) => {
            if (offset < 0 || length < 0 || offset + length > bytes) throw new Error('Audio chunk exceeds the file.');
            const data = Buffer.alloc(length);
            if ((await file.read(data, 0, length, offset)).bytesRead !== length) throw new Error('Incomplete audio metadata.');
            return data;
        };
        const head = await read(0, 12);
        if (head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WAVE') {
            wave = true;
        } else if (head.toString('ascii', 0, 4) === 'fLaC') {
            const block = await read(4, 4);
            if ((block[0] & 127) !== 0 || block.readUIntBE(1, 3) !== 34) throw new Error('FLAC STREAMINFO is missing.');
            const info = await read(8, 34), packed = info.readBigUInt64BE(10);
            const sampleRate = Number(packed >> 44n), channels = Number((packed >> 41n) & 7n) + 1;
            const bitsPerSample = Number((packed >> 36n) & 31n) + 1, frames = Number(packed & 0xfffffffffn);
            if (!sampleRate || !frames || bytes <= 42) throw new Error('FLAC has no complete sample metadata.');
            return { supported: true, format: 'flac', bytes, sampleRate, channels, bitsPerSample, float: false,
                frames, seconds: frames / sampleRate };
        } else if (head.toString('ascii', 0, 4) === 'FORM' && ['AIFF', 'AIFC'].includes(head.toString('ascii', 8, 12))) {
            const compressed = head.toString('ascii', 8, 12) === 'AIFC';
            let info: Omit<AudioInfo, 'bytes' | 'supported'> | undefined, sampleBytes = 0;
            for (let offset = 12, chunks = 0; offset + 8 <= bytes && chunks < 10000; chunks++) {
                const header = await read(offset, 8), size = header.readUInt32BE(4), id = header.toString('ascii', 0, 4);
                if (offset + 8 + size > bytes) throw new Error('AIFF chunk exceeds the file.');
                if (id === 'COMM') {
                    if (size < (compressed ? 22 : 18)) throw new Error('AIFF COMM chunk is truncated.');
                    const body = await read(offset + 8, compressed ? 22 : 18);
                    const exponent = body.readUInt16BE(8), mantissa = body.readBigUInt64BE(10);
                    const sampleRate = Number(mantissa) * Math.pow(2, (exponent & 0x7fff) - 16383 - 63);
                    const codec = compressed ? body.toString('ascii', 18, 22) : 'NONE';
                    if (exponent & 0x8000 || !Number.isFinite(sampleRate) || sampleRate < 1 ||
                        !['NONE', 'sowt', 'fl32', 'FL32', 'fl64', 'FL64'].includes(codec)) throw new Error('Unsupported AIFF sample encoding.');
                    const channels = body.readUInt16BE(0), frames = body.readUInt32BE(2), bitsPerSample = body.readUInt16BE(6);
                    if (!channels || !frames || ![16, 24, 32, 64].includes(bitsPerSample)) throw new Error('Invalid AIFF sample dimensions.');
                    info = { format: 'aiff', sampleRate, channels, frames, bitsPerSample, float: /^fl/i.test(codec), seconds: frames / sampleRate };
                } else if (id === 'SSND') {
                    if (size < 8) throw new Error('AIFF SSND chunk is truncated.');
                    const data = await read(offset + 8, 8);
                    sampleBytes = size - 8 - data.readUInt32BE(0);
                }
                offset += 8 + size + size % 2;
            }
            if (!info || sampleBytes < info.frames! * info.channels! * info.bitsPerSample! / 8) throw new Error('AIFF sample payload is incomplete.');
            return { supported: true, bytes, ...info };
        } else return { supported: false, bytes, reason: 'Unsupported audio container.' };
    } finally { await file.close(); }
    if (wave) return { ...await inspectWav(path), format: 'wav' };
    throw new Error('Audio format was not established.');
}