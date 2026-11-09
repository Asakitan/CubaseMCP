#!/usr/bin/env node
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { loadConfig, type Configuration } from './config.js';
import { BridgeError, MidiClient } from './midi.js';
import { inspectBridge, verifyBridge } from './bridge-contract.js';

export const constraints = {
    backend: 'midi',
    backgroundOnly: true,
    fallback: false,
    automaticRetry: false,
    fullCubaseCoverage: false,
    editionVerification: 'AI feature availability requires a live licensed host; version is checked at handshake.',
    unsupported: [
        'Arbitrary project create/open/save-as with paths',
        'Arbitrary audio or MIDI event/note creation and editing',
        'Arbitrary track creation, deletion and reordering',
        'Parameterized audio export, stems and offline rendering',
        'Plugin GUI, preset file dialogs and arbitrary menu commands',
        'Any feature absent from the active Cubase AI license or MIDI Remote API'
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

export function createServer(config: Configuration = loadConfig()) {
    let client = new MidiClient(config.midi);
    const server = new McpServer({ name: 'cubase-ai16-mcp', version: '0.1.0' }, {
        instructions: 'Use cubase_status before mutations. Copy the current session, root, object IDs and parameter tags from live discovery. Never infer IDs from a previous session. This server has one background MIDI backend and no fallback. A submitted or timed-out operation is not proof of completion; do not retry it automatically. Read cubase://constraints before planning unsupported work.'
    });
    const session = { session: z.string().min(1).max(200) };
    const root = z.enum(['trackSelection', 'mixConsole', 'transport', 'focusedQuickControls']);
    const reference = { ...session, root, objectId: z.number().int().nonnegative() };
    const pagination = { offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(64).default(32) };

    async function readStatus(signal?: AbortSignal) {
        const status = await client.request('bridge.status', {}, signal) as Record<string, unknown>;
        const compatibility = inspectBridge(status);
        if (!compatibility.hostVersionMatches) {
            client.close();
            throw new BridgeError('HOST_VERSION_MISMATCH', 'Only a live Cubase 16 host is accepted.', 'not_started');
        }
        return { ...status, serverCompatibility: compatibility };
    }

    function expose<Shape extends z.ZodRawShape>(name: string, operation: string, description: string, shape: Shape, readOnly = true) {
        server.registerTool(name, {
            description,
            inputSchema: z.object(shape).strict(),
            annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: readOnly, openWorldHint: false }
        }, async (args, context) => {
            try {
                const requestArgs = args as Record<string, unknown>;
                if (operation === 'bridge.status') return result(await readStatus(context.mcpReq.signal));
                verifyBridge(await readStatus(context.mcpReq.signal), requestArgs.session);
                const data = await client.request(operation, requestArgs, context.mcpReq.signal);
                return result(data);
            } catch (error) {
                return failure(error);
            }
        });
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
    expose('cubase_plugin_set', 'plugins.set', 'Assign a plugin UID discovered for this slot. Suppresses the discard dialog; existing plugin state can be replaced. Requires explicit confirmation.', {
        ...reference, pluginUid: z.string().min(1).max(512), confirmReplacement: z.literal(true)
    }, false);
    expose('cubase_controls_list', 'controls.list', 'Page declared controls and groups independently. Follow nextOffset and nextGroupOffset until null; unknown values remain unknown until host feedback arrives.', {
        ...session, offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(16).default(16),
        groupOffset: z.number().int().nonnegative().default(0), groupLimit: z.number().int().min(1).max(16).default(16)
    });
    expose('cubase_control_get', 'controls.get', 'Read one declared control, its availability, read-only status and last host feedback.', {
        ...session, key: z.string().min(1).max(100)
    });
    expose('cubase_control_set', 'controls.set', 'Set one declared background control by key; value is normalized 0..1. Bank channel writes require a previously observed expectedChannelUniqueId. Plug-in bank and insert-viewer writes require the exact pluginIdentity from cubase_control_get and the current channel identity. Optionally guard a track control using both its unique and runtime IDs. Buttons may be momentary. Does not open or focus a window.', {
        ...session, key: z.string().min(1).max(100), value: z.number().min(0).max(1),
        expectedTrackUniqueId: z.string().min(1).max(512).optional(),
        expectedTrackRuntimeId: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
        expectedChannelUniqueId: z.string().min(1).max(512).optional(),
        expectedPluginIdentity: z.object({
            name: z.string().min(1).max(4096), vendor: z.string().max(4096),
            version: z.string().max(4096), formatVersion: z.string().max(4096)
        }).strict().optional()
    }, false);
    expose('cubase_tempo_set', 'transport.tempo', 'Submit a tempo in BPM through the native transport API. The host determines its supported range; inspect the observed tempo before assuming completion.', {
        ...session, bpm: z.number().finite().positive()
    }, false);
    expose('cubase_transport_get', 'transport.get', 'Read observed tempo and locator callbacks and available tempo/time setter features. Values not yet observed are null.', session);
    expose('cubase_locator_set', 'transport.time', 'Set the playhead or one cycle locator in the selected primary/secondary time-display format. Supply a Cubase time string in that existing format; does not change the display or open a dialog.', {
        ...session, display: z.enum(['primary', 'secondary']),
        locator: z.enum(['cursor', 'cycleLeft', 'cycleRight']), time: z.string().min(1).max(64)
    }, false);
    expose('cubase_commands_list', 'commands.list', 'List the small fixed background command allowlist and live canPerform state. This is not the complete Cubase menu.', session);
    expose('cubase_command_execute', 'commands.execute', 'Execute a declared command once, only when canPerform succeeds. Contextual commands use the current selection or active project. project.save submits Cubase File/Save for the current project; the host determines its destination and may request input, and submission does not prove persistence. No foreground selection is performed.', {
        ...session, key: z.string().min(1).max(100), confirmCurrentSelection: z.literal(true)
    }, false);
    expose('cubase_selected_track', 'track.current', 'Read the current selected channel runtime ID and unique ID directly from Cubase. Use them to guard track controls and navigation.', session);
    expose('cubase_track_navigate', 'track.navigate', 'Select the previous or next track using the native MIDI Remote action. Requires the selected channel uniqueId and optionally its runtimeId; returns submitted, not verified completion.', {
        ...session, direction: z.enum(['previous', 'next']), expectedUniqueId: z.string().min(1).max(512),
        expectedRuntimeId: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional()
    }, false);

    server.registerTool('cubase_ports', {
        description: 'Enumerate real Windows MIDI ports without opening a connection. Missing configured ports are not replaced with another device.',
        inputSchema: z.object({}).strict(),
        annotations: { readOnlyHint: true, openWorldHint: false }
    }, async () => {
        try { return result({ configured: config.midi, available: MidiClient.ports() }); }
        catch (error) { return failure(error); }
    });

    server.registerTool('cubase_capabilities', {
        description: 'Return implementation constraints together with live host capabilities; fails if the host is unavailable instead of returning mock capabilities.',
        inputSchema: z.object({}).strict(),
        annotations: { readOnlyHint: true, openWorldHint: false }
    }, async (_args, context) => {
        try { return result({ constraints, host: await readStatus(context.mcpReq.signal) }); }
        catch (error) { return failure(error); }
    });

    server.registerTool('cubase_connection_reset', {
        description: 'Explicitly close a failed connection and perform one new handshake. Does not replay any previous operation. Review uncertain mutation outcomes first.',
        inputSchema: z.object({ confirmNoReplay: z.literal(true) }).strict(),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    }, async (_args, context) => {
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
