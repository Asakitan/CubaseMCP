import { open } from 'node:fs/promises';

/**
 * Read-only inspection of a RIFF/WAVE file: format, length and how loud its content is.
 * Used to report what an audio export actually produced. Nothing here decodes compressed
 * audio; a file that is not PCM or IEEE-float WAVE is reported with `supported: false`.
 */

export interface WavInfo {
    supported: boolean; reason?: string; bytes: number;
    sampleRate?: number; channels?: number; bitsPerSample?: number; float?: boolean;
    frames?: number; seconds?: number;
    peak?: number; peakDb?: number | null; rmsDb?: number | null; silent?: boolean;
    lastSoundSeconds?: number | null; scannedFrames?: number;
}

const BLOCK_BYTES = 1 << 20;
const MAX_SCAN_BYTES = 512 * 1024 * 1024;
const SILENCE = 1e-5;                       // -100 dBFS

function decibel(value: number): number | null {
    return value > 0 ? Math.round(200 * Math.log10(value)) / 10 : null;
}

export async function inspectWav(path: string): Promise<WavInfo> {
    const file = await open(path, 'r');
    try {
        const bytes = (await file.stat()).size;
        const head = Buffer.alloc(12);
        if (bytes < 12 || (await file.read(head, 0, 12, 0)).bytesRead !== 12 || head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'WAVE') {
            return { supported: false, reason: 'not a RIFF/WAVE file', bytes };
        }
        let format: { tag: number; channels: number; sampleRate: number; blockAlign: number; bits: number } | null = null;
        let data: { offset: number; size: number } | null = null;
        const chunk = Buffer.alloc(8);
        for (let offset = 12; offset + 8 <= bytes && !(format && data);) {
            if ((await file.read(chunk, 0, 8, offset)).bytesRead !== 8) break;
            const id = chunk.toString('latin1', 0, 4), size = chunk.readUInt32LE(4);
            if (id === 'fmt ' && size >= 16) {
                const body = Buffer.alloc(Math.min(size, 40));
                await file.read(body, 0, body.length, offset + 8);
                let tag = body.readUInt16LE(0);
                // WAVE_FORMAT_EXTENSIBLE carries the real format in the first two bytes of its sub-format GUID.
                if (tag === 0xfffe && body.length >= 26) tag = body.readUInt16LE(24);
                format = { tag, channels: body.readUInt16LE(2), sampleRate: body.readUInt32LE(4), blockAlign: body.readUInt16LE(12), bits: body.readUInt16LE(14) };
            } else if (id === 'data') {
                data = { offset: offset + 8, size: Math.min(size, bytes - offset - 8) };
            }
            offset += 8 + size + (size % 2);
        }
        if (!format || !data) return { supported: false, reason: 'format or data chunk missing', bytes };
        const float = format.tag === 3, width = format.bits / 8;
        if ((format.tag !== 1 && format.tag !== 3) || !format.channels || !format.sampleRate || format.blockAlign !== width * format.channels ||
            !(float ? width === 4 || width === 8 : width === 2 || width === 3 || width === 4)) {
            return { supported: false, reason: `unsupported sample format (tag ${format.tag}, ${format.bits} bit)`, bytes };
        }
        const frames = Math.floor(data.size / format.blockAlign);
        const read = float ? (width === 4 ? (buffer: Buffer, at: number) => buffer.readFloatLE(at) : (buffer: Buffer, at: number) => buffer.readDoubleLE(at))
            : width === 2 ? (buffer: Buffer, at: number) => buffer.readInt16LE(at) / 32768
                : width === 3 ? (buffer: Buffer, at: number) => buffer.readIntLE(at, 3) / 8388608
                    : (buffer: Buffer, at: number) => buffer.readInt32LE(at) / 2147483648;
        // Very large files are sampled block by block so that the scan stays bounded.
        const blockFrames = Math.max(1, Math.floor(BLOCK_BYTES / format.blockAlign));
        const stride = Math.max(1, Math.ceil(data.size / MAX_SCAN_BYTES));
        const buffer = Buffer.alloc(blockFrames * format.blockAlign);
        let peak = 0, squares = 0, scanned = 0, lastSound = -1;
        for (let block = 0, frame = 0; frame < frames; block++, frame += blockFrames) {
            if (block % stride) continue;
            const wanted = Math.min(blockFrames, frames - frame) * format.blockAlign;
            const got = (await file.read(buffer, 0, wanted, data.offset + frame * format.blockAlign)).bytesRead;
            for (let at = 0; at + width <= got; at += width) {
                const value = read(buffer, at), magnitude = Math.abs(value);
                if (magnitude > peak) peak = magnitude;
                squares += value * value;
                if (magnitude > SILENCE) lastSound = frame + Math.floor(at / format.blockAlign);
            }
            scanned += Math.floor(got / format.blockAlign);
        }
        const rms = scanned ? Math.sqrt(squares / (scanned * format.channels)) : 0;
        return { supported: true, bytes, sampleRate: format.sampleRate, channels: format.channels, bitsPerSample: format.bits, float,
            frames, seconds: Math.round(1000 * frames / format.sampleRate) / 1000,
            peak: Math.round(peak * 1e6) / 1e6, peakDb: decibel(peak), rmsDb: decibel(rms), silent: peak <= SILENCE,
            lastSoundSeconds: lastSound < 0 ? null : Math.round(1000 * lastSound / format.sampleRate) / 1000, scannedFrames: scanned };
    } finally {
        await file.close();
    }
}
