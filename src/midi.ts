import { randomBytes } from 'node:crypto';
import { encode, createDecoder } from '../remote/protocol.js';

export const DEFAULT_INPUT = 'CubaseAI MCP From Cubase';
export const DEFAULT_OUTPUT = 'CubaseAI MCP To Cubase';

export interface MidiClientOptions {
    input: string;
    output: string;
    timeoutMs: number;
}

type Execution = 'not_started' | 'submitted' | 'unknown';
type Listener = (...values: unknown[]) => void;

interface NativeEvents {
    on(event: string, listener: Listener): unknown;
    removeListener(event: string, listener: Listener): unknown;
}

interface NativePort {
    getPortCount(): number;
    getPortName(index: number): string;
    openPort(index: number): void;
    isPortOpen(): boolean;
    closePort(): void;
    destroy(): void;
}

interface NativeInput extends NativePort, NativeEvents {
    ignoreTypes(sysex: boolean, timing: boolean, activeSensing: boolean): void;
}

interface NativeOutput extends NativePort, Partial<NativeEvents> {
    sendMessage(bytes: number[]): void;
}

interface NativeDriver {
    Input: new () => NativeInput;
    Output: new () => NativeOutput;
}

interface Pending {
    resolve(value: unknown): void;
    reject(reason: BridgeError): void;
    timer: ReturnType<typeof setTimeout>;
    sent: boolean;
    signal?: AbortSignal;
    abort?: () => void;
    internal?: boolean;
    probe?: ReturnType<typeof setTimeout>;
    session?: string;
    deadline: number;
}

// A response frame can be lost in transit (observed when the Cubase transport stops). After this
// delay the client asks the bridge for the stored response of the same request ID. The operation
// is never sent again; only its already produced response is read.
const RESPONSE_PROBE_DELAY_MS = 1200;

export class BridgeError extends Error {
    constructor(
        public readonly code: string,
        message: string,
        public readonly execution: Execution = 'not_started',
        public readonly details?: unknown
    ) {
        super(message);
        this.name = 'BridgeError';
    }
}

function loadDriver(): NativeDriver {
    return require('@julusian/midi/lazy') as NativeDriver;
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function names(port: NativePort): string[] {
    const result: string[] = [];
    const count = port.getPortCount();
    for (let index = 0; index < count; index++) result.push(port.getPortName(index));
    return result;
}

function release(port?: NativePort): string[] {
    const errors: string[] = [];
    if (!port) return errors;
    try { port.closePort(); } catch (error) { errors.push(describe(error)); }
    try { port.destroy(); } catch (error) { errors.push(describe(error)); }
    return errors;
}

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function execution(value: unknown): value is Execution {
    return value === 'not_started' || value === 'submitted' || value === 'unknown';
}

export class MidiClient {
    private readonly options: MidiClientOptions;
    private readonly decoder = createDecoder();
    private readonly pending = new Map<string, Pending>();
    private readonly listeners: { port: NativeEvents; event: string; listener: Listener }[] = [];
    private input?: NativeInput;
    private output?: NativeOutput;
    private monitor?: ReturnType<typeof setInterval>;
    private state: 'new' | 'open' | 'faulted' | 'closed' = 'new';
    private fault?: BridgeError;
    private saveBusy = false;

    constructor(options: MidiClientOptions, private readonly driver?: NativeDriver) {
        if (!options || typeof options.input !== 'string' || !options.input.trim() ||
            typeof options.output !== 'string' || !options.output.trim() ||
            options.input === options.output || !Number.isInteger(options.timeoutMs) ||
            options.timeoutMs < 1 || options.timeoutMs > 2147483647) {
            throw new BridgeError('INVALID_MIDI_OPTIONS', 'Distinct exact port names and a positive timeout are required.');
        }
        this.options = { ...options };
    }

    static ports(): { inputs: string[]; outputs: string[] } {
        let input: NativeInput | undefined;
        let output: NativeOutput | undefined;
        let failure: unknown;
        let listing = { inputs: [] as string[], outputs: [] as string[] };
        try {
            const driver = loadDriver();
            input = new driver.Input();
            output = new driver.Output();
            listing = { inputs: names(input), outputs: names(output) };
        } catch (error) {
            failure = error;
        }
        const cleanup = [...release(input), ...release(output)];
        if (failure !== undefined || cleanup.length) {
            throw new BridgeError('MIDI_PORTS_FAILED', 'Could not enumerate and release MIDI ports.',
                'not_started', { cause: describe(failure), cleanup });
        }
        return listing;
    }

    async request(op: string, args: Record<string, unknown> = {}, signal?: AbortSignal): Promise<unknown> {
        return this.transmit(op, args, signal, false);
    }

    private async transmit(op: string, args: Record<string, unknown>, signal: AbortSignal | undefined, internal: boolean): Promise<unknown> {
        if (this.state === 'closed' || this.state === 'faulted') {
            throw new BridgeError(this.state === 'closed' ? 'MIDI_CLOSED' : 'MIDI_FAULTED',
                'Construct a new MIDI client before sending another request.', 'not_started', this.fault);
        }
        if (signal?.aborted) throw new BridgeError('MIDI_CANCELLED', 'Request cancelled before submission.');
        if (typeof op !== 'string' || !op.trim() || !record(args)) {
            throw new BridgeError('INVALID_REQUEST', 'An operation name and an argument object are required.');
        }
        if (this.pending.size >= 32) throw new BridgeError('MIDI_BUSY', 'At most 32 requests may be pending.');
        const id = randomBytes(16).toString('hex');
        const deadline = Date.now() + (internal ? Math.min(1500, this.options.timeoutMs) : this.options.timeoutMs);
        let frames: number[][];
        try {
            frames = encode({ v: 1, id, deadline, op, args });
        } catch (error) {
            throw new BridgeError('MIDI_ENCODING_ERROR', 'Request could not be encoded.', 'not_started', describe(error));
        }
        this.open();
        if (Date.now() >= deadline) throw new BridgeError('MIDI_TIMEOUT', 'Request expired before submission.');
        return new Promise((resolve, reject) => {
            const pending: Pending = {
                resolve, reject, sent: false, signal, internal, deadline,
                session: typeof args.session === 'string' ? args.session : undefined,
                timer: setTimeout(() => {
                    // A lost look-up only ends that look-up; a lost operation response faults the channel.
                    if (internal) this.settle(id, new BridgeError('MIDI_TIMEOUT', 'Response look-up timed out.', 'not_started', { id }));
                    else this.fail(new BridgeError('MIDI_TIMEOUT', 'MIDI response timed out.', 'unknown', { id }));
                }, Math.max(1, deadline - Date.now()))
            };
            this.pending.set(id, pending);
            if (!internal) pending.probe = setTimeout(() => this.probe(id, pending), RESPONSE_PROBE_DELAY_MS);
            if (signal) {
                pending.abort = () => {
                    const error = new BridgeError('MIDI_CANCELLED', 'MIDI request cancelled.',
                        pending.sent ? 'unknown' : 'not_started', { id });
                    if (pending.sent) this.fail(error);
                    else this.settle(id, error);
                };
                signal.addEventListener('abort', pending.abort, { once: true });
                if (signal.aborted) pending.abort();
            }
            try {
                for (const frame of frames) {
                    if (this.state !== 'open' || !this.pending.has(id)) break;
                    pending.sent = true;
                    this.output!.sendMessage(frame);
                }
            } catch (error) {
                this.fail(new BridgeError('MIDI_SEND_FAILED', 'MIDI submission failed.', 'unknown', describe(error)));
            }
        });
    }

    async executeSave(args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
        if (args.key !== 'project.save' || args.confirmCurrentSelection !== true || typeof args.session !== 'string' || !args.session)
            throw new BridgeError('INVALID_SAVE_REQUEST', 'A confirmed project.save session is required.');
        if (this.saveBusy) throw new BridgeError('MIDI_BUSY', 'A Save input is already pending.');
        this.saveBusy = true;
        let inputSent = false, releaseSent = false;
        const deadline = Date.now() + this.options.timeoutMs;
        const timeout = new AbortController();
        const timer = setTimeout(() => timeout.abort(), this.options.timeoutMs);
        const cancellation = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
        try {
            const prepared = await this.request('commands.prepare', { ...args, inputDeadline: deadline }, cancellation);
            if (!record(prepared) || prepared.originSession !== args.session || typeof prepared.session !== 'string' || !prepared.session || prepared.key !== 'project.save' ||
                prepared.execution !== 'prepared_not_submitted' || typeof prepared.token !== 'string' ||
                !/^[a-f0-9]{32}$/.test(prepared.token) || typeof prepared.inputDeadline !== 'number' ||
                prepared.inputDeadline > deadline || Date.now() >= prepared.inputDeadline || cancellation.aborted)
                throw new BridgeError('SAVE_PREPARATION_INVALID', 'Save input preparation is invalid or expired.');
            this.checkConnected();
            inputSent = true;
            this.output!.sendMessage([144, 1, 127]);
            while (!cancellation.aborted && Date.now() < prepared.inputDeadline) {
                const result = await this.request('commands.result', { session: prepared.session, token: prepared.token }, cancellation);
                if (!record(result) || result.session !== prepared.session || result.token !== prepared.token)
                    throw new BridgeError('SAVE_RESULT_INVALID', 'The Save result token changed.');
                if (result.execution === 'submitted' && result.bindingObserved === true) {
                    if (!releaseSent) {
                        this.checkConnected();
                        this.output!.sendMessage([128, 1, 0]);
                        releaseSent = true;
                    }
                    if (result.inputReleased === true) {
                        const finished = await this.request('commands.finish', { session: prepared.session, token: prepared.token }, cancellation);
                        if (!record(finished) || finished.token !== prepared.token || finished.returnedToMain !== true ||
                            finished.execution !== 'submitted' || typeof finished.session !== 'string' || !finished.session)
                            throw new BridgeError('SAVE_RETURN_INVALID', 'The primary mapping did not return.');
                        return finished;
                    }
                } else if (result.execution !== 'awaiting_input') {
                    throw new BridgeError('SAVE_RESULT_INVALID', 'Unexpected Save result state.');
                }
                await new Promise(resolve => setTimeout(resolve, 25));
            }
            throw new BridgeError('MIDI_TIMEOUT', 'Save binding observation expired.');
        } catch (error) {
            const failure = new BridgeError(error instanceof BridgeError ? error.code : 'MIDI_SAVE_FAILED',
                error instanceof Error ? error.message : String(error), inputSent ? 'unknown' : 'not_started');
            if (inputSent) this.fail(failure);
            throw failure;
        } finally {
            clearTimeout(timer);
            this.saveBusy = false;
        }
    }

    prepareLifecycle(): void {
        if (this.pending.size || this.saveBusy) throw new BridgeError('MIDI_BUSY', 'Complete pending MIDI requests before changing the owned runtime.');
        this.close();
    }

    close(): void {
        if (this.state === 'closed' || this.state === 'faulted') return;
        this.state = 'closed';
        this.rejectPending(new BridgeError('MIDI_CLOSED', 'MIDI client closed.'));
        this.dispose();
    }

    private listen(port: NativeEvents, event: string, listener: Listener): void {
        port.on(event, listener);
        this.listeners.push({ port, event, listener });
    }

    private select(available: string[], wanted: string, direction: string): number {
        const matches = available.reduce<number[]>((indices, name, index) => {
            if (name === wanted) indices.push(index);
            return indices;
        }, []);
        if (matches.length !== 1) {
            throw new BridgeError(matches.length ? 'MIDI_PORT_AMBIGUOUS' : 'MIDI_PORT_NOT_FOUND',
                `Expected one exact ${direction} port named "${wanted}".`, 'not_started', { available });
        }
        return matches[0]!;
    }

    private open(): void {
        try {
            if (this.state === 'open') {
                this.checkConnected();
                return;
            }
            const driver = this.driver ?? loadDriver();
            this.input = new driver.Input();
            this.output = new driver.Output();
            const inputIndex = this.select(names(this.input), this.options.input, 'input');
            const outputIndex = this.select(names(this.output), this.options.output, 'output');
            this.listen(this.input, 'message', (_deltaTime, bytes) => this.receive(bytes));
            for (const port of [this.input, this.output]) {
                if (typeof port.on !== 'function' || typeof port.removeListener !== 'function') continue;
                for (const event of ['error', 'close', 'disconnect']) {
                    this.listen(port as NativeEvents, event, (cause) => {
                        this.fail(new BridgeError('MIDI_DISCONNECTED', 'MIDI endpoint disconnected.', 'unknown', describe(cause)));
                    });
                }
            }
            this.input.ignoreTypes(false, true, true);
            this.input.openPort(inputIndex);
            if (this.fault) throw this.fault;
            this.output.openPort(outputIndex);
            if (this.fault) throw this.fault;
            this.state = 'open';
            this.checkConnected();
            this.monitor = setInterval(() => {
                try { this.checkConnected(); }
                catch (error) {
                    this.fail(new BridgeError('MIDI_DISCONNECTED', 'MIDI endpoint disconnected.', 'unknown', describe(error)));
                }
            }, 250);
            this.monitor.unref();
        } catch (error) {
            const failure = error instanceof BridgeError ?
                new BridgeError(error.code, error.message, 'not_started', error.details) :
                new BridgeError('MIDI_OPEN_FAILED', 'Could not open configured MIDI ports.', 'not_started', describe(error));
            this.fail(failure);
            throw failure;
        }
    }

    private checkConnected(): void {
        if (!this.input?.isPortOpen() || !this.output?.isPortOpen() ||
            names(this.input).filter(name => name === this.options.input).length !== 1 ||
            names(this.output).filter(name => name === this.options.output).length !== 1) {
            throw new BridgeError('MIDI_DISCONNECTED', 'Configured MIDI ports are no longer uniquely available.');
        }
    }

    private probe(id: string, pending: Pending): void {
        pending.probe = undefined;
        if (this.state !== 'open' || this.pending.get(id) !== pending || !pending.sent || pending.deadline - Date.now() < 300) return;
        const again = () => {
            if (this.state === 'open' && this.pending.get(id) === pending) {
                pending.probe = setTimeout(() => this.probe(id, pending), RESPONSE_PROBE_DELAY_MS);
            }
        };
        this.transmit('bridge.response', { requestId: id, ...(pending.session ? { session: pending.session } : {}) }, undefined, true).then(found => {
            if (this.state !== 'open' || this.pending.get(id) !== pending) return;
            if (record(found) && found.state === 'completed' && record(found.response) && found.response.id === id) {
                this.deliver(found.response);
            } else if (record(found) && found.state === 'unknown' && found.sameInstance === true) {
                // The same script instance never admitted this ID: its request frames were lost before execution.
                this.settle(id, new BridgeError('REQUEST_NOT_ADMITTED', 'The bridge never received this request; it was not executed.', 'not_started', { id }));
            } else {
                again();
            }
        }, again);
    }

    private receive(bytes: unknown): void {
        if (this.state !== 'open' || (!Array.isArray(bytes) && !Buffer.isBuffer(bytes))) return;
        try {
            this.deliver(this.decoder.accept(bytes, Date.now()));
        } catch (error) {
            this.fail(new BridgeError('MIDI_PROTOCOL_ERROR', 'Invalid MIDI bridge response.', 'unknown', describe(error)));
        }
    }

    private deliver(response: unknown): void {
        try {
            if (!record(response) || typeof response.id !== 'string' || !this.pending.has(response.id)) return;
            if (response.v !== 1 || typeof response.ok !== 'boolean') throw new Error('INVALID_RESPONSE');
            if (response.ok) {
                if (!Object.hasOwn(response, 'data') || Object.hasOwn(response, 'error')) throw new Error('INVALID_RESPONSE');
                this.settle(response.id, undefined, response.data);
                return;
            }
            const error = response.error;
            if (Object.hasOwn(response, 'data') || !record(error) || typeof error.code !== 'string' ||
                !error.code || typeof error.message !== 'string' ||
                (error.execution !== undefined && !execution(error.execution))) throw new Error('INVALID_ERROR');
            this.settle(response.id, new BridgeError(error.code, error.message,
                error.execution === undefined ? 'not_started' : error.execution, error.details));
        } catch (error) {
            this.fail(new BridgeError('MIDI_PROTOCOL_ERROR', 'Invalid MIDI bridge response.', 'unknown', describe(error)));
        }
    }

    private settle(id: string, error?: BridgeError, data?: unknown): void {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        clearTimeout(pending.timer);
        if (pending.probe) clearTimeout(pending.probe);
        if (pending.abort) pending.signal?.removeEventListener('abort', pending.abort);
        if (error) pending.reject(error);
        else pending.resolve(data);
    }

    private rejectPending(error: BridgeError): void {
        for (const [id, pending] of this.pending) {
            this.settle(id, new BridgeError(error.code, error.message,
                pending.sent ? 'unknown' : 'not_started', error.details));
        }
    }

    private fail(error: BridgeError): void {
        if (this.state === 'faulted' || this.state === 'closed') return;
        this.state = 'faulted';
        this.fault = error;
        this.rejectPending(error);
        this.dispose();
    }

    private dispose(): void {
        if (this.monitor) clearInterval(this.monitor);
        this.monitor = undefined;
        for (const { port, event, listener } of this.listeners.splice(0)) port.removeListener(event, listener);
        this.decoder.reset();
        release(this.input);
        release(this.output);
        this.input = undefined;
        this.output = undefined;
    }
}
