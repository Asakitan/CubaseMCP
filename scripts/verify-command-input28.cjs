'use strict';
const fs = require('node:fs');
const path = require('node:path');
const midi = require('@julusian/midi');
const { Client } = require('@modelcontextprotocol/client');
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');
const root = 'E:\\VC\\CubaseMCP', pid = 37324, creation = '134387313056449676';
const fixture = path.join(root, 'artifacts', 'live-smoke', 'Command Input 28.cpr');
const ledger = path.join(root, 'artifacts', 'ipc', `command-input28-${pid}-${creation}.jsonl`);
const requested = 0.6875, uid = '604DE95A858E93754BEA0BE43A9D6B2';
function receipt() {
    const r = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'runtime', 'cubase-launch.json'), 'utf8'));
    if (r.ProcessId !== pid || r.processCreationFiletime !== creation || r.HostPid !== 37320 ||
        r.holderCreationFiletime !== '134387313048014053' || r.RunId !== '5968b3a40a654046b075839ef05887a8' ||
        r.Desktop !== 'winsta0\\CubaseAI_MCP' || !r.desktopSwitchRestricted || !r.jobKillsOnLastHandleClose)
        throw new Error('OWNED_RECEIPT_CHANGED');
}
function snapshot() {
    const s = fs.lstatSync(fixture);
    if (!s.isFile() || s.isSymbolicLink() || fs.realpathSync(fixture).toLowerCase() !== fixture.toLowerCase()) throw new Error('FIXTURE_CHANGED');
    return { bytes: fs.readFileSync(fixture), info: { size: s.size, mtimeMs: s.mtimeMs, ino: s.ino, dev: s.dev } };
}
async function main() {
    receipt();
    const initial = snapshot();
    if (initial.info.size !== 93085) throw new Error('FIXTURE_SIZE_MISMATCH');
    const fd = fs.openSync(ledger, 'wx', 0o600);
    const record = event => { fs.writeSync(fd, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n'); fs.fsyncSync(fd); };
    const client = new Client({ name: 'command-input28', version: '0.1.0' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dist/src/server.js')],
        env: { ...process.env, CUBASE_MCP_CONFIG: path.join(root, 'cubase.config.json') }, stderr: 'pipe' });
    transport.stderr.on('data', data => process.stderr.write(data));
    let output, stage = 'not_started';
    async function call(name, args = {}) {
        const response = await client.callTool({ name, arguments: args });
        const body = JSON.parse(response.content.find(item => item.type === 'text').text);
        if (response.isError || !body.ok) throw new Error(JSON.stringify(body.error));
        return body.data;
    }
    try {
        record({ step: 'started', pid, creation, fixture, initial: initial.info });
        await client.connect(transport);
        const status = await call('cubase_status');
        record({ step: 'status', status });
        if (!status.active || status.bridgeRevision !== '2026-11-10-coverage-3.10' ||
            status.diagnosticProfile !== 'command-input-28' || !status.serverCompatibility.readyForOperations) throw new Error('DIAGNOSTIC_NOT_ACTIVE');
        output = new midi.Output();
        const matches = [];
        for (let i = 0; i < output.getPortCount(); ++i) if (output.getPortName(i) === 'CubaseAI MCP To Cubase') matches.push(i);
        if (matches.length !== 1) throw new Error('MIDI_OUTPUT_NOT_UNIQUE');
        output.openPort(matches[0]);
        const session = status.session;
        const objects = await call('cubase_objects_list', { session, root: 'trackSelection', limit: 64 });
        const target = objects.items.filter(item => item.uniqueIdString === uid && item.typeName === 'OutputChannel');
        if (target.length !== 1) throw new Error('OUTPUT_CHANNEL_NOT_UNIQUE');
        const objectId = target[0].objectId;
        const params = await call('cubase_parameters_list', { session, root: 'trackSelection', objectId, limit: 64 });
        const volume = params.items.filter(item => item.tag === 1025);
        if (volume.length !== 1 || volume[0].locked || Math.abs(volume[0].value - 0.7890865802764893) > 1e-9) throw new Error('BASELINE_MISMATCH');
        record({ step: 'edit_admitted', session, objectId, uid, tag: 1025, requested, before: volume[0].value });
        stage = 'edit_unknown';
        record({ step: 'edit_receipt', result: await call('cubase_parameter_set', { session, root: 'trackSelection', objectId,
            tag: 1025, mode: 'normalized', value: requested, expectedValue: volume[0].value }) });
        const observed = (await call('cubase_parameter_get', { session, root: 'trackSelection', objectId, tag: 1025 })).parameter;
        if (!observed || Math.abs(observed.value - requested) > 1e-6) throw new Error('EDIT_NOT_OBSERVED');
        record({ step: 'edit_observed', value: observed.value });
        const commands = await call('cubase_commands_list', { session });
        const save = commands.commands.filter(item => item.key === 'project.save');
        if (save.length !== 1 || !save[0].available || !save[0].canPerform) throw new Error('SAVE_NOT_PERFORMABLE');
        receipt();
        if (!snapshot().bytes.equals(initial.bytes)) throw new Error('FILE_CHANGED_BEFORE_INPUT');
        record({ step: 'input_admitted', noteOn: [159, 126, 127], noteOff: [143, 126, 0] });
        stage = 'input_unknown';
        output.sendMessage([159, 126, 127]);
        await new Promise(resolve => setTimeout(resolve, 80));
        output.sendMessage([143, 126, 0]);
        record({ step: 'input_sent' });
        const until = Date.now() + 15000;
        let after = initial;
        while (Date.now() < until && after.bytes.equals(initial.bytes)) {
            await new Promise(resolve => setTimeout(resolve, 500));
            try { after = snapshot(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        const changed = !after.bytes.equals(initial.bytes);
        stage = changed ? 'file_change_observed' : 'save_unverified';
        record({ step: stage, changed, after: after.info, limitation: 'File change is not a semantic reopen or writer attribution.' });
        if (!changed) process.exitCode = 2;
    } catch (error) { record({ step: 'error', stage, message: String(error.message || error) }); process.exitCode = 1; }
    finally {
        try {
            if (output) { try { output.closePort(); } finally { output.destroy(); } }
        } finally {
            try { await client.close(); } finally { fs.closeSync(fd); }
            process.stdout.write(JSON.stringify({ stage, ledger }) + '\n');
        }
    }
}
main().catch(error => { process.stderr.write(String(error.stack || error) + '\n'); process.exitCode = 1; });
