import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { buildSmf, SmfError, type SmfBuildInput, type SmfModel } from './smf.js';

/**
 * Musical-unit view of Standard MIDI File data for the MCP tools.
 * Positions and lengths are quarter-note beats (beat 0 is the project start); the file itself
 * stays in ticks. Nothing here talks to Cubase; the last section only reads files.
 */

export interface SongNote { pitch: number; start: number; duration: number; velocity?: number }
export interface SongTrack {
    name?: string; channel?: number; program?: number; notes?: SongNote[];
    controlChanges?: { controller: number; value: number; beat: number }[];
    pitchBends?: { value: number; beat: number }[];
}
export interface Song { ppq?: number; tracks: SongTrack[] }

export interface SongSummary {
    ppq: number; trackCount: number; noteCount: number; durationBeats: number;
    tracks: { name: string | null; channel: number; program: number | null; noteCount: number; lowestPitch: number | null; highestPitch: number | null; endBeat: number }[];
}

const round = (value: number) => Math.round(value * 1e6) / 1e6;

function ticks(beat: number, ppq: number, label: string): number {
    if (typeof beat !== 'number' || !Number.isFinite(beat) || beat < 0) throw new SmfError('SMF_INVALID_INPUT', `${label} must be a nonnegative number of beats`);
    return Math.round(beat * ppq);
}

export interface Conductor { bpm: number; numerator: number; denominator: number }

/**
 * Converts a beat-based song description into Standard MIDI File bytes (format 1).
 * The conductor track always carries one tempo and one time signature: Cubase turns a conductor
 * track without any event into an empty MIDI track. Pass the current project values so that a
 * host that applies them changes nothing.
 */
export function songToSmf(song: Song, conductor: Conductor = { bpm: 120, numerator: 4, denominator: 4 }): { bytes: Uint8Array; summary: SongSummary } {
    const ppq = song.ppq ?? 480;
    const input: SmfBuildInput = { ppq, tracks: [], tempos: [{ ticks: 0, bpm: conductor.bpm }],
        timeSignatures: [{ ticks: 0, numerator: conductor.numerator, denominator: conductor.denominator }] };
    const summary: SongSummary = { ppq, trackCount: song.tracks.length, noteCount: 0, durationBeats: 0, tracks: [] };
    song.tracks.forEach((track, index) => {
        const channel = track.channel ?? 0;
        const notes = (track.notes ?? []).map((note, noteIndex) => {
            const startTicks = ticks(note.start, ppq, `track ${index} note ${noteIndex} start`);
            const durationTicks = Math.max(1, ticks(note.duration, ppq, `track ${index} note ${noteIndex} duration`));
            if (!(note.duration > 0)) throw new SmfError('SMF_INVALID_INPUT', `track ${index} note ${noteIndex} duration must be greater than zero`);
            return { pitch: note.pitch, velocity: note.velocity ?? 100, startTicks, durationTicks };
        });
        const controlChanges = (track.controlChanges ?? []).map((change, changeIndex) => ({
            controller: change.controller, value: change.value, ticks: ticks(change.beat, ppq, `track ${index} control change ${changeIndex} beat`) }));
        const pitchBends = (track.pitchBends ?? []).map((bend, bendIndex) => ({
            value: bend.value, ticks: ticks(bend.beat, ppq, `track ${index} pitch bend ${bendIndex} beat`) }));
        if (!notes.length && !controlChanges.length && !pitchBends.length) {
            throw new SmfError('SMF_INVALID_INPUT', `track ${index} has no notes or controller data; Cubase creates no track for it`);
        }
        input.tracks.push({ name: track.name, channel, notes, controlChanges, pitchBends,
            programChanges: track.program === undefined ? [] : [{ program: track.program, ticks: 0 }] });
        const end = notes.reduce((latest, note) => Math.max(latest, note.startTicks + note.durationTicks), 0);
        summary.noteCount += notes.length;
        summary.durationBeats = Math.max(summary.durationBeats, round(end / ppq));
        summary.tracks.push({ name: track.name ?? null, channel, program: track.program ?? null, noteCount: notes.length,
            lowestPitch: notes.length ? Math.min(...notes.map(note => note.pitch)) : null,
            highestPitch: notes.length ? Math.max(...notes.map(note => note.pitch)) : null, endBeat: round(end / ppq) });
    });
    return { bytes: buildSmf(input), summary };
}

export interface DescribeOptions { track?: number; noteOffset?: number; noteLimit?: number; includeControllers?: boolean }

/** Converts a parsed file into beats, with one summary per track and a bounded page of notes. */
export function describeMidi(model: SmfModel, options: DescribeOptions = {}) {
    const beat = (value: number) => round(value / model.ppq);
    const selected = (track: number) => options.track === undefined || track === options.track;
    const tracks = model.tracks.map(track => {
        const notes = model.notes.filter(note => note.track === track.index);
        const programs = model.programChanges.filter(change => change.track === track.index);
        return {
            index: track.index, name: track.name, noteCount: track.noteCount, endBeat: beat(track.endTicks),
            channels: [...new Set([...notes.map(note => note.channel), ...programs.map(change => change.channel)])].sort((a, b) => a - b),
            programs: programs.map(change => ({ channel: change.channel, program: change.program, beat: beat(change.ticks) })),
            lowestPitch: notes.length ? Math.min(...notes.map(note => note.pitch)) : null,
            highestPitch: notes.length ? Math.max(...notes.map(note => note.pitch)) : null,
            controlChangeCount: model.controlChanges.filter(change => change.track === track.index).length,
            pitchBendCount: model.pitchBends.filter(bend => bend.track === track.index).length
        };
    });
    const matching = model.notes.filter(note => selected(note.track))
        .sort((a, b) => a.startTicks - b.startTicks || a.track - b.track || a.pitch - b.pitch);
    const offset = options.noteOffset ?? 0, limit = options.noteLimit ?? 400;
    const page = matching.slice(offset, offset + limit);
    const next = offset + page.length;
    const result: Record<string, unknown> = {
        format: model.format, ppq: model.ppq, durationBeats: beat(model.durationTicks),
        tempos: model.tempos.map(tempo => ({ beat: beat(tempo.ticks), bpm: round(tempo.bpm) })),
        timeSignatures: model.timeSignatures.map(signature => ({ beat: beat(signature.ticks), numerator: signature.numerator, denominator: signature.denominator })),
        markers: model.markers.map(marker => ({ beat: beat(marker.ticks), text: marker.text })),
        tracks,
        notes: page.map(note => ({ track: note.track, channel: note.channel, pitch: note.pitch, start: beat(note.startTicks),
            duration: beat(note.durationTicks), velocity: note.velocity })),
        noteTotal: matching.length, noteOffset: offset, nextNoteOffset: next < matching.length ? next : null,
        warnings: model.warnings
    };
    if (options.includeControllers) {
        result.controlChanges = model.controlChanges.filter(change => selected(change.track)).slice(0, 2000)
            .map(change => ({ track: change.track, channel: change.channel, controller: change.controller, value: change.value, beat: beat(change.ticks) }));
        result.pitchBends = model.pitchBends.filter(bend => selected(bend.track)).slice(0, 2000)
            .map(bend => ({ track: bend.track, channel: bend.channel, value: bend.value, beat: beat(bend.ticks) }));
    }
    return result;
}

// ---------------------------------------------------------------------------
// Observation of a MIDI file that the host writes into the project folder
// ---------------------------------------------------------------------------

export interface MidiFileState { size: number; mtimeMs: number }

export async function listMidiFiles(directory: string): Promise<Map<string, MidiFileState>> {
    const found = new Map<string, MidiFileState>();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !/\.mid$/i.test(entry.name)) continue;
        try {
            const state = await stat(join(directory, entry.name));
            found.set(entry.name, { size: state.size, mtimeMs: state.mtimeMs });
        } catch { /* removed between the listing and the read */ }
    }
    return found;
}

const AUDIO_FILE = /\.(wav|w64|bwf|aif|aiff|flac|mp3|ogg)$/i;

/** Audio files below a directory, keyed by absolute path. Links are not followed. */
export async function listAudioFiles(directory: string, depth = 2, found = new Map<string, MidiFileState>()): Promise<Map<string, MidiFileState>> {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch { return found; }
    for (const entry of entries) {
        const full = join(directory, entry.name);
        if (entry.isDirectory() && depth > 0) await listAudioFiles(full, depth - 1, found);
        else if (entry.isFile() && AUDIO_FILE.test(entry.name)) {
            try { const state = await stat(full); found.set(full, { size: state.size, mtimeMs: state.mtimeMs }); }
            catch { /* removed between the listing and the read */ }
        }
    }
    return found;
}

/**
 * Waits until a .mid file in the directory is new or changed compared with `before` and its
 * bytes are identical in two consecutive reads. Read-only; returns null when nothing changed in time.
 */
export async function awaitWrittenMidiFile(directory: string, before: Map<string, MidiFileState>, timeoutMs: number, signal?: AbortSignal):
    Promise<{ path: string; bytes: Buffer; mtimeMs: number } | null> {
    const deadline = Date.now() + timeoutMs;
    let previous: { name: string; bytes: Buffer } | null = null;
    for (;;) {
        if (signal?.aborted) return null;
        const current = await listMidiFiles(directory);
        const changed = [...current.entries()].filter(([name, state]) => {
            const earlier = before.get(name);
            return !earlier || earlier.size !== state.size || earlier.mtimeMs !== state.mtimeMs;
        }).sort((left, right) => right[1].mtimeMs - left[1].mtimeMs)[0];
        if (changed) {
            try {
                const bytes = await readFile(join(directory, changed[0]));
                if (bytes.length >= 22 && bytes.subarray(0, 4).toString('latin1') === 'MThd') {
                    if (previous && previous.name === changed[0] && previous.bytes.equals(bytes)) {
                        return { path: join(directory, changed[0]), bytes, mtimeMs: changed[1].mtimeMs };
                    }
                    previous = { name: changed[0], bytes };
                } else { previous = null; }
            } catch { previous = null; }
        }
        if (Date.now() >= deadline) return null;
        await new Promise(resolve => setTimeout(resolve, 120));
    }
}
