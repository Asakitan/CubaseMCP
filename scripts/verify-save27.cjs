'use strict';
// One fixed, owned fixture and process lifetime; this is not an MCP backend.
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/client');
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');

const root = 'E:\\VC\\CubaseMCP';
const pid = 69032, creation = '134387308608166004', holder = 54396, holderCreation = '134387308599415959';
const fixture = path.join(root, 'artifacts', 'live-smoke', 'Binding26Jump.cpr');
const uid = '604DE95A858E93754BEA0BE43A9D6B2', tag = 1025, requested = 0.625;
const ledger = path.join(root, 'artifacts', 'ipc', `save27-experiment-${pid}-${creation}.jsonl`);

function checkReceipt() {
    const r = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'runtime', 'cubase-launch.json'), 'utf8'));
    if (r.ProcessId !== pid || r.processCreationFiletime !== creation || r.HostPid !== holder ||
        r.holderCreationFiletime !== holderCreation || r.mode !== 'empty' || r.Project !== null ||
        r.Desktop !== 'winsta0\\CubaseAI_MCP' || !r.desktopSwitchRestricted || !r.jobKillsOnLastHandleClose)
        throw new Error('OWNED_RECEIPT_CHANGED');
}
function snapshot() {
    const link = fs.lstatSync(fixture);
    if (!link.isFile() || link.isSymbolicLink() || fs.realpathSync(fixture).toLowerCase() !== fixture.toLowerCase())
        throw new Error('FIXTURE_IDENTITY_MISMATCH');
    const bytes = fs.readFileSync(fixture), stat = fs.statSync(fixture);
    return { bytes, info: { size: stat.size, mtimeMs: stat.mtimeMs, dev: stat.dev, ino: stat.ino } };
}
async function main() {
    checkReceipt();
    const before = snapshot();
    if (before.info.size !== 93085) throw new Error('FIXTURE_SIZE_MISMATCH');
    const fd = fs.openSync(ledger, 'wx', 0o600);
    function record(event) { fs.writeSync(fd, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n'); fs.fsyncSync(fd); }
    const client = new Client({ name: 'cubase-save27-owned-fixture', version: '0.1.0' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dist', 'src', 'server.js')],
        env: { ...process.env, CUBASE_MCP_CONFIG: path.join(root, 'cubase.config.json') }, stderr: 'pipe' });
    transport.stderr.on('data', data => process.stderr.write(data));
    let stage = 'not_started';
    async function call(name, args = {}) {
        const reply = await client.callTool({ name, arguments: args });
        const content = reply.content.find(item => item.type === 'text');
        if (!content) throw new Error('MCP_RESPONSE_MISSING');
        const body = JSON.parse(content.text);
        if (reply.isError || !body.ok) throw new Error(JSON.stringify(body.error));
        return body.data;
    }
    try {
        record({ step: 'started', pid, creation, fixture, before: before.info });
        await client.connect(transport);
        const status = await call('cubase_status');
        if (!status.active || status.bridgeRevision !== '2026-11-10-coverage-3.10' || !status.serverCompatibility.readyForOperations)
            throw new Error('BRIDGE_NOT_READY');
        const session = status.session;
        const objects = await call('cubase_objects_list', { session, root: 'trackSelection', limit: 64 });
        const matches = objects.items.filter(item => item.uniqueIdString === uid && item.typeName === 'OutputChannel');
        if (matches.length !== 1) throw new Error('OUTPUT_CHANNEL_NOT_UNIQUE');
        const objectId = matches[0].objectId;
        const params = await call('cubase_parameters_list', { session, root: 'trackSelection', objectId, limit: 64 });
        const volume = params.items.filter(item => item.tag === tag);
        if (volume.length !== 1 || volume[0].locked !== false || !Number.isFinite(volume[0].value) ||
            Math.abs(volume[0].value - requested) < 1e-6) throw new Error('VOLUME_BASELINE_MISMATCH');
        record({ step: 'edit_admitted', session, objectId, uid, tag, before: volume[0].value, requested });
        stage = 'edit_unknown';
        const edit = await call('cubase_parameter_set', { session, root: 'trackSelection', objectId, tag,
            mode: 'normalized', value: requested, expectedValue: volume[0].value });
        record({ step: 'edit_receipt', edit });
        const observed = (await call('cubase_parameter_get', { session, root: 'trackSelection', objectId, tag })).parameter;
        if (!observed || Math.abs(observed.value - requested) >= 1e-6) throw new Error('EDIT_NOT_OBSERVED');
        stage = 'edit_observed'; record({ step: stage, value: observed.value });
        const commands = await call('cubase_commands_list', { session });
        const save = commands.commands.filter(command => command.key === 'project.save');
        if (save.length !== 1 || !save[0].available || !save[0].canPerform) throw new Error('SAVE_NOT_PERFORMABLE');
        checkReceipt();
        const preSave = snapshot();
        if (!preSave.bytes.equals(before.bytes) || preSave.info.dev !== before.info.dev || preSave.info.ino !== before.info.ino)
            throw new Error('FIXTURE_CHANGED_BEFORE_SAVE');
        record({ step: 'save_admitted', session, before: preSave.info });
        stage = 'save_unknown';
        const submitted = await call('cubase_command_execute', { session, key: 'project.save', confirmCurrentSelection: true });
        record({ step: 'save_receipt', submitted });
        let after = preSave;
        const until = Date.now() + 12000;
        while (Date.now() < until && after.bytes.equals(preSave.bytes)) {
            await new Promise(resolve => setTimeout(resolve, 500));
            after = snapshot();
        }
        const changed = !after.bytes.equals(preSave.bytes);
        stage = changed ? 'file_change_observed' : 'save_unverified';
        record({ step: stage, changed, after: after.info,
            limitation: 'A file change after submission is not semantic reopen or proof of the writer.' });
        if (!changed) process.exitCode = 2;
    } catch (error) {
        record({ step: 'error', stage, message: String(error.message || error) });
        process.exitCode = 1;
    } finally {
        try { await client.close(); } finally { fs.closeSync(fd); }
        process.stdout.write(JSON.stringify({ stage, ledger }) + '\n');
    }
}
main().catch(error => { process.stderr.write(String(error.stack || error) + '\n'); process.exitCode = 1; });
