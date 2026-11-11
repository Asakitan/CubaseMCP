import { open } from 'node:fs/promises';

/**
 * Sample rate of a saved Cubase project, read from the .cpr file without the host.
 *
 * The project setup record is stored under the class name "PArrangeSetup"; in Cubase AI 16.0.5 the sample
 * rate follows 72 bytes after the start of that name as a big-endian float32 (44100.0 = 47 2C 44 00), then
 * the record bit depth as a big-endian uint32. Both projects checked (a 67 KiB empty one and a 2.4 MiB
 * arranged one) carry it at that distance. Only a standard rate is accepted, so a moved layout reads as
 * "unknown" instead of as a wrong number.
 *
 * Why it matters: Cubase plays an audio file whose own sample rate differs from the project rate WITHOUT
 * conversion when it is imported through the pool path this server uses. A 48 kHz file in a 44.1 kHz project
 * runs 8.1 % slow and 1.47 semitones flat (found on 2026-11-11 in a real production: every imported layer of
 * a mix had drifted against the MIDI tracks).
 */

export const STANDARD_RATES = [8000, 11025, 16000, 22050, 32000, 44100, 48000, 88200, 96000, 176400, 192000];
const MARKER = Buffer.from('PArrangeSetup\0', 'latin1');
const RATE_OFFSET = 72;
const MAX_BYTES = 256 * 1024 * 1024;

export interface ProjectRate { sampleRate: number; bitDepth: number | null; source: 'PArrangeSetup'; offset: number }

export function findProjectRate(bytes: Buffer): ProjectRate | null {
    for (let at = bytes.indexOf(MARKER); at >= 0; at = bytes.indexOf(MARKER, at + 1)) {
        const offset = at + RATE_OFFSET;
        if (offset + 8 > bytes.length) continue;
        const rate = bytes.readFloatBE(offset);
        if (!STANDARD_RATES.includes(rate)) continue;
        const depth = bytes.readUInt32BE(offset + 4);
        return { sampleRate: rate, bitDepth: [16, 24, 32, 64].includes(depth) ? depth : null, source: 'PArrangeSetup', offset };
    }
    return null;
}

/** null when the file is missing, too large or does not carry a recognisable setup record. Never throws. */
export async function readProjectSampleRate(projectPath: string): Promise<ProjectRate | null> {
    try {
        const file = await open(projectPath, 'r');
        try {
            const size = (await file.stat()).size;
            if (size < MARKER.length + RATE_OFFSET + 8 || size > MAX_BYTES) return null;
            const bytes = Buffer.alloc(size);
            if ((await file.read(bytes, 0, size, 0)).bytesRead !== size) return null;
            return findProjectRate(bytes);
        } finally { await file.close(); }
    } catch { return null; }
}
