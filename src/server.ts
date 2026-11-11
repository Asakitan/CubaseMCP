#!/usr/bin/env node
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { loadConfig, type Configuration } from './config.js';
import { BridgeError, MidiClient } from './midi.js';
import { inspectBridge, verifyBridge } from './bridge-contract.js';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';
import { saveProjectObserved } from './save-observer.js';
import { managedProjectOf, readOwnedWindows, runLifecycle } from './lifecycle.js';
import { parseSmf, SmfError } from './smf.js';
import { awaitWrittenMidiFile, describeMidi, listMidiFiles, songToSmf, type Song } from './song.js';
import { inspectAudio } from './audio-info.js';
import { readProjectSampleRate } from './project-rate.js';
import { resampleWavFile } from './resample.js';

export const constraints = {
    backend: 'midi',
    backendScope: 'parameter and control transport',
    projectLifecycleBackend: 'fixed-build native calls in an owned private-desktop process',
    backgroundOnly: true,
    fallback: false,
    automaticRetry: false,
    startupRecovery: 'Before native project admission only: one observed license-startup wait may restart the owned empty host and its exact local license helper. No submitted operation is replayed.',
    fullCubaseCoverage: false,
    editionVerification: 'AI feature availability requires a live licensed host; version is checked at handshake.',
    songWorkflow: [
        'cubase_project_create or cubase_project_open',
        'cubase_tempo_set and cubase_transport_set (signature)',
        'cubase_midi_import (song in beats or a .mid file) creates MIDI tracks with notes',
        'cubase_midi_read returns the MIDI content Cubase holds',
        'cubase_events_list reads native events and notes; cubase_event_edit and cubase_midi_note_edit modify individual events',
        'cubase_audio_import imports an explicit source path without a file chooser',
        'cubase_channels_list, cubase_channel_set and cubase_track_edit organise and mix tracks',
        'cubase_track_create adds empty MIDI, instrument, Group, FX or folder tracks; cubase_plugin_unload clears an observed plugin slot',
        'cubase_automation_read and cubase_automation_edit manage parameter lanes and normalized points',
        'cubase_routes_list and cubase_routing_set enumerate and connect audio input/output and send buses',
        'cubase_command_execute runs one allowlisted editing command on the current selection',
        'cubase_audio_export renders to an explicit path with the native NonUI controller',
        'cubase_transport_action plays and stops; cubase_project_save stores the project'
    ],
    unsupported: [
        'Project overwrite, merge, collect/copy and unverified format imports',
        'Native single-note insertion/deletion and certified undo transactions',
        'Audio recording, stretching and audio edits beyond event position/duration',
        'Per-channel stems and export formats other than WAV, AIFF and FLAC',
        'Instrument preset selection and plug-in state import/export',
        'Plugin GUI, preset file dialogs, any host window or prompt, and menu commands outside the allowlist',
        'Unimplemented features or features absent from the active Cubase AI license'
    ]
};

function result(data: unknown): CallToolResult {
    const body = { ok: true, data };
    return { content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: body };
}

function failure(error: unknown): CallToolResult {
    const body = {
        ok: false,
        error: error instanceof BridgeError
            ? { code: error.code, message: error.message, details: error.details, execution: error.execution }
            : { code: 'MCP_OPERATION_FAILED', message: error instanceof Error ? error.message : String(error), execution: 'unknown' },
        policy: constraints
    };
    return { isError: true, content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: body };
}

// Capability discovery is a summary, not the handshake of record: a mapping that does not answer
// must be reported as unobserved instead of burning the configured operation timeout.
const CAPABILITY_HANDSHAKE_MS = 2000;

// Cubase AI 16 holds at most 32 audio tracks. Observed on 2026-11-11 in a full production: the import of a 33rd file returned success and
// wrote the converted copy, but no audio channel appeared (the mixer listing was unchanged and no window was open).
const AUDIO_TRACK_LIMIT = 32;

/** Owned-runtime inventory without any MIDI handshake; a lifecycle failure is reported, not thrown. */
async function ownedRuntime(signal?: AbortSignal): Promise<Record<string, unknown>> {
    try {
        return { observed: true, ...(await runLifecycle('status', {}, signal)) };
    } catch (error) {
        return { observed: false, running: null,
            error: error instanceof BridgeError
                ? { code: error.code, message: error.message }
                : { code: 'LIFECYCLE_STATUS_FAILED', message: error instanceof Error ? error.message : String(error) } };
    }
}

export function createServer(config: Configuration = loadConfig()) {
    let client = new MidiClient(config.midi);
    let lifecycleBusy = false;
    const server = new McpServer({ name: 'cubase-ai16-mcp', version: '0.1.0' }, {
        instructions: 'Cubase AI 16 runs as an owned background instance; nothing here opens, focuses or operates a window. Start with cubase_runtime_status, then cubase_project_create or cubase_project_open; both return the session that every other tool needs (cubase_status returns the current one). To write music: cubase_tempo_set, cubase_transport_set (signature), then cubase_midi_import with a song in quarter-note beats; cubase_midi_read returns what Cubase holds. cubase_channels_list shows the tracks; cubase_channel_set renames, selects, mutes and sets volume or pan; cubase_track_edit duplicates, moves, clears or removes a track; cubase_command_execute runs one allowlisted command (see cubase_commands_list) on the current selection and cursor; cubase_transport_action plays and stops; cubase_project_save stores the project. Object IDs and parameter tags are valid for one session only: copy them from the latest listing. A receipt with execution "submitted" means the host accepted the request, not that the change happened: read the state back. Never repeat a submitted or timed-out operation automatically. If cubase_runtime_windows reports an unexpected window, replace the instance; no tool can answer a host prompt. cubase://constraints lists what is not supported.'
    });
    const session = { session: z.string().min(1).max(200) };
    const root = z.enum(['trackSelection', 'mixConsole', 'transport', 'focusedQuickControls']);
    const reference = { ...session, root, objectId: z.number().int().nonnegative() };
    const pagination = { offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(64).default(32) };

    async function readStatus(signal?: AbortSignal, timeoutMs?: number): Promise<Record<string, unknown>> {
        // bridge.status never changes project state, so a lost reply is not an uncertain submission.
        const status = await client.request('bridge.status', {}, signal,
            { readOnly: true, ...(timeoutMs === undefined ? {} : { timeoutMs }) }) as Record<string, unknown>;
        const compatibility = inspectBridge(status);
        if (!compatibility.hostVersionMatches) {
            client.close();
            throw new BridgeError('HOST_VERSION_MISMATCH', 'Only a live Cubase 16 host is accepted.', 'not_started');
        }
        return { ...status, serverCompatibility: compatibility };
    }

    type Confirm = (data: Record<string, unknown>, args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;

    function expose<Shape extends z.ZodRawShape>(name: string, operation: string, description: string, shape: Shape, readOnly = true, confirm?: Confirm) {
        server.registerTool(name, {
            description,
            inputSchema: z.object(shape).strict(),
            annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: readOnly, openWorldHint: false }
        }, async (args, context) => {
            try {
                if (lifecycleBusy) throw new BridgeError('LIFECYCLE_BUSY', 'An owned runtime transition is active.');
                const requestArgs = { ...(args as Record<string, unknown>) };
                // settleMs is a server-side observation window; it is never sent to the bridge.
                const settleMs = typeof requestArgs.settleMs === 'number' ? requestArgs.settleMs : 0;
                delete requestArgs.settleMs;
                if (operation === 'bridge.status') return result(await readStatus(context.mcpReq.signal));
                verifyBridge(await readStatus(context.mcpReq.signal), requestArgs.session);
                const data = operation === 'commands.execute' && requestArgs.key === 'project.save'
                    ? await client.executeSave(requestArgs, context.mcpReq.signal)
                    : await client.request(operation, requestArgs, context.mcpReq.signal);
                if (confirm && settleMs > 0 && data && typeof data === 'object' && requestArgs.key !== 'project.save') {
                    return result(await confirm(data as Record<string, unknown>, { ...requestArgs, settleMs }, context.mcpReq.signal));
                }
                return result(data);
            } catch (error) {
                return failure(error);
            }
        });
    }

    const pause = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

    // A submission receipt is not completion. These helpers only read back what the host reports
    // afterwards; a write that the host did not confirm inside the window stays "not observed".
    async function confirmControl(data: Record<string, unknown>, args: Record<string, unknown>, signal?: AbortSignal) {
        if (data.action === true) return { ...data, confirmation: { state: 'not_applicable', reason: 'Host actions report no value feedback.' } };
        const started = Date.now(), before = data.before as { revision?: number } | null;
        let control: Record<string, unknown> | undefined;
        do {
            await pause(60);
            const reply = await client.request('controls.get', { session: data.session, key: args.key }, signal) as { control: Record<string, unknown> };
            control = reply.control;
            const observed = control.observed as { value: number; revision: number } | null;
            if (observed && (!before || observed.revision !== before.revision)) {
                return { ...data, confirmation: { state: 'feedback_observed', observed, display: control.display ?? null,
                    matchesRequest: Math.abs(observed.value - (args.value as number)) < 1e-6, waitedMs: Date.now() - started } };
            }
        } while (Date.now() - started < (args.settleMs as number));
        return { ...data, confirmation: { state: 'not_observed', observed: control?.observed ?? null, waitedMs: Date.now() - started } };
    }

    async function confirmCommand(data: Record<string, unknown>, args: Record<string, unknown>, signal?: AbortSignal) {
        const started = Date.now(), before = typeof data.bindingEventsBefore === 'number' ? data.bindingEventsBefore : 0;
        let events = before;
        do {
            await pause(60);
            const reply = await client.request('commands.get', { session: data.session, key: args.key }, signal) as { command: { bindingEvents: number } };
            events = reply.command.bindingEvents;
            if (events > before) return { ...data, bindingEvents: events, bindingObserved: true, waitedMs: Date.now() - started };
        } while (Date.now() - started < (args.settleMs as number));
        return { ...data, bindingEvents: events, bindingObserved: false, waitedMs: Date.now() - started };
    }

    expose('cubase_status', 'bridge.status', 'Handshake with the live Cubase 16 bridge. Returns the current session and observed capabilities, never simulated state.', {});
    expose('cubase_host_info', 'host.info', 'Read the actual host application name, version and edition-dependent slot/channel limits. Unavailable fields are null with explicit errors.', session);
    expose('cubase_objects_list', 'objects.list', 'Discover actual host objects. Omit parentId for the root. IDs are valid only for this session and root. Pagination is explicit.', { ...session, root, parentId: z.number().int().nonnegative().optional(), ...pagination });
    expose('cubase_object_get', 'objects.get', 'Inspect an object already returned by discovery; unobserved or stale IDs are rejected.', reference);
    expose('cubase_mixer_channel_info', 'mixer.channel', 'Read host-reported visibility, mixer index and zone for a previously discovered channel object.', reference);
    expose('cubase_parameters_list', 'parameters.list', 'Discover actual parameter tags, values, units and edit locks for an observed object.', { ...reference, ...pagination });
    expose('cubase_parameter_get', 'parameters.get', 'Read one previously discovered parameter and its current value, display, default, type and edit-lock state. Rejects stale object IDs and tags.', {
        ...reference, tag: z.number().int().min(-2147483648).max(4294967295)
    });
    expose('cubase_parameter_set', 'parameters.set', 'Write a discovered parameter using exactly the requested representation. expectedValue compares the current native process value. Re-read to verify an asynchronous host change.', {
        ...reference,
        tag: z.number().int().min(-2147483648).max(4294967295),
        mode: z.enum(['normalized', 'plain', 'display']),
        value: z.union([z.number().finite(), z.string().max(1024)]),
        expectedValue: z.number().finite().optional()
    }, false);
    expose('cubase_parameter_edit_lock_set', 'parameters.lock', 'Submit an edit-lock change for an observed parameter. expectedLocked must match the current host lock state; re-read the parameter to verify the outcome.', {
        ...reference, tag: z.number().int().min(-2147483648).max(4294967295),
        locked: z.boolean(), expectedLocked: z.boolean()
    }, false);
    expose('cubase_plugins_list', 'plugins.list', 'List plugins offered by the active host for a discovered plugin slot, without opening plugin windows.', { ...reference, collection: z.number().int().nonnegative().default(0), ...pagination });
    expose('cubase_plugin_set', 'plugins.set', 'Load or replace a plug-in by a UID discovered for this slot. The host discard prompt is suppressed. No plug-in window is opened. Use cubase_plugin_unload to clear a discovered occupied slot. Requires explicit confirmation.', {
        ...reference, pluginUid: z.string().min(1).max(512), confirmReplacement: z.literal(true)
    }, false);
    expose('cubase_controls_list', 'controls.list', 'Page declared controls and groups independently. Follow nextOffset and nextGroupOffset until null; unknown values remain unknown until host feedback arrives.', {
        ...session, offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(16).default(16),
        groupOffset: z.number().int().nonnegative().default(0), groupLimit: z.number().int().min(1).max(16).default(16)
    });
    expose('cubase_control_get', 'controls.get', 'Read one declared control, its availability, read-only status and last host feedback.', {
        ...session, key: z.string().min(1).max(100)
    });
    expose('cubase_control_set', 'controls.set', 'Set one declared background control by key; value is normalized 0..1. The control must belong to the active mapping page (see cubase_pages_list; mixer.* keys need the mixer page). Bank channel writes require a previously observed expectedChannelUniqueId. Plug-in bank and insert-viewer writes require the exact pluginIdentity from cubase_control_get and the current channel identity. Optionally guard a track control using both its unique and runtime IDs. Buttons may be momentary. settleMs waits for host feedback and reports confirmation.state; without it the receipt is submission only. Does not open or focus a window.', {
        ...session, key: z.string().min(1).max(100), value: z.number().min(0).max(1),
        settleMs: z.number().int().min(0).max(3000).default(800),
        expectedTrackUniqueId: z.string().min(1).max(512).optional(),
        expectedTrackRuntimeId: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
        expectedChannelUniqueId: z.string().min(1).max(512).optional(),
        expectedPluginIdentity: z.object({
            name: z.string().min(1).max(4096), vendor: z.string().max(4096),
            version: z.string().max(4096), formatVersion: z.string().max(4096)
        }).strict().optional()
    }, false, confirmControl);
    expose('cubase_tempo_set', 'transport.tempo', 'Submit a tempo in BPM through the native transport API. The host determines its supported range; inspect the observed tempo before assuming completion.', {
        ...session, bpm: z.number().finite().positive()
    }, false);
    expose('cubase_transport_get', 'transport.get', 'Read observed tempo and locator callbacks and available tempo/time setter features. Values not yet observed are null.', session);
    expose('cubase_locator_set', 'transport.time', 'Set the playhead or one cycle locator in the selected primary/secondary time-display format. Supply a Cubase time string in that existing format; does not change the display or open a dialog.', {
        ...session, display: z.enum(['primary', 'secondary']),
        locator: z.enum(['cursor', 'cycleLeft', 'cycleRight']), time: z.string().min(1).max(64)
    }, false);
    expose('cubase_commands_list', 'commands.list', 'Page the fixed key-command allowlist with live canPerform state. Filter by group (edit, track, transport, marker, midi, audio, nudge, navigate, automation, mixer, project). This is a fixed table, not the complete Cubase menu; nothing outside it can run.', {
        ...session, group: z.string().min(1).max(32).optional(), ...pagination
    });
    expose('cubase_command_get', 'commands.get', 'Read one allowlisted command: its Cubase category/name, context note, live canPerform state and how many binding events the host has reported for it in this session.', {
        ...session, key: z.string().min(1).max(100)
    });
    expose('cubase_command_execute', 'commands.execute', 'Execute one allowlisted key command once on the main mapping page, only when canPerform succeeds. settleMs waits for the host binding event and returns bindingObserved; that confirms the trigger reached Cubase, not the resulting project change, which must be read back (objects, parameters, files). project.save uses one prepared MIDI input on its internal Save mapping page and returns a new session. Commands act on the current Cubase selection and cursor; no window is opened or focused by this server.', {
        ...session, key: z.string().min(1).max(100), confirmCurrentSelection: z.literal(true),
        settleMs: z.number().int().min(0).max(3000).default(1200)
    }, false, confirmCommand);
    expose('cubase_pages_list', 'pages.list', 'List the mapping pages of the bridge (main, mixer), which one is active and the activation feedback counters. surfaceInput "stalled" means the page did not finish activating and its bindings cannot write.', session);
    expose('cubase_page_activate', 'pages.activate', 'Activate the main or mixer mapping page. The reply carries a NEW session; discover objects and controls again. Only mixer.* controls live on the mixer page; everything else needs the main page.', {
        ...session, page: z.enum(['main', 'mixer'])
    }, false);
    const channelField = z.enum(['name', 'volume', 'pan', 'mute', 'solo', 'selected', 'monitor', 'recordEnable', 'automationRead', 'automationWrite']);
    expose('cubase_channels_list', 'channels.list', 'Overview of the mixer channels of the active project in project order: type (AudioChannel, MidiChannel, Synth, OutputChannel, ...), title, uniqueIdString and the fields name, volume, pan, mute, solo, selected, monitor, recordEnable, automationRead/Write, midiChannel, input, output and freeze with their current value and display text. Each field also names the objectId and tag that carry it, admitted for cubase_parameter_set. Tracks without a mixer channel (marker, chord, video, folder, ruler) are not listed. Object IDs are valid for this session only.', {
        ...session, ...pagination
    });
    expose('cubase_channel_set', 'channels.set', 'Write one field of a channel returned by cubase_channels_list. name takes text; mute, solo, selected, monitor, recordEnable, automationRead and automationWrite take a boolean; volume and pan take a normalized number 0..1 (pan 0.5 is centre) or the host display text (for example "-6" dB). selected=true selects that channel exclusively. The receipt carries the value read immediately before and after; list the channels again to confirm an asynchronous change.', {
        ...session, objectId: z.number().int().nonnegative(), expectedUniqueId: z.string().min(1).max(512),
        field: channelField, value: z.union([z.boolean(), z.number().min(0).max(1), z.string().min(1).max(128)])
    }, false);
    expose('cubase_transport_state', 'transport.state', 'Read the transport of the active project: playing, stopped, recording, cycle, punch in/out, metronome, precount, cursor position in both time displays, cycle locators, time signature and the last observed tempo. Values are read from the host at call time; tempo is null until the host has reported it.', session);
    expose('cubase_transport_set', 'transport.set', 'Write one transport field: signature takes "numerator/denominator" (for example "3/4") and changes the time signature at the project start; cycle, metronome, precount, punchIn and punchOut take a boolean. The receipt carries the transport state before and after.', {
        ...session, field: z.enum(['signature', 'cycle', 'metronome', 'precount', 'punchIn', 'punchOut']),
        value: z.union([z.boolean(), z.string().min(3).max(5)])
    }, false);
    expose('cubase_selected_track', 'track.current','Read the current selected channel runtime ID and unique ID directly from Cubase. Use them to guard track controls and navigation.', session);
    expose('cubase_track_navigate', 'track.navigate', 'Select the previous or next track using the native MIDI Remote action. Requires the selected channel uniqueId and optionally its runtimeId; returns submitted, not verified completion.', {
        ...session, direction: z.enum(['previous', 'next']), expectedUniqueId: z.string().min(1).max(512),
        expectedRuntimeId: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional()
    }, false);

    // Tools that combine several bridge requests. Each still performs every host write exactly once.
    function compose<Shape extends z.ZodRawShape>(name: string, description: string, shape: Shape, readOnly: boolean,
        handler: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>) {
        server.registerTool(name, {
            description, inputSchema: z.object(shape).strict(),
            annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: readOnly, openWorldHint: false }
        }, async (args, context) => {
            try {
                if (lifecycleBusy) throw new BridgeError('LIFECYCLE_BUSY', 'An owned runtime transition is active.');
                const requestArgs = args as Record<string, unknown>;
                verifyBridge(await readStatus(context.mcpReq.signal), requestArgs.session);
                return result(await handler(requestArgs, context.mcpReq.signal));
            } catch (error) { return failure(error); }
        });
    }

    compose('cubase_transport_action', 'Trigger one transport action once: start, stop, returnToZero, gotoEnd, gotoNextMarker, gotoPrevMarker, stepBar or stepBackBar. settleMs later the transport is read again and returned as "after"; compare it with "before" to confirm the effect. Playback runs in the owned background instance; nothing is focused.', {
        ...session, action: z.enum(['start', 'stop', 'returnToZero', 'gotoEnd', 'gotoNextMarker', 'gotoPrevMarker', 'stepBar', 'stepBackBar']),
        settleMs: z.number().int().min(0).max(3000).default(400)
    }, false, async (args, signal) => {
        const receipt = await client.request('transport.action', { session: args.session, action: args.action }, signal) as Record<string, unknown>;
        await pause(args.settleMs as number);
        const after = await client.request('transport.state', { session: args.session }, signal) as Record<string, unknown>;
        return { ...receipt, after };
    });

    interface ChannelField { objectId: number; tag: number; value: number; display: string; writable: boolean }
    interface ChannelItem { index: number; objectId: number; typeName: string; title: string; uniqueIdString: string; fields: Record<string, ChannelField | null> }

    async function allChannels(sessionId: unknown, signal?: AbortSignal): Promise<ChannelItem[]> {
        const items: ChannelItem[] = [];
        const seen = new Set<string>();
        for (let offset: number | null = 0; offset !== null;) {
            const page = await client.request('channels.list', { session: sessionId, offset, limit: 32 }, signal) as { items: ChannelItem[]; nextOffset: number | null };
            for (const channel of page.items) {
                if (seen.has(channel.uniqueIdString)) continue;
                seen.add(channel.uniqueIdString);
                items.push(channel);
            }
            offset = page.nextOffset;
        }
        return items;
    }
    const on = (channel: ChannelItem, field: string) => { const value = channel.fields[field]; return value ? value.value >= 0.5 : null; };
    const brief = (channel: ChannelItem) => ({ objectId: channel.objectId, typeName: channel.typeName, title: channel.title,
        uniqueIdString: channel.uniqueIdString, selected: on(channel, 'selected'), mute: on(channel, 'mute'), solo: on(channel, 'solo') });

    // One execution of one allowlisted command, with the host binding event as the only confirmation.
    async function runCommand(sessionId: unknown, key: string, signal?: AbortSignal, tool?: string) {
        const info = await client.request('commands.get', { session: sessionId, key }, signal) as { command: { canPerform: boolean } };
        if (!info.command.canPerform) return { key, performed: false as const, bindingObserved: false, reason: 'not_performable' };
        const receipt = await client.request('commands.execute', { session: sessionId, key, confirmCurrentSelection: true, ...(tool ? { tool } : {}) }, signal) as Record<string, unknown>;
        const confirmed = await confirmCommand(receipt, { key, settleMs: 1500 }, signal) as { bindingObserved: boolean; waitedMs: number };
        return { key, performed: true as const, bindingObserved: confirmed.bindingObserved, waitedMs: confirmed.waitedMs };
    }

    // Windows that are neither the project window nor the Hub are reported, never operated.
    async function unexpectedWindows(projectName: string | null, signal?: AbortSignal) {
        try {
            const sample = await readOwnedWindows(signal);
            const expected = (title: string) => / Hub$/.test(title) || (projectName !== null && title.endsWith(` - ${projectName}`));
            return { observed: true, windows: sample.windows, unexpected: sample.windows.filter(item => !expected(item.title)) };
        } catch (error) {
            return { observed: false, windows: [], unexpected: [], error: error instanceof Error ? error.message : String(error) };
        }
    }

    const trackSequences: Record<string, string[]> = {
        duplicate: ['track.duplicate'], moveUp: ['track.move.previous'], moveDown: ['track.move.next'],
        moveFirst: ['track.move.first'], moveLast: ['track.move.last'],
        clearEvents: ['edit.selectAllOnTracks', 'edit.delete'],
        remove: ['edit.selectAllOnTracks', 'edit.delete', 'track.removeSelected']
    };

    compose('cubase_track_edit', 'Edit one track through its mixer channel from cubase_channels_list: duplicate, moveUp, moveDown, moveFirst, moveLast, clearEvents (delete every event on the track) or remove. The tool first selects exactly that channel and confirms the selection, then runs the fixed command sequence once; remove deletes the track events first because Cubase asks for confirmation before removing a track with content. The result lists the channels before and after, what was added or removed, each command step with its host binding event, and any unexpected window on the private desktop. Object IDs change after an edit: list the channels again.', {
        ...session, objectId: z.number().int().nonnegative(), expectedUniqueId: z.string().min(1).max(512),
        action: z.enum(['duplicate', 'moveUp', 'moveDown', 'moveFirst', 'moveLast', 'clearEvents', 'remove']), confirmEdit: z.literal(true)
    }, false, async (args, signal) => {
        const before = await allChannels(args.session, signal);
        const target = before.find(channel => channel.objectId === args.objectId);
        if (!target || target.uniqueIdString !== args.expectedUniqueId) {
            throw new BridgeError('CHANNEL_CHANGED', 'The channel is not in the current list with this identity; call cubase_channels_list again.');
        }
        if (!target.fields.selected) throw new BridgeError('FIELD_UNAVAILABLE', 'This channel cannot be selected through the bridge.');
        await client.request('channels.set', { session: args.session, objectId: target.objectId, expectedUniqueId: target.uniqueIdString, field: 'selected', value: true }, signal);
        let selection: ChannelItem[] = [];
        for (const started = Date.now(); ;) {
            await pause(120);
            selection = (await allChannels(args.session, signal)).filter(channel => on(channel, 'selected'));
            if (selection.length === 1 && selection[0].uniqueIdString === target.uniqueIdString) break;
            if (Date.now() - started > 1500) {
                throw new BridgeError('SELECTION_NOT_CONFIRMED', 'Cubase did not report exactly the requested channel as selected; no command was executed.',
                    'submitted', { selected: selection.map(brief) });
            }
        }
        const steps: Record<string, unknown>[] = [];
        let complete = true;
        const sequence = trackSequences[args.action as string];
        for (const key of sequence) {
            const last = key === sequence[sequence.length - 1];
            const step = await runCommand(args.session, key, signal, key === 'track.removeSelected' ? 'cubase_track_edit' : undefined);
            steps.push(step);
            // An event command that cannot perform means there is nothing to select or delete; the track command still runs.
            if (!step.performed && !last && sequence.length > 1) continue;
            if (!step.performed || !step.bindingObserved) { complete = false; break; }
            await pause(250);
        }
        await pause(400);
        const host = await readStatus(signal);
        const after = await allChannels(host.session, signal);
        const project = await runLifecycle('status', {}, signal).then(managedProjectOf).catch(() => null);
        const windows = await unexpectedWindows(project ? project.name : null, signal);
        const added = after.filter(channel => !before.some(other => other.uniqueIdString === channel.uniqueIdString));
        const removed = before.filter(channel => !after.some(other => other.uniqueIdString === channel.uniqueIdString));
        return { action: args.action, target: brief(target), steps, sequenceCompleted: complete, session: host.session,
            added: added.map(brief), removed: removed.map(brief),
            orderBefore: before.map(channel => channel.title), orderAfter: after.map(channel => channel.title),
            channels: after.map(brief), windows: { observed: windows.observed, unexpected: windows.unexpected },
            note: windows.unexpected.length ? 'A host window that this server does not operate is open. Replace the owned instance (cubase_project_open or cubase_project_create with replaceCurrent) before continuing.' : undefined };
    });

    const beat = z.number().finite().min(0).max(100000);
    const songShape = z.object({
        ppq: z.number().int().min(24).max(960).default(480),
        tracks: z.array(z.object({
            name: z.string().min(1).max(100).optional(),
            channel: z.number().int().min(0).max(15).default(0),
            program: z.number().int().min(0).max(127).optional(),
            notes: z.array(z.object({ pitch: z.number().int().min(0).max(127), start: beat, duration: z.number().finite().positive().max(100000),
                velocity: z.number().int().min(1).max(127).default(100) }).strict()).max(20000).default([]),
            controlChanges: z.array(z.object({ controller: z.number().int().min(0).max(127), value: z.number().int().min(0).max(127), beat }).strict()).max(20000).default([]),
            pitchBends: z.array(z.object({ value: z.number().int().min(-8192).max(8191), beat }).strict()).max(20000).default([])
        }).strict()).min(1).max(32)
    }).strict();

    compose('cubase_midi_import', 'Add MIDI data to the managed project as new tracks: this is how MIDI tracks with notes are created. Supply either song (tracks with notes in quarter-note beats: pitch 0-127, start, duration, velocity; optional channel 0-15, GM program, controller and pitch-bend events; channel 9 is the GM drum channel) or midiPath (an existing local .mid file). The data is written as a Standard MIDI File and imported once through the MIDI file import of the host, following the Cubase MIDI import preferences of this installation; here every file track becomes one MIDI track routed to a HALion Sonic instance that the import creates, so put a whole arrangement into one call where possible. Tempo and time-signature events of the file are not applied to an existing project: use cubase_tempo_set and cubase_transport_set. The result lists the channels that the import added; read the notes back with cubase_midi_read. Never repeated automatically.', {
        ...session, song: songShape.optional(), midiPath: z.string().min(5).max(500).optional(), confirmImport: z.literal(true)
    }, false, async (args, signal) => {
        if ((args.song === undefined) === (args.midiPath === undefined)) throw new BridgeError('INVALID_ARGUMENT', 'Supply exactly one of song or midiPath.');
        const project = managedProjectOf(await runLifecycle('status', {}, signal));
        let midiPath: string, generated = false, summary: unknown = null, bytes: number;
        try {
            if (args.song !== undefined) {
                // The file carries the current project tempo and signature, so a host that applies them changes nothing.
                const transport = await client.request('transport.state', { session: args.session }, signal) as { tempo: { bpm: number } | null; signature: string | null };
                const signature = /^(\d+)\/(\d+)$/.exec(transport.signature ?? '') ?? ['', '4', '4'];
                const built = songToSmf(args.song as Song, { bpm: transport.tempo ? transport.tempo.bpm : 120,
                    numerator: Number(signature[1]), denominator: Number(signature[2]) });
                const directory = join(project.directory, 'MCP MIDI');
                await mkdir(directory, { recursive: true });
                midiPath = join(directory, `import-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '')}-${randomBytes(3).toString('hex')}.mid`);
                await writeFile(midiPath, built.bytes, { flag: 'wx' });
                generated = true; summary = built.summary; bytes = built.bytes.length;
            } else {
                midiPath = resolve(args.midiPath as string);
                if (!isAbsolute(args.midiPath as string) || !['.mid', '.midi'].includes(extname(midiPath).toLowerCase())) {
                    throw new BridgeError('INVALID_ARGUMENT', 'midiPath must be an absolute path to a .mid or .midi file.');
                }
                const content = await readFile(midiPath);
                bytes = content.length;
                try {
                    const model = describeMidi(parseSmf(content), { noteLimit: 0 });
                    summary = { ppq: model.ppq, durationBeats: model.durationBeats, tracks: model.tracks, noteCount: model.noteTotal };
                } catch (error) { summary = { unparsed: error instanceof Error ? error.message : String(error) }; }
            }
        } catch (error) {
            if (error instanceof BridgeError) throw error;
            throw new BridgeError(error instanceof SmfError ? error.code : 'MIDI_SOURCE_FAILED', error instanceof Error ? error.message : String(error));
        }
        const before = await allChannels(args.session, signal);
        let outcome: Record<string, unknown>;
        lifecycleBusy = true;
        try { outcome = await runLifecycle('import_midi', { midiPath, confirmImport: true }, signal); }
        finally { lifecycleBusy = false; }
        await pause(300);
        const host = await readStatus(signal);
        verifyBridge(host, host.session);
        const after = await allChannels(host.session, signal);
        const added = after.filter(channel => !before.some(other => other.uniqueIdString === channel.uniqueIdString));
        return { source: { path: midiPath, bytes, generated, summary }, native: outcome.native ?? null, session: host.session,
            channels: { before: before.length, after: after.length, added: added.map(brief) },
            tempoAndSignatureApplied: false,
            note: 'Tempo and time-signature events of the file are not applied when merging into the open project; set them with cubase_tempo_set and cubase_transport_set.' };
    });

    compose('cubase_events_list', 'Read the native track/part/event tree, including individual MIDI notes. Returns each path, temporary eventId, type, name, lock state, host-converted startSeconds/durationSeconds and native time values. MIDI notes also include pitch, 7-bit velocity, channel and the original velocityNormalized. Paths and IDs are lifetime-bound; rediscover after structural changes or reopen. Use exact observed values with cubase_event_edit or cubase_midi_note_edit. No file-write command, selection change or window is used.', {
        ...session, offset: z.number().int().min(0).max(8192).default(0), limit: z.number().int().min(1).max(128).default(64)
    }, true, async (args, signal) => {
        const project = managedProjectOf(await runLifecycle('status', {}, signal));
        lifecycleBusy = true;
        try {
            const outcome = await runLifecycle('model_snapshot', { projectPath: project.projectPath, offset: args.offset, limit: args.limit }, signal);
            return { session: args.session, projectPath: project.projectPath, ...(outcome.model as Record<string, unknown>),
                native: outcome.native, artifacts: outcome.artifacts };
        } finally { lifecycleBusy = false; }
    });

    const automationReference = {
        ...session, root: z.string().regex(/^0x[0-9a-fA-F]{1,16}$/),
        trackEventId: z.string().regex(/^0x(?!0+$)[0-9a-fA-F]{1,16}$/)
    };
    async function automationRequest(args: Record<string, unknown>, signal: AbortSignal | undefined, write: boolean) {
        const payload: Record<string, unknown> = { root: args.root, trackEventId: args.trackEventId };
        if (write) {
            const expected = args.expected as { pointCount?: number; laneCount?: number; startSeconds?: number; normalizedValue?: number };
            const createLane = args.action === 'createLane';
            const insert = args.action === 'insert';
            if (createLane) {
                if (args.objectId === undefined || args.expectedUniqueId === undefined || expected.laneCount === undefined ||
                    expected.pointCount !== undefined || expected.startSeconds !== undefined || expected.normalizedValue !== undefined ||
                    args.laneEventId !== undefined || args.pointEventId !== undefined || args.positionSeconds !== undefined || args.value !== undefined)
                    throw new BridgeError('INVALID_ARGUMENT', 'createLane needs an object identity and expected laneCount only.');
                Object.assign(payload, { automationAction: args.action, objectId: args.objectId, parameterTag: args.parameterTag,
                    expectedPointCount: expected.laneCount });
            } else {
                if (args.laneEventId === undefined || expected.pointCount === undefined || expected.laneCount !== undefined ||
                    args.objectId !== undefined || args.expectedUniqueId !== undefined ||
                    (insert && (args.pointEventId !== undefined || expected.startSeconds !== undefined || expected.normalizedValue !== undefined)) ||
                    (!insert && (args.pointEventId === undefined || expected.startSeconds === undefined || expected.normalizedValue === undefined)) ||
                    ((args.action === 'insert' || args.action === 'move') !== (args.positionSeconds !== undefined)) ||
                    ((args.action === 'insert' || args.action === 'setValue') !== (args.value !== undefined)))
                    throw new BridgeError('INVALID_ARGUMENT', 'Automation action fields must match insert, setValue, move or delete.');
                Object.assign(payload, { automationAction: args.action, laneEventId: args.laneEventId,
                    parameterTag: args.parameterTag, expectedPointCount: expected.pointCount });
                if (!insert) Object.assign(payload, { pointEventId: args.pointEventId,
                    expectedStartSeconds: expected.startSeconds, expectedNormalizedValue: expected.normalizedValue });
                if (args.action === 'move') payload.value = args.positionSeconds;
                else if (args.value !== undefined) payload.value = args.value;
                if (insert) payload.positionSeconds = args.positionSeconds;
            }
        } else Object.assign(payload, { automationAction: 'read', offset: args.offset, limit: args.limit });
        const project = managedProjectOf(await runLifecycle('status', {}, signal));
        if (write) {
            const transport = await client.request('transport.state', { session: args.session }, signal) as { playing: boolean | null; recording: boolean | null };
            if (transport.playing !== false || transport.recording !== false) throw new BridgeError('TRANSPORT_RUNNING', 'Stop transport before automation edits.');
            if (args.action === 'createLane') {
                const reference = { session: args.session, root: 'mixConsole', objectId: args.objectId };
                const object = await client.request('objects.get', reference, signal) as { object: { uniqueIdString: string } };
                if (object.object.uniqueIdString !== args.expectedUniqueId) throw new BridgeError('OBJECT_CHANGED', 'The automation parameter owner changed.');
                const value = await client.request('parameters.get', { ...reference, tag: args.parameterTag }, signal) as { parameter: { automatable: boolean; locked: boolean } };
                if (!value.parameter.automatable || value.parameter.locked) throw new BridgeError('AUTOMATION_UNAVAILABLE', 'The parameter is locked or not automatable.');
            }
        }
        const idle = await unexpectedWindows(project.name, signal);
        if (!idle.observed || idle.unexpected.length) throw new BridgeError('HOST_WINDOW_OPEN', 'The owned host has an unexpected window.', 'not_started', idle);
        lifecycleBusy = true;
        try {
            const outcome = await runLifecycle('automation', { projectPath: project.projectPath, ...payload }, signal);
            if (write) {
                const windows = await unexpectedWindows(project.name, signal);
                if (!windows.observed || windows.unexpected.length) throw new BridgeError('AUTOMATION_WINDOW', 'A host window appeared during automation editing.', 'unknown', { native: outcome.native, artifacts: outcome.artifacts, windows });
            }
            return { session: args.session, ...(write ? { execution: 'submitted', action: args.action } : {}),
                ...(outcome.model as Record<string, unknown>), native: outcome.native, artifacts: outcome.artifacts };
        } finally { lifecycleBusy = false; }
    }
    compose('cubase_automation_read', 'Read native automation lanes and normalized points belonging to one track from cubase_events_list. Lane rows identify parameterTag and laneEventId (eventId); point rows carry temporary eventId, startSeconds and normalizedValue. The returned paths and IDs are lifetime-bound. Page using nextOffset; rediscover after structural edits or reopen.', {
        ...automationReference, offset: z.number().int().min(0).max(8192).default(0), limit: z.number().int().min(1).max(128).default(64)
    }, true, (args, signal) => automationRequest(args, signal, false));
    compose('cubase_automation_edit', 'Create an automation lane or insert/change/move/delete one point. createLane takes the parameter objectId/expectedUniqueId and expected.laneCount, without lane/point IDs; the parameter must be observed as automatable. Point actions use laneEventId, parameterTag and expected.pointCount from cubase_automation_read. Existing points require pointEventId and exact expected startSeconds/normalizedValue. insert takes positionSeconds/value; setValue takes value; move takes positionSeconds; delete takes neither. Native identity/count checks and readback confirm each change. Requires stopped transport; no replay. Native undo is not certified.', {
        ...automationReference, laneEventId: z.string().regex(/^0x(?!0+$)[0-9a-fA-F]{1,16}$/).optional(), parameterTag: z.number().int().positive().max(2147483647),
        objectId: z.number().int().positive().max(2147483647).optional(), expectedUniqueId: z.string().min(1).max(1024).optional(),
        action: z.enum(['createLane', 'insert', 'setValue', 'move', 'delete']), pointEventId: z.string().regex(/^0x(?!0+$)[0-9a-fA-F]{1,16}$/).optional(),
        expected: z.object({ pointCount: z.number().int().min(0).max(8192).optional(), laneCount: z.number().int().min(0).max(8192).optional(), startSeconds: z.number().finite().min(-86400).max(86400).optional(),
            normalizedValue: z.number().finite().min(0).max(1).optional() }).strict(),
        positionSeconds: z.number().finite().min(0).max(86400).optional(), value: z.number().finite().min(0).max(1).optional(), confirmEdit: z.literal(true)
    }, false, (args, signal) => automationRequest(args, signal, true));

    const routingReference = {
        ...session, root: z.string().regex(/^0x[0-9a-fA-F]{1,16}$/), objectId: z.number().int().positive(),
        expectedUniqueId: z.string().min(1).max(1024), field: z.enum(['input', 'output', 'send']),
        sendIndex: z.number().int().min(0).max(63).optional(), expectedSlotUniqueId: z.string().min(1).max(1024).optional()
    };
    async function routeRequest(args: Record<string, unknown>, signal: AbortSignal | undefined, write: boolean) {
        if ((args.field === 'send') !== (args.sendIndex !== undefined) ||
            (args.field !== 'send' && args.expectedSlotUniqueId !== undefined) ||
            (args.field === 'send' && write && args.expectedSlotUniqueId === undefined))
            throw new BridgeError('INVALID_ARGUMENT', 'Send routing needs sendIndex and, for writes, expectedSlotUniqueId from cubase_routes_list.');
        const project = managedProjectOf(await runLifecycle('status', {}, signal));
        const channel = (await allChannels(args.session, signal)).find(item => item.objectId === args.objectId);
        if (!channel || channel.uniqueIdString !== args.expectedUniqueId) throw new BridgeError('CHANNEL_CHANGED', 'The routing channel identity changed.');
        let target = channel.fields[args.field as string];
        let routingObjectId = args.objectId;
        let sendSlot: { index: number; objectId: number; uniqueIdString: string } | undefined;
        if (args.field === 'send') {
            type RoutingObject = { objectId: number; typeName: string; uniqueIdString: string };
            const children = await client.request('objects.list', { session: args.session, root: 'mixConsole', parentId: args.objectId, offset: 0, limit: 64 }, signal) as { items: RoutingObject[] };
            const sends = children.items.find(item => item.typeName === 'Sends');
            if (!sends) throw new BridgeError('ROUTING_UNSUPPORTED', 'The channel has no observed send container.');
            const slots = await client.request('objects.list', { session: args.session, root: 'mixConsole', parentId: sends.objectId, offset: 0, limit: 64 }, signal) as { items: RoutingObject[] };
            const slot = slots.items[args.sendIndex as number];
            if (!slot || slot.typeName !== 'Slot') throw new BridgeError('ROUTING_UNSUPPORTED', 'The requested send slot is absent.');
            if (write && slot.uniqueIdString !== args.expectedSlotUniqueId) throw new BridgeError('SLOT_CHANGED', 'The send slot identity changed.');
            const parameters = await client.request('parameters.list', { session: args.session, root: 'mixConsole', objectId: slot.objectId, offset: 0, limit: 32 }, signal) as { items: { tag: number; locked: boolean }[] };
            const destination = parameters.items.find(item => item.tag === 4099 && !item.locked);
            if (!destination) throw new BridgeError('ROUTING_UNSUPPORTED', 'The send destination is absent or locked.');
            target = { tag: 4099 } as typeof target;
            routingObjectId = slot.objectId;
            sendSlot = { index: args.sendIndex as number, objectId: slot.objectId, uniqueIdString: slot.uniqueIdString };
        }
        if (!target || ![4099, 4101, 4102].includes(target.tag)) throw new BridgeError('ROUTING_UNSUPPORTED', 'This tool handles native audio-bus routing.');
        if (write) {
            const transport = await client.request('transport.state', { session: args.session }, signal) as { playing: boolean | null; recording: boolean | null };
            if (transport.playing !== false || transport.recording !== false) throw new BridgeError('TRANSPORT_RUNNING', 'Stop transport before routing changes.');
        }
        const idle = await unexpectedWindows(project.name, signal);
        if (!idle.observed || idle.unexpected.length) throw new BridgeError('HOST_WINDOW_OPEN', 'The owned host has an unexpected window.', 'not_started', idle);
        lifecycleBusy = true;
        try {
            const outcome = await runLifecycle('routing', { projectPath: project.projectPath, root: args.root,
                objectId: routingObjectId, tag: target.tag, routeMode: write ? 'set' : 'list',
                ...(write ? { expectedValue: args.expectedValue, targetId: args.targetId, targetName: args.targetName, confirmRouting: true } : {}) }, signal);
            const model = outcome.model as Record<string, unknown>;
            if (!write) return { session: args.session, field: args.field, ...model, ...(sendSlot ? { sendSlot, channelObjectId: args.objectId } : {}), native: outcome.native, artifacts: outcome.artifacts };
            const windows = await unexpectedWindows(project.name, signal);
            if (!windows.observed || windows.unexpected.length) throw new BridgeError('ROUTING_WINDOW', 'A host window appeared during routing.', 'unknown', { native: outcome.native, artifacts: outcome.artifacts, windows });
            const after = await client.request('parameters.get', { session: args.session, root: 'mixConsole', objectId: routingObjectId, tag: target.tag }, signal) as { parameter: { value: number; display: string } };
            return { session: args.session, execution: 'submitted', field: args.field, ...model, ...(sendSlot ? { sendSlot, channelObjectId: args.objectId } : {}),
                confirmed: model.confirmed === true && after.parameter.value === args.targetId, feedback: after.parameter,
                native: outcome.native, artifacts: outcome.artifacts };
        } finally { lifecycleBusy = false; }
    }
    compose('cubase_routes_list', 'List actual audio input/output or send bus targets for a discovered channel, including target IDs, names, hierarchy paths and availability. field=send requires zero-based sendIndex and returns sendSlot identity. Copy root from cubase_events_list and channel identity from cubase_channels_list. IDs are current-project state only.', routingReference, true,
        (args, signal) => routeRequest(args, signal, false));
    compose('cubase_routing_set', 'Connect audio input/output or a send to an enumerated bus. Supply current value and exact target ID/name from cubase_routes_list. field=send also requires sendIndex and expectedSlotUniqueId. Native write is confirmed through independent MIDI feedback. No dialog or replay.', {
        ...routingReference, expectedValue: z.number().int().min(-1).max(2147483647), targetId: z.number().int().min(0).max(9999),
        targetName: z.string().min(1).max(255).refine(value => !/[\u0000-\u001f]/.test(value)), confirmRouting: z.literal(true)
    }, false, (args, signal) => routeRequest(args, signal, true));

    compose('cubase_plugin_unload', 'Unload the plug-in in one discovered occupied slot of the owned project without a discard prompt. Copy projectRoot from cubase_events_list and slot identity plus its single plugin child ID from cubase_objects_list. Requires stopped transport and exact slot/plugin identities. confirmed requires the slot to be empty after the native operation.', {
        ...session, root: z.literal('mixConsole'), projectRoot: z.string().regex(/^0x[0-9a-fA-F]{1,16}$/),
        objectId: z.number().int().min(1).max(2147483647), expectedUniqueId: z.string().min(1).max(1024),
        expectedPluginObjectId: z.number().int().positive(), confirmUnload: z.literal(true)
    }, false, async (args, signal) => {
        const project = managedProjectOf(await runLifecycle('status', {}, signal));
        const transport = await client.request('transport.state', { session: args.session }, signal) as { playing: boolean | null; recording: boolean | null };
        if (transport.playing !== false || transport.recording !== false) throw new BridgeError('TRANSPORT_RUNNING', 'Stop transport before unloading a plug-in.');
        const reference = { session: args.session, root: args.root, objectId: args.objectId };
        const before = await client.request('objects.get', reference, signal) as { object: { uniqueIdString: string; childCount: number } };
        if (before.object.uniqueIdString !== args.expectedUniqueId) throw new BridgeError('SLOT_CHANGED', 'The plugin slot identity changed.');
        const children = await client.request('objects.list', { session: args.session, root: args.root, parentId: args.objectId, offset: 0, limit: 16 }, signal) as { items: { objectId: number }[]; total: number };
        if (children.total !== 1 || children.items[0]?.objectId !== args.expectedPluginObjectId) throw new BridgeError('PLUGIN_CHANGED', 'The occupied plugin slot no longer matches the observed child.');
        const idle = await unexpectedWindows(project.name, signal);
        if (!idle.observed || idle.unexpected.length) throw new BridgeError('HOST_WINDOW_OPEN', 'The owned host has an unexpected window.', 'not_started', idle);
        lifecycleBusy = true;
        try {
            const outcome = await runLifecycle('unload_plugin', { projectPath: project.projectPath, root: args.projectRoot,
                objectId: args.objectId, confirmUnload: true }, signal);
            const windows = await unexpectedWindows(project.name, signal);
            if (!windows.observed || windows.unexpected.length) throw new BridgeError('PLUGIN_UNLOAD_WINDOW', 'A host window appeared during unload.', 'unknown', { native: outcome.native, artifacts: outcome.artifacts, windows });
            const after = await client.request('objects.get', reference, signal) as { object: { uniqueIdString: string; childCount: number } };
            return { session: args.session, execution: 'submitted', confirmed: after.object.uniqueIdString === args.expectedUniqueId && after.object.childCount === 0,
                before: before.object, after: after.object, native: outcome.native, model: outcome.model, artifacts: outcome.artifacts };
        } finally { lifecycleBusy = false; }
    });

    compose('cubase_track_create', 'Create one named empty MIDI, instrument, Group, FX or folder track through the native factory and host insertion transaction. Copy root from cubase_events_list. Requires stopped transport and an owned project. An instrument track starts with an empty instrument slot; discover that slot and use cubase_plugin_set to assign an offered instrument. confirmed checks the native tree and a new named mixer channel, except folders which have no mixer channel. No Add Track window or MIDI import is used.', {
        ...session, root: z.string().regex(/^0x[0-9a-fA-F]{1,16}$/), kind: z.enum(['midi', 'group', 'fx', 'instrument', 'folder']),
        name: z.string().min(1).max(255).refine(value => !/[\u0000-\u001f]/.test(value)), confirmCreate: z.literal(true)
    }, false, async (args, signal) => {
        const project = managedProjectOf(await runLifecycle('status', {}, signal));
        const transport = await client.request('transport.state', { session: args.session }, signal) as { playing: boolean | null; recording: boolean | null };
        if (transport.playing !== false || transport.recording !== false) throw new BridgeError('TRANSPORT_RUNNING', 'Stop transport before creating a track.');
        const beforeWindows = await unexpectedWindows(project.name, signal);
        if (!beforeWindows.observed || beforeWindows.unexpected.length) throw new BridgeError('HOST_WINDOW_OPEN', 'The owned host has an unexpected window.', 'not_started', beforeWindows);
        const before = await allChannels(args.session, signal);
        lifecycleBusy = true;
        try {
            const outcome = await runLifecycle('create_track', { projectPath: project.projectPath, root: args.root,
                kind: args.kind, name: args.name, confirmCreate: true }, signal);
            const windows = await unexpectedWindows(project.name, signal);
            if (!windows.observed || windows.unexpected.length) throw new BridgeError('TRACK_CREATE_WINDOW', 'A host window appeared during track creation.', 'unknown', { native: outcome.native, artifacts: outcome.artifacts, windows });
            const after = await allChannels(args.session, signal);
            const added = after.filter(channel => !before.some(previous => previous.uniqueIdString === channel.uniqueIdString));
            const model = outcome.model as { added?: { track?: boolean; name?: string; type?: string }[] };
            const expectedType = args.kind === 'instrument' ? 'MInstrumentTrackEvent' : args.kind === 'folder' ? 'MFolderTrack' : null;
            const treeConfirmed = model.added?.some(item => item.track === true && item.name === args.name && (!expectedType || item.type === expectedType)) === true;
            const matched = added.filter(channel => channel.title === args.name && (args.kind === 'instrument' || channel.typeName.toLowerCase() === `${args.kind}channel`));
            const mixerConfirmed = args.kind === 'folder' ? null : matched.length === 1;
            return { session: args.session, execution: 'submitted', confirmed: treeConfirmed && (mixerConfirmed === null ? added.length === 0 : mixerConfirmed), treeConfirmed, mixerConfirmed,
                kind: args.kind, name: args.name, channels: { before: before.length, after: after.length, added: added.map(brief) },
                model: outcome.model, native: outcome.native, artifacts: outcome.artifacts };
        } finally { lifecycleBusy = false; }
    });

    compose('cubase_event_edit', 'Move or trim one existing audio event or MIDI part in place through IProjectObject/MEditContext, without selection commands or reimport. Copy root, path and expected type/name/startSeconds/durationSeconds from cubase_events_list. The native side re-enumerates and rejects any mismatch or locked/track target. field=position sets absolute project seconds; field=duration sets seconds (audio is trimmed, not stretched beyond its current length). Returns before/after from host getters and confirmed; the source file is untouched. Native undo integration is not certified. Stop transport first; never repeated automatically.', {
        ...session, root: z.string().regex(/^0x[0-9a-fA-F]{1,16}$/), path: z.array(z.number().int().min(0).max(8191)).min(2).max(8),
        expected: z.object({ type: z.enum(['MAudioEvent', 'MAudioPartEvent', 'MMidiPartEvent']), name: z.string().max(255).refine(value => !value.includes('\0')),
            startSeconds: z.number().finite().min(-86400).max(86400), durationSeconds: z.number().finite().min(0).max(86400) }).strict(),
        field: z.enum(['position', 'duration']), seconds: z.number().finite().min(0).max(86400), confirmEdit: z.literal(true)
    }, false, async (args, signal) => {
        if (args.field === 'duration' && args.seconds === 0) throw new BridgeError('INVALID_ARGUMENT', 'Duration must be positive.');
        const project = managedProjectOf(await runLifecycle('status', {}, signal));
        const transport = await client.request('transport.state', { session: args.session }, signal) as { playing: boolean | null; recording: boolean | null };
        if (transport.playing !== false || transport.recording !== false) throw new BridgeError('TRANSPORT_RUNNING', 'Stop the transport before event editing.');
        const idle = await unexpectedWindows(project.name, signal);
        if (!idle.observed || idle.unexpected.length) throw new BridgeError('HOST_WINDOW_OPEN', 'A clean owned host is required before event editing.', 'not_started', idle);
        lifecycleBusy = true;
        try {
            const outcome = await runLifecycle('edit_event', { projectPath: project.projectPath, root: args.root, path: args.path,
                expected: args.expected, field: args.field, seconds: args.seconds, confirmEdit: true }, signal);
            return { session: args.session, execution: 'submitted', ...(outcome.model as Record<string, unknown>), native: outcome.native, artifacts: outcome.artifacts };
        } finally { lifecycleBusy = false; }
    });

    compose('cubase_midi_note_edit', 'Edit one existing MIDI note in place, without selection, reimport or commands. Copy root, path, eventId and all expected fields from cubase_events_list. Sets one field per call: pitch 0..127, velocity 1..127, position in seconds or positive duration in seconds. Requires stopped transport and an unlocked note/parent. Returns actual before/after and confirmed. Does not create notes, alter routing or add instruments. Undo integration is not certified; never replay an unconfirmed mutation.', {
        ...session, root: z.string().regex(/^0x[0-9a-fA-F]{1,16}$/), eventId: z.string().regex(/^0x[0-9a-fA-F]{1,16}$/).refine(value => !/^0x0+$/.test(value)),
        path: z.array(z.number().int().min(0).max(8191)).min(3).max(8),
        expected: z.object({ name: z.string().max(255).refine(value => !value.includes('\0')), pitch: z.number().int().min(0).max(127),
            velocity: z.number().int().min(0).max(127), channel: z.number().int().min(0).max(15), velocityNormalized: z.number().finite().min(0).max(1),
            startSeconds: z.number().finite().min(-86400).max(86400), durationSeconds: z.number().finite().min(0).max(86400) }).strict(),
        field: z.enum(['pitch', 'velocity', 'position', 'duration']), value: z.number().finite().min(0).max(86400), confirmEdit: z.literal(true)
    }, false, async (args, signal) => {
        const value = args.value as number;
        const expected = args.expected as Record<string, unknown>;
        if (((args.field === 'pitch' || args.field === 'velocity') && (!Number.isInteger(value) || value > 127)) ||
            ((args.field === 'velocity' || args.field === 'duration') && value === 0)) {
            throw new BridgeError('INVALID_ARGUMENT', 'Pitch must be 0..127, velocity 1..127 and duration positive.');
        }
        const project = managedProjectOf(await runLifecycle('status', {}, signal));
        const transport = await client.request('transport.state', { session: args.session }, signal) as { playing: boolean | null; recording: boolean | null };
        if (transport.playing !== false || transport.recording !== false) throw new BridgeError('TRANSPORT_RUNNING', 'Stop the transport before note editing.');
        const idle = await unexpectedWindows(project.name, signal);
        if (!idle.observed || idle.unexpected.length) throw new BridgeError('HOST_WINDOW_OPEN', 'A clean owned host is required before note editing.', 'not_started', idle);
        lifecycleBusy = true;
        try {
            const outcome = await runLifecycle('edit_event', { projectPath: project.projectPath, root: args.root, path: args.path, eventId: args.eventId,
                expected: { ...expected, type: 'MMidiNote' }, field: args.field, seconds: value, confirmEdit: true }, signal);
            return { session: args.session, execution: 'submitted', ...(outcome.model as Record<string, unknown>), native: outcome.native, artifacts: outcome.artifacts };
        } finally { lifecycleBusy = false; }
    });

    compose('cubase_audio_import', 'Import a local WAV, AIFF or FLAC file into the owned project through native pool/arranger operations, without opening a chooser or running a key command. The original file is preserved and a unique copy is placed in the project Audio folder. Cubase plays a file whose sample rate differs from the project rate without conversion (a 48 kHz file in a 44.1 kHz project runs 8.1 % slow and flat), so the project rate is read from the saved .cpr and compared first: sampleRateMismatch "convert" (default) writes a converted 32-bit float WAV copy and imports that (WAV sources only), "reject" refuses the import, "ignore" imports the file as it is. The result reports projectSampleRate and the conversion. position optionally sets the project cursor through the transport API; otherwise the current cursor is used. trackName optionally renames the single added audio channel. Returns source metadata, native receipt and actual added channels; no automatic replay.', {
        ...session, audioPath: z.string().min(5).max(500), position: z.string().min(1).max(64).optional(),
        trackName: z.string().min(1).max(100).optional(), confirmImport: z.literal(true),
        sampleRateMismatch: z.enum(['convert', 'reject', 'ignore']).default('convert')
    }, false, async (args, signal) => {
        const source = args.audioPath as string;
        if (!isAbsolute(source) || !['.wav', '.aif', '.aiff', '.flac'].includes(extname(source).toLowerCase())) {
            throw new BridgeError('INVALID_ARGUMENT', 'audioPath must be an absolute WAV, AIFF or FLAC path.');
        }
        const info = await lstat(source);
        if (!info.isFile() || info.isSymbolicLink() || info.size <= 44 || info.size > 512 * 1024 * 1024) {
            throw new BridgeError('AUDIO_SOURCE_INVALID', 'The source must be a regular audio file up to 512 MiB.');
        }
        const audio = await inspectAudio(source);
        if (!audio.supported || !audio.frames) throw new BridgeError('AUDIO_FORMAT_UNSUPPORTED', 'The source has no supported, complete audio format.', 'not_started', audio);
        const project = managedProjectOf(await runLifecycle('status', {}, signal));
        // The host does not convert on this import path: a file at another rate than the project plays at the wrong speed.
        const projectRate = await readProjectSampleRate(project.projectPath);
        const sourceRate = Math.round(audio.sampleRate ?? 0), policy = args.sampleRateMismatch as 'convert' | 'reject' | 'ignore';
        // An unknown rate on either side is not a match (session 39 review): without "ignore" nothing is imported.
        if ((!projectRate || sourceRate <= 0) && policy !== 'ignore') {
            throw new BridgeError('AUDIO_SAMPLE_RATE_UNKNOWN', `The ${!projectRate ? 'project' : 'source'} sample rate could not be read, so a wrong playback speed cannot be ruled out. ` +
                (!projectRate ? 'The project rate is read from the saved .cpr: save the project first. ' : '') + 'Pass sampleRateMismatch "ignore" to import the file as it is.',
            'not_started', { sourceSampleRate: sourceRate || null, projectSampleRate: projectRate?.sampleRate ?? null, projectPath: project.projectPath });
        }
        const mismatch = !!projectRate && sourceRate > 0 && sourceRate !== projectRate.sampleRate;
        if (mismatch && policy !== 'ignore' && (policy === 'reject' || audio.format !== 'wav')) {
            throw new BridgeError('AUDIO_SAMPLE_RATE_MISMATCH', `The source is ${sourceRate} Hz, the project runs at ${projectRate!.sampleRate} Hz; Cubase would play it ` +
                `${(100 * (1 - projectRate!.sampleRate / sourceRate)).toFixed(1)} % ${sourceRate > projectRate!.sampleRate ? 'slow' : 'fast'}. ` +
                (policy === 'reject' ? 'Convert the file to the project rate first.' : 'Only WAV sources are converted here; convert this file to the project rate first.'),
            'not_started', { sourceSampleRate: sourceRate, projectSampleRate: projectRate!.sampleRate, format: audio.format });
        }
        const transport = await client.request('transport.state', { session: args.session }, signal) as { playing: boolean | null; recording: boolean | null };
        if (transport.playing !== false || transport.recording !== false) throw new BridgeError('TRANSPORT_RUNNING', 'Stop the transport before importing audio.');
        const idle = await unexpectedWindows(project.name, signal);
        if (!idle.observed || idle.unexpected.length) throw new BridgeError('HOST_WINDOW_OPEN', 'A clean owned host is required before audio import.', 'not_started', idle);
        const before = await allChannels(args.session, signal);
        const directory = join(project.directory, 'Audio');
        await mkdir(directory, { recursive: true });
        if ((await lstat(directory)).isSymbolicLink()) throw new BridgeError('AUDIO_DIRECTORY_INVALID', 'The project Audio directory is a link.');
        const convert = mismatch && policy === 'convert';
        const importedPath = join(directory, `${basename(source, extname(source))}-${randomBytes(5).toString('hex')}${convert ? `-${projectRate!.sampleRate}Hz.wav` : extname(source)}`);
        let conversion: Record<string, unknown> | null = null;
        if (convert) {
            try { conversion = { ...await resampleWavFile(source, importedPath, projectRate!.sampleRate), method: 'polyphase windowed sinc, written as 32-bit float' }; }
            catch (error) {
                await rm(importedPath, { force: true }).catch(() => undefined);      // a partly written copy must not stay in the Audio folder
                throw new BridgeError('AUDIO_CONVERSION_FAILED', `The source could not be converted to the project rate: ${error instanceof Error ? error.message : String(error)}`,
                    'not_started', { sourceSampleRate: sourceRate, projectSampleRate: projectRate!.sampleRate });
            }
        } else await copyFile(source, importedPath, constants.COPYFILE_EXCL);
        if (args.position !== undefined) {
            try { await client.request('transport.time', { session: args.session, display: 'primary', locator: 'cursor', time: args.position }, signal); }
            catch (error) {
                // nothing has been handed to the host yet: the copy made for this request is taken back
                await rm(importedPath, { force: true }).catch(() => undefined);
                throw error;
            }
        }
        let outcome: Record<string, unknown>;
        lifecycleBusy = true;
        try { outcome = await runLifecycle('import_audio', { audioPath: importedPath, confirmImport: true }, signal); }
        finally { lifecycleBusy = false; }
        const host = await readStatus(signal);
        verifyBridge(host, host.session);
        const after = await allChannels(host.session, signal);
        const added = after.filter(channel => !before.some(previous => previous.uniqueIdString === channel.uniqueIdString));
        const audioChannels = added.filter(channel => channel.typeName === 'AudioChannel');
        const windows = await unexpectedWindows(project.name, signal);
        if (!audioChannels.length || !windows.observed || windows.unexpected.length) {
            // Cubase AI holds 32 audio tracks (found in a production: the 33rd import returned success, importedPath was written, and no channel
            // appeared). A clean window state with nothing added while the project is at that count says so instead of the generic code.
            const audioBefore = before.filter(channel => channel.typeName === 'AudioChannel').length;
            const atLimit = !audioChannels.length && windows.observed && !windows.unexpected.length && audioBefore >= AUDIO_TRACK_LIMIT;
            throw new BridgeError(atLimit ? 'AUDIO_TRACK_LIMIT_SUSPECTED' : 'AUDIO_IMPORT_NOT_OBSERVED',
                atLimit ? `The project already has ${audioBefore} audio channels and the import added none: Cubase AI allows ${AUDIO_TRACK_LIMIT} audio tracks. Remove (cubase_track_edit remove) or reuse a track and import again; the converted file ${importedPath} stays in the project Audio folder.`
                    : 'The native import returned, but the added audio channel and clean window state were not both observed.',
                'submitted', { importedPath, native: outcome.native, added: added.map(brief), audioChannelsBefore: audioBefore, windows });
        }
        let renamed: unknown;
        if (args.trackName !== undefined) {
            if (audioChannels.length !== 1) throw new BridgeError('AUDIO_TRACK_AMBIGUOUS', 'Import added multiple audio channels; no channel was renamed.', 'submitted', { added: added.map(brief) });
            renamed = await client.request('channels.set', { session: host.session, objectId: audioChannels[0].objectId,
                expectedUniqueId: audioChannels[0].uniqueIdString, field: 'name', value: args.trackName }, signal);
        }
        const sampleRate = { source: sourceRate || null, project: projectRate?.sampleRate ?? null,
            check: !projectRate ? 'project_rate_unknown' : !mismatch ? 'match' : convert ? 'converted' : 'imported_at_wrong_speed', conversion };
        return { session: host.session, source: { path: source, importedPath, audio }, sampleRate, native: outcome.native,
            channels: { added: added.map(brief) }, renamed, windows: { unexpected: windows.unexpected }, artifacts: outcome.artifacts };
    });

    compose('cubase_midi_read', 'Read the MIDI content of the managed project back from Cubase: the host writes its own Standard MIDI File into the project folder once (key command "Write MIDI File to Project Folder") and this tool parses that file. Returns tempo, time signature, one summary per MIDI track (name, channels, programs, note count, pitch range) and a page of notes in quarter-note beats. Muted and solo-muted tracks and tracks without events are not written by Cubase; muted MIDI channels are listed in mutedChannels. Use track, noteOffset and noteLimit to page; includeControllers adds controller and pitch-bend events.', {
        ...session, track: z.number().int().min(0).max(255).optional(), noteOffset: z.number().int().min(0).default(0),
        noteLimit: z.number().int().min(0).max(2000).default(400), includeControllers: z.boolean().default(false),
        timeoutMs: z.number().int().min(500).max(30000).default(6000)
    }, false, async (args, signal) => {
        const project = managedProjectOf(await runLifecycle('status', {}, signal));
        const channels = await allChannels(args.session, signal);
        const before = await listMidiFiles(project.directory);
        const command = await runCommand(args.session, 'midi.writeFileToProjectFolder', signal);
        if (!command.performed) throw new BridgeError('COMMAND_UNAVAILABLE', 'Cubase cannot write the MIDI file in the current context.', 'not_started', { command });
        const written = await awaitWrittenMidiFile(project.directory, before, args.timeoutMs as number, signal);
        const muted = channels.filter(channel => channel.typeName === 'MidiChannel' && on(channel, 'mute')).map(brief);
        if (!written) {
            throw new BridgeError('MIDI_FILE_NOT_OBSERVED', 'The write command was submitted, but no new or changed .mid file appeared in the project folder. Cubase writes nothing when no unmuted MIDI track has events.',
                'submitted', { command, projectDirectory: project.directory, midiChannels: channels.filter(channel => channel.typeName === 'MidiChannel').map(brief), mutedChannels: muted });
        }
        let model: Record<string, unknown>;
        try {
            model = describeMidi(parseSmf(written.bytes), { track: args.track as number | undefined, noteOffset: args.noteOffset as number,
                noteLimit: args.noteLimit as number, includeControllers: args.includeControllers as boolean });
        } catch (error) {
            throw new BridgeError(error instanceof SmfError ? error.code : 'MIDI_PARSE_FAILED', error instanceof Error ? error.message : String(error), 'submitted', { path: written.path });
        }
        return { file: { path: written.path, bytes: written.bytes.length, modified: new Date(written.mtimeMs).toISOString() }, command, mutedChannels: muted, ...model };
    });

    compose('cubase_audio_export', 'Render the managed project through the native NonUI audio exporter, without opening a file/export dialog or executing a key command. outputPath selects a new absolute file; existing files are preserved. format is wav, aiff or flac (inferred from an explicit path, otherwise wav); sampleRate defaults to 48000, bitDepth to 24, floatingPoint to false. 32-bit float is supported for WAV/AIFF; FLAC takes 16/24-bit integer samples. range sets the two locators through the transport API, or omit it to use the current range. Stop the transport first. Returns the actual file metadata and, for WAV, audio levels. Requested settings must match the emitted header. No automatic replay.', {
        ...session, range: z.object({ left: z.string().min(1).max(64), right: z.string().min(1).max(64) }).strict().optional(),
        outputPath: z.string().min(5).max(500).optional(), format: z.enum(['wav', 'aiff', 'flac']).optional(),
        sampleRate: z.number().int().refine(value => [8000, 11025, 16000, 22050, 32000, 44100, 48000, 88200, 96000, 176400, 192000].includes(value)).default(48000),
        bitDepth: z.union([z.literal(16), z.literal(24), z.literal(32)]).default(24), floatingPoint: z.boolean().default(false),
        confirmExport: z.literal(true), timeoutMs: z.number().int().min(5000).max(600000).default(180000)
    }, false, async (args, signal) => {
        const project = managedProjectOf(await runLifecycle('status', {}, signal));
        const extensions: Record<string, string> = { '.wav': 'wav', '.aif': 'aiff', '.aiff': 'aiff', '.flac': 'flac' };
        const extensionFormat = args.outputPath ? extensions[extname(args.outputPath as string).toLowerCase()] : undefined;
        const format = String(args.format ?? extensionFormat ?? 'wav');
        if (args.outputPath && (!isAbsolute(args.outputPath as string) || extensionFormat !== format)) {
            throw new BridgeError('INVALID_ARGUMENT', 'outputPath must be absolute and its extension must match the selected format.');
        }
        if ((args.floatingPoint && args.bitDepth !== 32) || (format === 'flac' && (args.floatingPoint || args.bitDepth === 32))) {
            throw new BridgeError('INVALID_ARGUMENT', 'Float requires 32 bits; FLAC requires 16- or 24-bit integer samples.');
        }
        const outputPath = args.outputPath ? resolve(args.outputPath as string)
            : join(project.directory, 'Mixdown', `${project.name}-${Date.now()}-${randomBytes(4).toString('hex')}.${format}`);
        try {
            await lstat(outputPath);
            throw new BridgeError('EXPORT_DESTINATION_EXISTS', 'The export destination exists; choose a new path.');
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        type Transport = { playing: boolean | null; recording: boolean | null; cycleLeft: string | null; cycleRight: string | null; cycleDuration: string | null };
        let transport = await client.request('transport.state', { session: args.session }, signal) as Transport;
        if (transport.playing !== false || transport.recording !== false) throw new BridgeError('TRANSPORT_RUNNING', 'A stopped transport must be observed before exporting.');
        const idle = await unexpectedWindows(project.name, signal);
        if (!idle.observed) throw new BridgeError('WINDOW_INVENTORY_FAILED', 'The windows of the owned instance could not be read; the export was not started.', 'not_started', idle);
        if (idle.unexpected.length) {
            throw new BridgeError('HOST_WINDOW_OPEN', 'A host window is already open on the private desktop; the export was not started. Replace the owned instance first.', 'not_started', { unexpected: idle.unexpected });
        }
        const range = args.range as { left: string; right: string } | undefined;
        if (range) {
            await client.request('transport.time', { session: args.session, display: 'primary', locator: 'cycleLeft', time: range.left }, signal);
            await client.request('transport.time', { session: args.session, display: 'primary', locator: 'cycleRight', time: range.right }, signal);
            await pause(300);
            transport = await client.request('transport.state', { session: args.session }, signal) as Transport;
        }
        // An empty range makes the host show an alert instead of exporting.
        if (!transport.cycleDuration || !/[1-9]/.test(transport.cycleDuration)) {
            throw new BridgeError('EXPORT_RANGE_EMPTY', 'The range between the left and right locators is empty; set range or the locators first.', range ? 'submitted' : 'not_started',
                { cycleLeft: transport.cycleLeft, cycleRight: transport.cycleRight, cycleDuration: transport.cycleDuration });
        }
        const exportStarted = Date.now();
        let outcome: Record<string, unknown>;
        lifecycleBusy = true;
        try {
            outcome = await runLifecycle('export_audio', { outputPath, sampleRate: args.sampleRate, bitDepth: args.bitDepth,
                floatingPoint: args.floatingPoint, confirmExport: true, timeoutMs: args.timeoutMs }, signal);
        } finally { lifecycleBusy = false; }
        let audio;
        try { audio = await inspectAudio(outputPath); }
        catch (error) { throw new BridgeError('EXPORT_FILE_NOT_OBSERVED', 'The native exporter returned, but its file metadata could not be read.', 'submitted', { outputPath, native: outcome.native, reason: String(error) }); }
        if (!audio.supported || audio.format !== format || audio.sampleRate !== args.sampleRate ||
            audio.bitsPerSample !== args.bitDepth || audio.float !== args.floatingPoint || !audio.frames) {
            throw new BridgeError('EXPORT_SETTINGS_NOT_OBSERVED', 'The emitted audio does not match the requested format; the file is retained and no second export is attempted.',
                'submitted', { outputPath, audio, requested: { format, sampleRate: args.sampleRate, bitDepth: args.bitDepth, floatingPoint: args.floatingPoint }, native: outcome.native });
        }
        const windows = await unexpectedWindows(project.name, signal);
        if (!windows.observed || windows.unexpected.length) throw new BridgeError('EXPORT_WINDOW_STATE_UNKNOWN', 'The output file exists, but a clean host window state was not observed.', 'submitted', { outputPath, windows });
        return { execution: 'completed', file: { path: outputPath, bytes: audio.bytes, renamed: false, writtenAs: outputPath }, audio,
            range: { left: transport.cycleLeft, right: transport.cycleRight, duration: transport.cycleDuration },
            native: outcome.native, artifacts: outcome.artifacts,
            elapsedMs: Date.now() - exportStarted, windows: { unexpected: windows.unexpected } };
    });

    server.registerTool('cubase_runtime_windows', {
        description: 'Read-only sample of the visible windows of the owned Cubase process on its private desktop. unexpected lists every window that is neither the project window nor the Hub; such a window is usually a prompt opened by the host. This server never operates, focuses or closes a window: when a prompt blocks work, replace the owned instance with cubase_project_open or cubase_project_create (replaceCurrent).',
        inputSchema: z.object({}).strict(), annotations: { readOnlyHint: true, openWorldHint: false }
    }, async (_args, context) => {
        try {
            const project = await runLifecycle('status', {}, context.mcpReq.signal).then(managedProjectOf).catch(() => null);
            const sample = await readOwnedWindows(context.mcpReq.signal);
            const expected = (title: string) => / Hub$/.test(title) || (project !== null && title.endsWith(` - ${project.name}`));
            return result({ pid: sample.pid, sampledUtc: sample.sampledUtc, project: project ? project.projectPath : null,
                windows: sample.windows, unexpected: sample.windows.filter(item => !expected(item.title)),
                limitation: 'One sample; a window that opened and closed between samples is not observed.' });
        } catch (error) { return failure(error); }
    });

    server.registerTool('cubase_project_save', {
        description: 'Submit current-project Save exactly once through MIDI and observe changed, stable bytes at a caller-confirmed existing CPR path (12 bytes to 64 MiB, no links). This does not select a path or perform save-as. file.state=changed_stable is observed content change, not semantic reopen or an atomic document/flush guarantee. Use save.session as the new session. An unchanged file is change_not_observed, never claimed saved.',
        inputSchema: z.object({ ...session, projectPath: z.string().min(1).max(1024),
            confirmCurrentProjectPath: z.literal(true), observationTimeoutMs: z.number().int().min(500).max(30000).default(5000) }).strict(),
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
    }, async (args, context) => {
        try {
            if (lifecycleBusy) throw new BridgeError('LIFECYCLE_BUSY', 'An owned runtime transition is active.');
            verifyBridge(await readStatus(context.mcpReq.signal), args.session);
            return result(await saveProjectObserved(args.projectPath, args.observationTimeoutMs,
                () => client.executeSave({ session: args.session, key: 'project.save', confirmCurrentSelection: true }, context.mcpReq.signal),
                context.mcpReq.signal));
        } catch (error) { return failure(error); }
    });

    server.registerTool('cubase_runtime_status', {
        description: 'Inspect the owned private-desktop Cubase process, its lifetime and restricted Job, without starting Cubase or requiring a MIDI handshake. A user-owned or mismatched process is not adopted.',
        inputSchema: z.object({}).strict(), annotations: { readOnlyHint: true, openWorldHint: false }
    }, async (_args, context) => {
        try { return result(await runLifecycle('status', {}, context.mcpReq.signal)); }
        catch (error) { return failure(error); }
    });

    function projectTool<Shape extends z.ZodRawShape>(name: string, action: 'create' | 'open' | 'save_as', description: string, shape: Shape) {
        server.registerTool(name, {
            description, inputSchema: z.object(shape).strict(),
            annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
        }, async (args, context) => {
            let ownedTransition = false, outcome: Record<string, unknown> | undefined;
            try {
                if (lifecycleBusy) throw new BridgeError('LIFECYCLE_BUSY', 'An owned runtime transition is active.');
                const requestArgs = args as Record<string, unknown>;
                if (action === 'save_as') verifyBridge(await readStatus(context.mcpReq.signal), requestArgs.session);
                client.prepareLifecycle(); lifecycleBusy = true; ownedTransition = true;
                outcome = await runLifecycle(action, requestArgs, context.mcpReq.signal);
                client = new MidiClient(config.midi);
                const host = await readStatus(context.mcpReq.signal);
                verifyBridge(host, host.session);
                return result({ lifecycle: outcome, host });
            } catch (error) {
                if (outcome) return failure(new BridgeError('PROJECT_HOST_HANDSHAKE_UNKNOWN', 'The native lifecycle returned; the MIDI handshake did not complete.', 'unknown', { lifecycle: outcome, error: String(error) }));
                return failure(error);
            } finally {
                if (ownedTransition) { if (!outcome) client = new MidiClient(config.midi); lifecycleBusy = false; }
            }
        });
    }
    const replacement = { replaceCurrent: z.boolean().default(false), confirmDiscardChanges: z.boolean().default(false) };
    projectTool('cubase_project_create', 'create',
        'Create a blank project at a new absolute local .cpr path in an owned private-desktop host, perform its first native store and return one MIDI handshake. Before native admission, an observed license-startup stall automatically restarts the owned empty host and license helper once. Replacing an existing owned host requires both flags true and discards unsaved changes. Unowned hosts are preserved; submitted operations are never replayed.',
        { projectPath: z.string().min(5).max(500), ...replacement });
    projectTool('cubase_project_open', 'open',
        'Open an existing local CPR in a fresh owned private-desktop host, wait for mapping readiness and return one MIDI handshake. Before native admission, an observed license-startup stall automatically restarts the owned empty host and license helper once. Replacing an owned host requires both flags true and discards unsaved changes. The native path must match. No dialog is operated or submitted operation replayed.',
        { projectPath: z.string().min(5).max(500), ...replacement });
    projectTool('cubase_project_save_as', 'save_as',
        'Store the managed current project at a new local .cpr path using the native event-thread method. Requires current MIDI session and matching managed document path. Does not overwrite a destination or operate a dialog. The returned new path is checked against the host document; this is not semantic reopen verification.',
        { ...session, projectPath: z.string().min(5).max(500), confirmSaveAs: z.literal(true) });

    server.registerTool('cubase_runtime_stop', {
        description: 'End only the lifetime-matched owned private-desktop Cubase and its holder. Explicitly discards unsaved changes; does not save or replay a command. Other Cubase processes are preserved.',
        inputSchema: z.object({ confirmDiscardChanges: z.literal(true) }).strict(),
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
    }, async (args, context) => {
        let ownedTransition = false;
        try {
            if (lifecycleBusy) throw new BridgeError('LIFECYCLE_BUSY', 'An owned runtime transition is active.');
            client.prepareLifecycle(); lifecycleBusy = true; ownedTransition = true;
            return result(await runLifecycle('stop', args, context.mcpReq.signal));
        } catch (error) { return failure(error); }
        finally { if (ownedTransition) { client = new MidiClient(config.midi); lifecycleBusy = false; } }
    });

    server.registerTool('cubase_ports', {
        description: 'Enumerate real Windows MIDI ports without opening a connection. Missing configured ports are not replaced with another device.',
        inputSchema: z.object({}).strict(),
        annotations: { readOnlyHint: true, openWorldHint: false }
    }, async () => {
        try { return result({ configured: config.midi, available: MidiClient.ports() }); }
        catch (error) { return failure(error); }
    });

    server.registerTool('cubase_capabilities', {
        description: 'Return the implementation constraints together with an explicit live-host observation. The constraint list is always available, so discovery does not require a running DAW: host is null and hostState names an absent, silent or incompatible bridge instead of returning a transport timeout. A live host is read with a 2000 ms read-only handshake (cubase_status keeps the full configured budget). Never returns mock host data.',
        inputSchema: z.object({}).strict(),
        annotations: { readOnlyHint: true, openWorldHint: false }
    }, async (_args, context) => {
        try {
            if (lifecycleBusy) throw new BridgeError('LIFECYCLE_BUSY', 'An owned runtime transition is active.');
            const runtime = await ownedRuntime(context.mcpReq.signal);
            let host: Record<string, unknown> | null = null;
            let hostState: Record<string, unknown>;
            try {
                host = await readStatus(context.mcpReq.signal, CAPABILITY_HANDSHAKE_MS);
                hostState = { observed: true, compatible: true, readOnly: true, timeoutMs: CAPABILITY_HANDSHAKE_MS };
            } catch (error) {
                const probeError = error instanceof BridgeError ? error
                    : new BridgeError('CAPABILITY_PROBE_FAILED', error instanceof Error ? error.message : String(error), 'not_started');
                hostState = { observed: probeError.code === 'HOST_VERSION_MISMATCH', compatible: false, readOnly: true,
                    timeoutMs: CAPABILITY_HANDSHAKE_MS, code: probeError.code, message: probeError.message,
                    nextAction: runtime.running === true
                        ? 'The owned host is running but its MIDI Remote mapping did not answer. Use cubase_status for the full configured handshake; replace the instance explicitly if it stays silent.'
                        : 'No owned Cubase host is running. Start one with cubase_project_create or cubase_project_open. Nothing was retried.' };
                // readStatus closes a wrong-version host; a faulted, closed or discarded client cannot be reused.
                if (!client.usable) client = new MidiClient(config.midi);
            }
            return result({ constraints, runtime, host, hostState });
        }
        catch (error) { return failure(error); }
    });

    server.registerTool('cubase_connection_reset', {
        description: 'Explicitly close a failed connection and perform one new handshake. Does not replay any previous operation. Review uncertain mutation outcomes first.',
        inputSchema: z.object({ confirmNoReplay: z.literal(true) }).strict(),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    }, async (_args, context) => {
        if (lifecycleBusy) return failure(new BridgeError('LIFECYCLE_BUSY', 'An owned runtime transition is active.'));
        client.close();
        client = new MidiClient(config.midi);
        try { return result(await readStatus(context.mcpReq.signal)); }
        catch (error) { return failure(error); }
    });

    server.registerResource('constraints', 'cubase://constraints', {
        description: 'Static contract and unsupported operations. Not a statement of live host connectivity.', mimeType: 'application/json'
    }, async uri => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(constraints, null, 2) }] }));

    return { server, close: () => client.close() };
}

async function main() {
    const runtime = createServer();
    const stop = () => { runtime.close(); void runtime.server.close(); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    await runtime.server.connect(new StdioServerTransport());
}

if (require.main === module) {
    void main().catch(error => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
