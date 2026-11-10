/**
 * Dependency-free Standard MIDI File (SMF) parser and builder.
 *
 * The parser is bounded and strict about structure (header, chunk lengths,
 * variable-length quantities). Recoverable oddities are reported as warnings
 * rather than errors. The builder always writes format 1 with a conductor
 * track (track 0) followed by one MTrk per input track.
 */

export class SmfError extends Error {
    constructor(public readonly code: string, message: string) {
        super(message);
        this.name = 'SmfError';
    }
}

export interface SmfNote { track: number; channel: number; pitch: number; velocity: number; releaseVelocity: number; startTicks: number; durationTicks: number }
export interface SmfControlChange { track: number; channel: number; controller: number; value: number; ticks: number }
export interface SmfPitchBend { track: number; channel: number; value: number; ticks: number }        // value is signed, -8192..8191
export interface SmfProgramChange { track: number; channel: number; program: number; ticks: number }
export interface SmfChannelPressure { track: number; channel: number; pressure: number; ticks: number }
export interface SmfPolyPressure { track: number; channel: number; pitch: number; pressure: number; ticks: number }
export interface SmfTempo { ticks: number; microsecondsPerQuarter: number; bpm: number }
export interface SmfTimeSignature { ticks: number; numerator: number; denominator: number }           // denominator is the real value (4, 8, ...), not the power
export interface SmfKeySignature { ticks: number; sharpsFlats: number; minor: boolean }               // sharpsFlats is -7..7
export interface SmfMarker { ticks: number; text: string }
export interface SmfTrackInfo { index: number; name: string | null; eventCount: number; noteCount: number; endTicks: number }
export interface SmfModel {
    format: 0 | 1; ppq: number; durationTicks: number;
    tracks: SmfTrackInfo[]; notes: SmfNote[]; controlChanges: SmfControlChange[]; pitchBends: SmfPitchBend[];
    programChanges: SmfProgramChange[]; channelPressures: SmfChannelPressure[]; polyPressures: SmfPolyPressure[];
    tempos: SmfTempo[]; timeSignatures: SmfTimeSignature[]; keySignatures: SmfKeySignature[]; markers: SmfMarker[];
    warnings: string[];
}

export interface SmfBuildTrack {
    name?: string; channel?: number;                       // default channel for events that omit it (default 0)
    notes?: { pitch: number; velocity?: number; releaseVelocity?: number; startTicks: number; durationTicks: number; channel?: number }[];
    controlChanges?: { controller: number; value: number; ticks: number; channel?: number }[];
    pitchBends?: { value: number; ticks: number; channel?: number }[];
    programChanges?: { program: number; ticks: number; channel?: number }[];
}
export interface SmfBuildInput {
    ppq?: number;                                          // default 480, integer 24..960
    tempos?: { ticks: number; bpm: number }[];
    timeSignatures?: { ticks: number; numerator: number; denominator: number }[];
    markers?: { ticks: number; text: string }[];
    tracks: SmfBuildTrack[];                               // 1..64 tracks
}

const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_EVENTS_PARSE = 500000;
const MAX_EVENTS_BUILD = 200000;
const MAX_TRACKS_BUILD = 64;
const MAX_TICKS = 0x0fffffff;
const MAX_TEXT_BYTES = 255;
const MAX_TEMPO_MICROSECONDS = 0xffffff;

const DENOMINATOR_POWER = new Map<number, number>([[1, 0], [2, 1], [4, 2], [8, 3], [16, 4], [32, 5], [64, 6]]);

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

interface ParseContext {
    totalEvents: number;
    warnings: string[];
    warnedSystem: boolean;
}

interface TrackParts {
    info: SmfTrackInfo;
    notes: SmfNote[];
    controlChanges: SmfControlChange[];
    pitchBends: SmfPitchBend[];
    programChanges: SmfProgramChange[];
    channelPressures: SmfChannelPressure[];
    polyPressures: SmfPolyPressure[];
    tempos: SmfTempo[];
    timeSignatures: SmfTimeSignature[];
    keySignatures: SmfKeySignature[];
    markers: SmfMarker[];
}

function tagAt(bytes: Uint8Array, offset: number, tag: string): boolean {
    for (let i = 0; i < 4; i++) {
        if (bytes[offset + i] !== tag.charCodeAt(i)) {
            return false;
        }
    }
    return true;
}

function readU16(bytes: Uint8Array, offset: number): number {
    return (bytes[offset] << 8) | bytes[offset + 1];
}

function readU32(bytes: Uint8Array, offset: number): number {
    return bytes[offset] * 0x1000000 + ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]);
}

function decodeText(bytes: Uint8Array, start: number, end: number): string {
    return new TextDecoder('utf-8').decode(bytes.subarray(start, end));
}

function parseTrack(bytes: Uint8Array, start: number, end: number, index: number, ctx: ParseContext): TrackParts {
    let pos = start;
    let tick = 0;
    let lastTick = 0;
    let running = 0;
    let ended = false;
    let name: string | null = null;
    let eventCount = 0;

    const notes: SmfNote[] = [];
    const controlChanges: SmfControlChange[] = [];
    const pitchBends: SmfPitchBend[] = [];
    const programChanges: SmfProgramChange[] = [];
    const channelPressures: SmfChannelPressure[] = [];
    const polyPressures: SmfPolyPressure[] = [];
    const tempos: SmfTempo[] = [];
    const timeSignatures: SmfTimeSignature[] = [];
    const keySignatures: SmfKeySignature[] = [];
    const markers: SmfMarker[] = [];
    const openNotes = new Map<number, SmfNote[]>();

    const warn = (message: string): void => {
        ctx.warnings.push(`Track ${index}: ${message}`);
    };
    const truncated = (): SmfError => new SmfError('SMF_TRUNCATED', `Track ${index}: read past the end of the chunk`);

    const byteAt = (): number => {
        if (pos >= end) {
            throw truncated();
        }
        const value = bytes[pos];
        pos += 1;
        return value;
    };
    const dataByte = (): number => {
        const value = byteAt();
        if ((value & 0x80) !== 0) {
            throw new SmfError('SMF_BAD_EVENT', `Track ${index}: status byte where a data byte was expected`);
        }
        return value;
    };
    const readVlq = (): number => {
        let value = 0;
        for (let i = 0; i < 4; i++) {
            const b = byteAt();
            value = value * 128 + (b & 0x7f);
            if ((b & 0x80) === 0) {
                return value;
            }
        }
        throw new SmfError('SMF_BAD_EVENT', `Track ${index}: variable-length quantity longer than 4 bytes`);
    };
    const skip = (count: number): number => {
        if (count > end - pos) {
            throw truncated();
        }
        const at = pos;
        pos += count;
        return at;
    };
    const closeNote = (channel: number, pitch: number, release: number): void => {
        const queue = openNotes.get(channel * 128 + pitch);
        const note = queue?.shift();
        if (note === undefined) {
            warn(`Note Off without an open Note On at tick ${tick} (channel ${channel}, pitch ${pitch})`);
            return;
        }
        note.durationTicks = tick - note.startTicks;
        note.releaseVelocity = release;
    };

    while (!ended && pos < end) {
        tick += readVlq();
        lastTick = tick;
        eventCount += 1;
        ctx.totalEvents += 1;
        if (ctx.totalEvents > MAX_EVENTS_PARSE) {
            throw new SmfError('SMF_TOO_MANY_EVENTS', `File contains more than ${MAX_EVENTS_PARSE} events`);
        }

        let status = byteAt();
        if ((status & 0x80) === 0) {
            if (running === 0) {
                throw new SmfError('SMF_BAD_EVENT', `Track ${index}: data byte without running status`);
            }
            pos -= 1;
            status = running;
        }

        if (status === 0xff) {
            running = 0;
            const type = byteAt();
            const length = readVlq();
            const at = skip(length);
            if (type === 0x03) {
                if (name === null) {
                    name = decodeText(bytes, at, at + length);
                }
            } else if (type === 0x06) {
                markers.push({ ticks: tick, text: decodeText(bytes, at, at + length) });
            } else if (type === 0x51) {
                if (length !== 3) {
                    warn(`tempo meta event has length ${length} (expected 3); skipped`);
                } else {
                    const us = (bytes[at] << 16) | (bytes[at + 1] << 8) | bytes[at + 2];
                    if (us === 0) {
                        warn('tempo meta event is zero microseconds per quarter; skipped');
                    } else {
                        tempos.push({ ticks: tick, microsecondsPerQuarter: us, bpm: 60000000 / us });
                    }
                }
            } else if (type === 0x58) {
                if (length !== 4) {
                    warn(`time signature meta event has length ${length} (expected 4); skipped`);
                } else {
                    timeSignatures.push({ ticks: tick, numerator: bytes[at], denominator: 2 ** bytes[at + 1] });
                }
            } else if (type === 0x59) {
                if (length !== 2) {
                    warn(`key signature meta event has length ${length} (expected 2); skipped`);
                } else {
                    keySignatures.push({ ticks: tick, sharpsFlats: (bytes[at] << 24) >> 24, minor: bytes[at + 1] === 1 });
                }
            } else if (type === 0x2f) {
                ended = true;
            }
        } else if (status === 0xf0 || status === 0xf7) {
            running = 0;
            skip(readVlq());
        } else if (status >= 0xf1) {
            // System common messages (F1..F6) cancel running status and carry 0-2 data bytes.
            // Realtime messages (F8..FE) carry no data and leave running status alone.
            if (status <= 0xf6) {
                running = 0;
                const dataCount = status === 0xf2 ? 2 : status === 0xf1 || status === 0xf3 ? 1 : 0;
                for (let i = 0; i < dataCount; i++) {
                    dataByte();
                }
                if (!ctx.warnedSystem) {
                    ctx.warnedSystem = true;
                    warn(`system common message 0x${status.toString(16)} ignored`);
                }
            }
        } else {
            running = status;
            const kind = status & 0xf0;
            const channel = status & 0x0f;
            const d1 = dataByte();
            if (kind === 0xc0) {
                programChanges.push({ track: index, channel, program: d1, ticks: tick });
            } else if (kind === 0xd0) {
                channelPressures.push({ track: index, channel, pressure: d1, ticks: tick });
            } else {
                const d2 = dataByte();
                if (kind === 0x80) {
                    closeNote(channel, d1, d2);
                } else if (kind === 0x90) {
                    if (d2 === 0) {
                        closeNote(channel, d1, 64);
                    } else {
                        const note: SmfNote = {
                            track: index, channel, pitch: d1, velocity: d2,
                            releaseVelocity: 64, startTicks: tick, durationTicks: 0,
                        };
                        notes.push(note);
                        const key = channel * 128 + d1;
                        const queue = openNotes.get(key);
                        if (queue === undefined) {
                            openNotes.set(key, [note]);
                        } else {
                            queue.push(note);
                        }
                    }
                } else if (kind === 0xa0) {
                    polyPressures.push({ track: index, channel, pitch: d1, pressure: d2, ticks: tick });
                } else if (kind === 0xb0) {
                    controlChanges.push({ track: index, channel, controller: d1, value: d2, ticks: tick });
                } else if (kind === 0xe0) {
                    pitchBends.push({ track: index, channel, value: ((d2 << 7) | d1) - 8192, ticks: tick });
                }
            }
        }
    }

    let unclosed = 0;
    for (const queue of openNotes.values()) {
        for (const note of queue) {
            note.durationTicks = lastTick - note.startTicks;
            note.releaseVelocity = 64;
            unclosed += 1;
        }
    }
    if (unclosed > 0) {
        warn(`${unclosed} note(s) without a Note Off were closed at tick ${lastTick}`);
    }

    return {
        info: { index, name, eventCount, noteCount: notes.length, endTicks: lastTick },
        notes, controlChanges, pitchBends, programChanges, channelPressures, polyPressures,
        tempos, timeSignatures, keySignatures, markers,
    };
}

function sortByTicks<T extends { ticks: number }>(items: T[]): T[] {
    items.sort((a, b) => a.ticks - b.ticks);
    return items;
}

function sortByTicksAndTrack<T extends { ticks: number; track: number }>(items: T[]): T[] {
    items.sort((a, b) => a.ticks - b.ticks || a.track - b.track);
    return items;
}

export function parseSmf(bytes: Uint8Array): SmfModel {
    if (bytes.length > MAX_FILE_BYTES) {
        throw new SmfError('SMF_TOO_LARGE', `MIDI file is ${bytes.length} bytes; the limit is ${MAX_FILE_BYTES}`);
    }
    if (bytes.length < 8) {
        throw new SmfError('SMF_TRUNCATED', 'MIDI file is shorter than a chunk header');
    }
    if (!tagAt(bytes, 0, 'MThd')) {
        throw new SmfError('SMF_HEADER', 'Missing MThd header chunk');
    }
    const headerLength = readU32(bytes, 4);
    if (headerLength < 6) {
        throw new SmfError('SMF_HEADER', `Header chunk length ${headerLength} is less than 6`);
    }
    if (8 + headerLength > bytes.length) {
        throw new SmfError('SMF_TRUNCATED', 'Header chunk extends past the end of the file');
    }
    const format = readU16(bytes, 8);
    const trackCount = readU16(bytes, 10);
    const division = readU16(bytes, 12);
    if (format !== 0 && format !== 1) {
        throw new SmfError('SMF_HEADER', `Unsupported MIDI format ${format}`);
    }
    if (trackCount < 1 || trackCount > 256) {
        throw new SmfError('SMF_HEADER', `Track count ${trackCount} is outside 1..256`);
    }
    if (format === 0 && trackCount !== 1) {
        throw new SmfError('SMF_HEADER', `Format 0 must have exactly one track; header declares ${trackCount}`);
    }
    if ((division & 0x8000) !== 0) {
        throw new SmfError('SMF_SMPTE_DIVISION', 'SMPTE time division is not supported');
    }
    if (division === 0) {
        throw new SmfError('SMF_HEADER', 'Ticks-per-quarter-note division is zero');
    }

    const ctx: ParseContext = { totalEvents: 0, warnings: [], warnedSystem: false };
    const parts: TrackParts[] = [];
    let pos = 8 + headerLength;
    while (parts.length < trackCount && pos < bytes.length) {
        if (pos + 8 > bytes.length) {
            throw new SmfError('SMF_TRUNCATED', 'Chunk header extends past the end of the file');
        }
        const length = readU32(bytes, pos + 4);
        const dataStart = pos + 8;
        if (length > bytes.length - dataStart) {
            throw new SmfError('SMF_TRUNCATED', 'Chunk extends past the end of the file');
        }
        const dataEnd = dataStart + length;
        if (tagAt(bytes, pos, 'MTrk')) {
            parts.push(parseTrack(bytes, dataStart, dataEnd, parts.length, ctx));
        }
        pos = dataEnd;
    }
    if (parts.length < trackCount) {
        ctx.warnings.push(`Header declares ${trackCount} track(s) but only ${parts.length} MTrk chunk(s) were found`);
    }
    if (pos < bytes.length) {
        ctx.warnings.push(`${bytes.length - pos} extra byte(s) after the last chunk`);
    }

    let durationTicks = 0;
    for (const part of parts) {
        durationTicks = Math.max(durationTicks, part.info.endTicks);
    }
    const notes = parts.flatMap(part => part.notes);
    notes.sort((a, b) => a.startTicks - b.startTicks || a.track - b.track);

    return {
        format: format === 0 ? 0 : 1,
        ppq: division,
        durationTicks,
        tracks: parts.map(part => part.info),
        notes,
        controlChanges: sortByTicksAndTrack(parts.flatMap(part => part.controlChanges)),
        pitchBends: sortByTicksAndTrack(parts.flatMap(part => part.pitchBends)),
        programChanges: sortByTicksAndTrack(parts.flatMap(part => part.programChanges)),
        channelPressures: sortByTicksAndTrack(parts.flatMap(part => part.channelPressures)),
        polyPressures: sortByTicksAndTrack(parts.flatMap(part => part.polyPressures)),
        tempos: sortByTicks(parts.flatMap(part => part.tempos)),
        timeSignatures: sortByTicks(parts.flatMap(part => part.timeSignatures)),
        keySignatures: sortByTicks(parts.flatMap(part => part.keySignatures)),
        markers: sortByTicks(parts.flatMap(part => part.markers)),
        warnings: ctx.warnings,
    };
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

const PRIORITY_NOTE_OFF = 0;
const PRIORITY_PROGRAM = 1;
const PRIORITY_CONTROL = 2;
const PRIORITY_PITCH_BEND = 3;
const PRIORITY_NOTE_ON = 4;
// A zero-duration note's Note Off must follow its own Note On at the same tick.
const PRIORITY_ZERO_LENGTH_NOTE_OFF = 5;

interface RawEvent {
    ticks: number;
    priority: number;
    bytes: number[];
}

function invalid(message: string): SmfError {
    return new SmfError('SMF_INVALID_INPUT', message);
}

function checkInt(value: unknown, min: number, max: number, label: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
        throw invalid(`${label} must be an integer from ${min} to ${max}; got ${String(value)}`);
    }
    return value;
}

function encodeText(value: unknown, label: string): Uint8Array {
    if (typeof value !== 'string') {
        throw invalid(`${label} must be a string`);
    }
    const encoded = new TextEncoder().encode(value);
    if (encoded.length > MAX_TEXT_BYTES) {
        throw invalid(`${label} is ${encoded.length} UTF-8 bytes; the limit is ${MAX_TEXT_BYTES}`);
    }
    return encoded;
}

function arrayOf<T>(value: T[] | undefined, label: string): T[] {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw invalid(`${label} must be an array`);
    }
    return value;
}

function writeVlq(out: number[], value: number): void {
    const groups: number[] = [value & 0x7f];
    let rest = value >>> 7;
    while (rest > 0) {
        groups.push((rest & 0x7f) | 0x80);
        rest >>>= 7;
    }
    for (let i = groups.length - 1; i >= 0; i--) {
        out.push(groups[i]);
    }
}

function sortEvents(events: RawEvent[]): RawEvent[] {
    events.sort((a, b) => a.ticks - b.ticks || a.priority - b.priority);
    return events;
}

function encodeTrack(name: Uint8Array | null, events: RawEvent[]): number[] {
    const out: number[] = [];
    let last = 0;
    if (name !== null) {
        writeVlq(out, 0);
        out.push(0xff, 0x03);
        writeVlq(out, name.length);
        for (const b of name) {
            out.push(b);
        }
    }
    for (const event of sortEvents(events)) {
        writeVlq(out, event.ticks - last);
        for (const b of event.bytes) {
            out.push(b);
        }
        last = event.ticks;
    }
    out.push(0x00, 0xff, 0x2f, 0x00);
    return out;
}

function writeU32(out: Uint8Array, offset: number, value: number): void {
    out[offset] = (value >>> 24) & 0xff;
    out[offset + 1] = (value >>> 16) & 0xff;
    out[offset + 2] = (value >>> 8) & 0xff;
    out[offset + 3] = value & 0xff;
}

export function buildSmf(input: SmfBuildInput): Uint8Array {
    if (typeof input !== 'object' || input === null) {
        throw invalid('input must be an object');
    }
    const ppq = input.ppq === undefined ? 480 : checkInt(input.ppq, 24, 960, 'ppq');
    if (!Array.isArray(input.tracks) || input.tracks.length < 1 || input.tracks.length > MAX_TRACKS_BUILD) {
        throw invalid(`tracks must contain 1..${MAX_TRACKS_BUILD} entries`);
    }
    const tempos = arrayOf(input.tempos, 'tempos');
    const timeSignatures = arrayOf(input.timeSignatures, 'timeSignatures');
    const markers = arrayOf(input.markers, 'markers');

    let eventTotal = tempos.length + timeSignatures.length + markers.length;
    for (const track of input.tracks) {
        if (typeof track !== 'object' || track === null) {
            throw invalid('each track must be an object');
        }
        eventTotal += arrayOf(track.notes, 'track notes').length * 2
            + arrayOf(track.controlChanges, 'track controlChanges').length
            + arrayOf(track.pitchBends, 'track pitchBends').length
            + arrayOf(track.programChanges, 'track programChanges').length;
    }
    if (eventTotal > MAX_EVENTS_BUILD) {
        throw invalid(`input contains ${eventTotal} events; the limit is ${MAX_EVENTS_BUILD}`);
    }

    const conductor: RawEvent[] = [];
    for (const tempo of tempos) {
        const ticks = checkInt(tempo.ticks, 0, MAX_TICKS, 'tempo ticks');
        const bpm = tempo.bpm;
        if (typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm < 1 || bpm > 999) {
            throw invalid(`tempo bpm must be a finite number from 1 to 999; got ${String(bpm)}`);
        }
        const us = Math.round(60000000 / bpm);
        if (us > MAX_TEMPO_MICROSECONDS) {
            throw invalid(`tempo ${bpm} bpm is too slow to encode (microseconds per quarter exceed 24 bits)`);
        }
        conductor.push({
            ticks, priority: 0,
            bytes: [0xff, 0x51, 0x03, (us >>> 16) & 0xff, (us >>> 8) & 0xff, us & 0xff],
        });
    }
    for (const sig of timeSignatures) {
        const ticks = checkInt(sig.ticks, 0, MAX_TICKS, 'time signature ticks');
        const numerator = checkInt(sig.numerator, 1, 255, 'time signature numerator');
        const power = typeof sig.denominator === 'number' ? DENOMINATOR_POWER.get(sig.denominator) : undefined;
        if (power === undefined) {
            throw invalid(`time signature denominator must be one of 1, 2, 4, 8, 16, 32, 64; got ${String(sig.denominator)}`);
        }
        conductor.push({ ticks, priority: 0, bytes: [0xff, 0x58, 0x04, numerator, power, 24, 8] });
    }
    for (const marker of markers) {
        const ticks = checkInt(marker.ticks, 0, MAX_TICKS, 'marker ticks');
        const text = encodeText(marker.text, 'marker text');
        // The meta length is a variable-length quantity: 128..255 bytes need two length bytes.
        const header: number[] = [0xff, 0x06];
        writeVlq(header, text.length);
        conductor.push({ ticks, priority: 0, bytes: [...header, ...text] });
    }

    const trackBodies: number[][] = [encodeTrack(null, conductor)];
    for (const track of input.tracks) {
        const defaultChannel = track.channel === undefined ? 0 : checkInt(track.channel, 0, 15, 'track channel');
        const name = track.name === undefined ? null : encodeText(track.name, 'track name');
        const events: RawEvent[] = [];

        for (const note of arrayOf(track.notes, 'track notes')) {
            const pitch = checkInt(note.pitch, 0, 127, 'note pitch');
            const velocity = note.velocity === undefined ? 100 : checkInt(note.velocity, 1, 127, 'note velocity');
            const release = note.releaseVelocity === undefined ? 64 : checkInt(note.releaseVelocity, 0, 127, 'note releaseVelocity');
            const start = checkInt(note.startTicks, 0, MAX_TICKS, 'note startTicks');
            const duration = checkInt(note.durationTicks, 0, MAX_TICKS, 'note durationTicks');
            if (start + duration > MAX_TICKS) {
                throw invalid(`note end tick ${start + duration} exceeds 0x0FFFFFFF`);
            }
            const channel = note.channel === undefined ? defaultChannel : checkInt(note.channel, 0, 15, 'note channel');
            events.push({ ticks: start, priority: PRIORITY_NOTE_ON, bytes: [0x90 | channel, pitch, velocity] });
            events.push({
                ticks: start + duration,
                priority: duration === 0 ? PRIORITY_ZERO_LENGTH_NOTE_OFF : PRIORITY_NOTE_OFF,
                bytes: [0x80 | channel, pitch, release],
            });
        }
        for (const cc of arrayOf(track.controlChanges, 'track controlChanges')) {
            const controller = checkInt(cc.controller, 0, 127, 'controller');
            const value = checkInt(cc.value, 0, 127, 'control change value');
            const ticks = checkInt(cc.ticks, 0, MAX_TICKS, 'control change ticks');
            const channel = cc.channel === undefined ? defaultChannel : checkInt(cc.channel, 0, 15, 'control change channel');
            events.push({ ticks, priority: PRIORITY_CONTROL, bytes: [0xb0 | channel, controller, value] });
        }
        for (const bend of arrayOf(track.pitchBends, 'track pitchBends')) {
            const value = checkInt(bend.value, -8192, 8191, 'pitch bend value') + 8192;
            const ticks = checkInt(bend.ticks, 0, MAX_TICKS, 'pitch bend ticks');
            const channel = bend.channel === undefined ? defaultChannel : checkInt(bend.channel, 0, 15, 'pitch bend channel');
            events.push({ ticks, priority: PRIORITY_PITCH_BEND, bytes: [0xe0 | channel, value & 0x7f, (value >> 7) & 0x7f] });
        }
        for (const pc of arrayOf(track.programChanges, 'track programChanges')) {
            const program = checkInt(pc.program, 0, 127, 'program');
            const ticks = checkInt(pc.ticks, 0, MAX_TICKS, 'program change ticks');
            const channel = pc.channel === undefined ? defaultChannel : checkInt(pc.channel, 0, 15, 'program change channel');
            events.push({ ticks, priority: PRIORITY_PROGRAM, bytes: [0xc0 | channel, program] });
        }
        trackBodies.push(encodeTrack(name, events));
    }

    let total = 14;
    for (const body of trackBodies) {
        total += 8 + body.length;
    }
    const out = new Uint8Array(total);
    out.set([0x4d, 0x54, 0x68, 0x64], 0);     // "MThd"
    writeU32(out, 4, 6);
    out[8] = 0;
    out[9] = 1;                                // format 1
    out[10] = (trackBodies.length >>> 8) & 0xff;
    out[11] = trackBodies.length & 0xff;
    out[12] = (ppq >>> 8) & 0xff;
    out[13] = ppq & 0xff;

    let offset = 14;
    for (const body of trackBodies) {
        out.set([0x4d, 0x54, 0x72, 0x6b], offset);   // "MTrk"
        writeU32(out, offset + 4, body.length);
        out.set(body, offset + 8);
        offset += 8 + body.length;
    }
    return out;
}
