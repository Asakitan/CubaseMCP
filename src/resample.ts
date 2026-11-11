import { open, writeFile } from 'node:fs/promises';

/**
 * Sample-rate conversion of a PCM / IEEE-float RIFF/WAVE file, used when an audio import does not match the
 * project sample rate (see project-rate.ts for why that must not be imported as it is).
 *
 * Polyphase windowed-sinc interpolation for the exact rational ratio L/M: 64 zero crossings of the sinc on
 * each side at the lower of the two rates (140 taps per phase for 48 -> 44.1 kHz), Kaiser window (beta 12).
 * The cut-off sits half a transition band under the lower Nyquist frequency, so the stop band starts AT that
 * frequency (for 48 -> 44.1 kHz: flat to 19.6 kHz, -6 dB at 20.8 kHz, stop band from 22.05 kHz). The stop-band
 * attenuation is not taken from the design formula but measured by the test suite on every phase of the
 * 48 -> 44.1 kHz and 44.1 -> 48 kHz banks (see tests/sample-rate.test.cjs, session 39 review). Every phase is
 * normalised to unity gain at DC. The result is written as 32-bit float so that the small overshoot of a
 * band-limited signal cannot clip.
 *
 * Limits and edge policy (session 39, after an external code review):
 *  - both rates must lie in 8 kHz .. 384 kHz, the filter bank is capped (taps per phase and total coefficients)
 *    and so is the size of the result, all checked BEFORE anything is allocated;
 *  - a data chunk that is longer than the file, ends inside a frame or uses the 0xFFFFFFFF streaming size is
 *    refused instead of being cut silently; non-finite float samples are refused;
 *  - the signal is taken as zero outside the file: within half a filter length (about 1.5 ms) of each end a
 *    signal that does not start or end at zero is faded by the filter instead of holding its level.
 */

export interface ResampleResult {
    sourceRate: number; targetRate: number; channels: number; sourceFrames: number; frames: number;
    sourceBits: number; sourceFloat: boolean; up: number; down: number; tapsPerPhase: number; peak: number;
}

const MAX_SAMPLES = 160_000_000;                 // frames x channels held in memory as float32 (~640 MiB)
const MIN_RATE = 8000, MAX_RATE = 384_000;
const MAX_TAPS_PER_PHASE = 4096, MAX_COEFFICIENTS = 4_000_000;

function gcd(a: number, b: number): number { while (b) [a, b] = [b, a % b]; return a; }

function bessel0(x: number): number {
    let sum = 1, term = 1;
    for (let k = 1; k < 64; k++) {
        term *= (x / (2 * k)) * (x / (2 * k));
        sum += term;
        if (term < 1e-14 * sum) break;
    }
    return sum;
}

/** Filter bank: one row of taps per output phase. */
export function designPhases(up: number, down: number, zeros = 64, beta = 12): { taps: Float64Array[]; half: number } {
    const scale = Math.min(1, up / down);                       // lower Nyquist relative to the input Nyquist
    const half = Math.ceil(zeros / scale);
    if (!Number.isInteger(up) || !Number.isInteger(down) || up < 1 || down < 1 || 2 * half > MAX_TAPS_PER_PHASE || up * 2 * half > MAX_COEFFICIENTS) {
        throw new Error(`the ratio ${up}/${down} needs a filter bank of ${up} x ${2 * half} coefficients; not supported`);
    }
    // Kaiser design rule: transition width = (A - 7.95) / (14.36 N) cycles per sample for A dB of attenuation.
    const transition = (110 - 7.95) / (14.36 * 2 * half);
    const cutoff = 0.5 * scale - transition / 2;                // cycles per input sample
    const norm = bessel0(beta);
    const taps: Float64Array[] = [];
    for (let phase = 0; phase < up; phase++) {
        const fraction = phase / up, row = new Float64Array(2 * half);
        let sum = 0;
        for (let k = 0; k < 2 * half; k++) {
            const x = (k - half + 1) - fraction;                // distance from the output instant, input samples
            const t = x / half;
            const window = Math.abs(t) >= 1 ? 0 : bessel0(beta * Math.sqrt(1 - t * t)) / norm;
            const arg = 2 * Math.PI * cutoff * x;
            const value = (Math.abs(arg) < 1e-12 ? 1 : Math.sin(arg) / arg) * 2 * cutoff * window;
            row[k] = value;
            sum += value;
        }
        for (let k = 0; k < row.length; k++) row[k] /= sum;
        taps.push(row);
    }
    return { taps, half };
}

/** One channel: output sample n sits at input position n * down / up. */
export function resampleChannel(input: Float32Array, up: number, down: number, bank = designPhases(up, down)): Float32Array {
    const frames = Math.floor((input.length * up + down - 1) / down);
    const output = new Float32Array(frames), { taps, half } = bank, last = input.length - 1;
    for (let n = 0; n < frames; n++) {
        const position = n * down, base = Math.floor(position / up), row = taps[position - base * up];
        let acc = 0;
        const first = base - half + 1;
        for (let k = 0; k < row.length; k++) {
            const at = first + k;
            if (at >= 0 && at <= last) acc += input[at] * row[k];
        }
        output[n] = acc;
    }
    return output;
}

interface Wave { tag: number; channels: number; sampleRate: number; bits: number; blockAlign: number; dataOffset: number; dataBytes: number }

async function readHeader(path: string): Promise<{ wave: Wave; bytes: number }> {
    const file = await open(path, 'r');
    try {
        const bytes = (await file.stat()).size, head = Buffer.alloc(12);
        if (bytes < 12 || (await file.read(head, 0, 12, 0)).bytesRead !== 12 || head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'WAVE') {
            throw new Error('not a RIFF/WAVE file');
        }
        let format: Omit<Wave, 'dataOffset' | 'dataBytes'> | null = null, data: { offset: number; size: number } | null = null;
        const chunk = Buffer.alloc(8);
        for (let offset = 12; offset + 8 <= bytes && !(format && data);) {
            if ((await file.read(chunk, 0, 8, offset)).bytesRead !== 8) break;
            const id = chunk.toString('latin1', 0, 4), size = chunk.readUInt32LE(4);
            if (id === 'fmt ' && size >= 16) {
                const body = Buffer.alloc(Math.min(size, 40));
                await file.read(body, 0, body.length, offset + 8);
                let tag = body.readUInt16LE(0);
                if (tag === 0xfffe && body.length >= 26) tag = body.readUInt16LE(24);
                format = { tag, channels: body.readUInt16LE(2), sampleRate: body.readUInt32LE(4), blockAlign: body.readUInt16LE(12), bits: body.readUInt16LE(14) };
            } else if (id === 'data') {
                if (size === 0xffffffff) throw new Error('the data chunk uses the streaming size 0xFFFFFFFF; not supported');
                if (size > bytes - offset - 8) throw new Error(`the data chunk claims ${size} bytes, the file holds ${bytes - offset - 8}`);
                data = { offset: offset + 8, size };
            }
            offset += 8 + size + (size % 2);
        }
        if (!format || !data) throw new Error('format or data chunk missing');
        const width = format.bits / 8, float = format.tag === 3;
        if ((format.tag !== 1 && format.tag !== 3) || !format.channels || !format.sampleRate || format.blockAlign !== width * format.channels ||
            !(float ? width === 4 || width === 8 : width === 2 || width === 3 || width === 4)) {
            throw new Error(`unsupported sample format (tag ${format.tag}, ${format.bits} bit)`);
        }
        if (data.size % format.blockAlign) throw new Error('the data chunk ends inside a frame');
        return { wave: { ...format, dataOffset: data.offset, dataBytes: data.size }, bytes };
    } finally { await file.close(); }
}

/** Convert `sourcePath` to `targetRate` and write `targetPath` (new file, 32-bit float WAVE). */
export async function resampleWavFile(sourcePath: string, targetPath: string, targetRate: number): Promise<ResampleResult> {
    const { wave } = await readHeader(sourcePath);
    const frames = Math.floor(wave.dataBytes / wave.blockAlign);
    if (!frames) throw new Error('the source holds no audio frames');
    if (frames * wave.channels > MAX_SAMPLES) throw new Error(`the source is too long to convert in memory (${frames} frames x ${wave.channels} channels)`);
    for (const rate of [wave.sampleRate, targetRate]) {
        if (!Number.isInteger(rate) || rate < MIN_RATE || rate > MAX_RATE) throw new Error(`sample rate ${rate} Hz is outside ${MIN_RATE}..${MAX_RATE} Hz`);
    }
    const divisor = gcd(targetRate, wave.sampleRate), up = targetRate / divisor, down = wave.sampleRate / divisor;
    if (up > 4096) throw new Error(`the ratio ${wave.sampleRate} -> ${targetRate} Hz needs ${up} filter phases; not supported`);
    // size of the result, before anything is allocated: frames, float32 samples and the 32-bit RIFF size field
    const expectedFrames = Math.floor((frames * up + down - 1) / down);
    if (expectedFrames * wave.channels > MAX_SAMPLES || 58 + expectedFrames * wave.channels * 4 > 0xfffffff0) {
        throw new Error(`the converted file would hold ${expectedFrames} frames x ${wave.channels} channels; too large`);
    }

    const width = wave.bits / 8, float = wave.tag === 3;
    const channels: Float32Array[] = Array.from({ length: wave.channels }, () => new Float32Array(frames));
    const file = await open(sourcePath, 'r');
    try {
        const blockFrames = Math.max(1, Math.floor((1 << 22) / wave.blockAlign)), buffer = Buffer.alloc(blockFrames * wave.blockAlign);
        for (let frame = 0; frame < frames; frame += blockFrames) {
            const wanted = Math.min(blockFrames, frames - frame) * wave.blockAlign;
            const got = (await file.read(buffer, 0, wanted, wave.dataOffset + frame * wave.blockAlign)).bytesRead;
            if (got !== wanted) throw new Error('the data chunk is shorter than its header says');
            for (let at = 0, index = frame; at < got; index++) {
                for (let channel = 0; channel < wave.channels; channel++, at += width) {
                    const value = float ? (width === 4 ? buffer.readFloatLE(at) : buffer.readDoubleLE(at))
                        : width === 2 ? buffer.readInt16LE(at) / 32768 : width === 3 ? buffer.readIntLE(at, 3) / 8388608 : buffer.readInt32LE(at) / 2147483648;
                    if (float && !(Math.abs(value) <= 3.4e38)) throw new Error(`the source holds a non-finite sample (frame ${index})`);
                    channels[channel][index] = value;
                }
            }
        }
    } finally { await file.close(); }

    const bank = designPhases(up, down);
    const converted = channels.map(channel => resampleChannel(channel, up, down, bank));
    const outFrames = converted[0].length, dataBytes = outFrames * wave.channels * 4;
    // IEEE-float WAVE as the specification asks for it: 18-byte fmt chunk (cbSize 0) and a fact chunk with the frame count
    const HEADER = 58;
    const out = Buffer.alloc(HEADER + dataBytes);
    out.write('RIFF', 0, 'latin1'); out.writeUInt32LE(HEADER - 8 + dataBytes, 4); out.write('WAVE', 8, 'latin1');
    out.write('fmt ', 12, 'latin1'); out.writeUInt32LE(18, 16); out.writeUInt16LE(3, 20); out.writeUInt16LE(wave.channels, 22);
    out.writeUInt32LE(targetRate, 24); out.writeUInt32LE(targetRate * wave.channels * 4, 28); out.writeUInt16LE(wave.channels * 4, 32); out.writeUInt16LE(32, 34);
    out.writeUInt16LE(0, 36);
    out.write('fact', 38, 'latin1'); out.writeUInt32LE(4, 42); out.writeUInt32LE(outFrames, 46);
    out.write('data', 50, 'latin1'); out.writeUInt32LE(dataBytes, 54);
    let peak = 0;
    for (let frame = 0, at = HEADER; frame < outFrames; frame++) {
        for (let channel = 0; channel < wave.channels; channel++, at += 4) {
            const value = converted[channel][frame];
            if (Math.abs(value) > peak) peak = Math.abs(value);
            out.writeFloatLE(value, at);
        }
    }
    await writeFile(targetPath, out, { flag: 'wx' });
    return { sourceRate: wave.sampleRate, targetRate, channels: wave.channels, sourceFrames: frames, frames: outFrames,
        sourceBits: wave.bits, sourceFloat: float, up, down, tapsPerPhase: 2 * bank.half, peak: Math.round(peak * 1e6) / 1e6 };
}
