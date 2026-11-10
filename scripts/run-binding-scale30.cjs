'use strict';

// Diagnostic harness (session 30) for diagnostics/binding-scale-30. It talks to the fixed
// diagnostic controller over the two configured loopback ports, switches its mapping pages
// and records which probe inputs reach the host. One run per owned Cubase lifetime; nothing
// is replayed after an unknown outcome. This is not an MCP backend.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const midi = require('@julusian/midi');
const protocol = require('../remote/protocol.js');

const root = path.resolve(__dirname, '..');
const diagnostic = path.join(root, 'diagnostics', 'binding-scale-30');
const installed = path.join(process.env.USERPROFILE, 'Documents', 'Steinberg', 'Cubase', 'MIDI Remote', 'Driver Scripts', 'Local', 'CubaseAI', 'MCP');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function ownedReceipt() {
    const receipt = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'runtime', 'cubase-launch.json'), 'utf8'));
    if (receipt.Desktop !== 'winsta0\\CubaseAI_MCP' || !receipt.desktopSwitchRestricted || !receipt.jobKillsOnLastHandleClose)
        throw new Error('OWNED_RECEIPT_MISMATCH');
    process.kill(receipt.ProcessId, 0);
    process.kill(receipt.HostPid, 0);
    return receipt;
}

function port(Kind, name) {
    const instance = new Kind();
    const matches = [];
    for (let index = 0; index < instance.getPortCount(); index++) if (instance.getPortName(index) === name) matches.push(index);
    if (matches.length !== 1) { instance.destroy(); throw new Error('PORT_NOT_UNIQUE ' + name); }
    return { instance, index: matches[0] };
}

async function main() {
    const pageFilter = process.argv.slice(2).filter(value => /^\d+$/.test(value)).map(Number);
    const receipt = ownedReceipt();
    for (const name of ['controller.js', 'CubaseAI_MCP.js', 'protocol.js', 'command-sample.js'])
        if (digest(path.join(diagnostic, name)) !== digest(path.join(installed, name))) throw new Error('DIAGNOSTIC_NOT_INSTALLED ' + name);
    const run = crypto.randomUUID();
    const ledger = path.join(root, 'artifacts', 'ipc', `binding-scale30-${receipt.ProcessId}-${receipt.processCreationFiletime}-${run}.jsonl`);
    const fd = fs.openSync(ledger, 'wx', 0o600);
    const record = event => { fs.writeSync(fd, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n'); fs.fsyncSync(fd); };
    const input = port(midi.Input, 'CubaseAI MCP From Cubase');
    const output = port(midi.Output, 'CubaseAI MCP To Cubase');
    const decoder = protocol.createDecoder();
    const waiting = new Map();
    input.instance.ignoreTypes(false, true, true);
    input.instance.on('message', (delta, bytes) => {
        let reply;
        try { reply = decoder.accept(bytes, Date.now()); } catch (error) { return; }
        if (reply && waiting.has(reply.id)) { const settle = waiting.get(reply.id); waiting.delete(reply.id); settle(reply); }
    });
    input.instance.openPort(input.index);
    output.instance.openPort(output.index);
    function request(op, args = {}, timeout = 6000) {
        const id = crypto.randomBytes(16).toString('hex');
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { waiting.delete(id); reject(new Error('DIAGNOSTIC_TIMEOUT ' + op)); }, timeout);
            waiting.set(id, reply => { clearTimeout(timer); reply.ok ? resolve(reply.data) : reject(new Error('DIAGNOSTIC_ERROR ' + op + ' ' + JSON.stringify(reply.error))); });
            for (const frame of protocol.encode({ v: 1, id, deadline: Date.now() + timeout, op, args })) output.instance.sendMessage(frame);
        });
    }
    const read = () => request('diag.read');
    async function settle(predicate, timeout = 1500) {
        const until = Date.now() + timeout;
        let state = await read();
        while (!predicate(state) && Date.now() < until) { await sleep(120); state = await read(); }
        return state;
    }
    const summary = state => ({ metro: state.metro, cycle: state.cycle, click: state.click, volume: state.volume, pan: state.pan,
        direct: state.direct, bindingEvents: state.bindingEvents });
    const tail = state => state.events.slice(-14).map(event => `${event.kind}=${event.value}`);

    try {
        const status = await request('diag.status');
        record({ step: 'status', receipt: { pid: receipt.ProcessId, creation: receipt.processCreationFiletime }, status });
        if (status.profile !== 'binding-scale-30') throw new Error('UNEXPECTED_PROFILE');
        const indices = pageFilter.length ? pageFilter : status.pages.map((page, index) => index);
        for (const index of indices) {
            const page = status.pages[index];
            const result = { step: 'page', index, name: page.name, probeSet: page.probeSet, bindings: page.bindings, errors: page.errors, tests: {} };
            try {
                await request('diag.page', { index });
                let now = await request('diag.status');
                for (const until = Date.now() + 8000; now.page !== index && Date.now() < until;) { await sleep(150); now = await request('diag.status'); }
                if (now.page !== index) throw new Error('PAGE_NOT_ACTIVE');
                await sleep(700);
                await request('diag.clear');
                const base = await read();
                result.baseline = summary(base);
                const toggle = value => (value === 1 ? 0 : 1);

                // A: script-driven custom variable -> value binding (metronome active)
                const metroBefore = base.direct.metronome;
                await request('diag.script', { probe: 'A', value: toggle(metroBefore) });
                let after = await settle(state => state.direct.metronome === toggle(metroBefore));
                result.tests.A = { kind: 'script value', before: metroBefore, after: after.direct.metronome, pass: after.direct.metronome === toggle(metroBefore), events: tail(after) };
                if (result.tests.A.pass) {
                    await request('diag.script', { probe: 'A', value: metroBefore });
                    result.tests.A.restored = (await settle(state => state.direct.metronome === metroBefore)).direct.metronome === metroBefore;
                }

                // B / B2: script pulse -> command binding (filtered cycle, unfiltered metronome)
                for (const [probe, key] of [['B', 'cycle'], ['B2', 'metronome']]) {
                    await request('diag.clear');
                    const before = (await read()).direct[key];
                    await request('diag.script', { probe });
                    after = await settle(state => state.direct[key] === toggle(before));
                    result.tests[probe] = { kind: 'script command pulse', before, after: after.direct[key], pass: after.direct[key] === toggle(before), events: tail(after) };
                    if (result.tests[probe].pass) {
                        await request('diag.script', { probe });
                        result.tests[probe].restored = (await settle(state => state.direct[key] === before)).direct[key] === before;
                    }
                }

                // C / E: one MIDI note -> surface value -> command binding (button cycle, custom variable metronome)
                for (const [probe, noteNumber, key] of [['C', page.inputs.noteC, 'cycle'], ['E', page.inputs.noteE, 'metronome']]) {
                    await request('diag.clear');
                    const before = (await read()).direct[key];
                    const press = async () => { output.instance.sendMessage([0x90, noteNumber, 127]); await sleep(250); output.instance.sendMessage([0x80, noteNumber, 0]); };
                    await press();
                    after = await settle(state => state.direct[key] === toggle(before));
                    result.tests[probe] = { kind: 'MIDI note command', before, after: after.direct[key], pass: after.direct[key] === toggle(before), events: tail(after) };
                    if (result.tests[probe].pass) {
                        await sleep(200);
                        await press();
                        result.tests[probe].restored = (await settle(state => state.direct[key] === before)).direct[key] === before;
                    }
                }

                // D: MIDI CC -> custom variable -> value binding (metronome click level, jump takeover)
                await request('diag.clear');
                const clickBefore = (await read()).click;
                const clickTarget = clickBefore !== null && Math.abs(clickBefore - 100 / 127) < 0.02 ? 40 : 100;
                output.instance.sendMessage([0xb0, page.inputs.ccD, clickTarget]);
                after = await settle(state => state.click !== null && Math.abs(state.click - clickTarget / 127) < 0.005);
                result.tests.D = { kind: 'MIDI CC value', before: clickBefore, target: clickTarget / 127, after: after.click,
                    pass: after.click !== null && Math.abs(after.click - clickTarget / 127) < 0.005, events: tail(after) };
                if (result.tests.D.pass && clickBefore !== null) {
                    output.instance.sendMessage([0xb0, page.inputs.ccD, Math.round(clickBefore * 127)]);
                    result.tests.D.restoredApproximately = Math.abs((await settle(state => Math.abs(state.click - clickBefore) < 0.005)).click - clickBefore) < 0.005;
                }

                if (base.volume !== null || /bank probe|late/.test(page.name)) {
                    // G: MIDI CC -> knob element -> bank channel volume; H: script -> bank channel pan
                    await request('diag.clear');
                    const volumeBefore = (await read()).direct.outputVolume;
                    output.instance.sendMessage([0xb0, page.inputs.ccG, 64]);
                    after = await settle(state => state.direct.outputVolume !== null && Math.abs(state.direct.outputVolume - 64 / 127) < 0.005);
                    result.tests.G = { kind: 'MIDI CC knob bank volume', before: volumeBefore, target: 64 / 127, after: after.direct.outputVolume,
                        pass: after.direct.outputVolume !== null && Math.abs(after.direct.outputVolume - 64 / 127) < 0.005, events: tail(after) };
                    if (result.tests.G.pass) {
                        output.instance.sendMessage([0xb0, page.inputs.ccG, Math.round(volumeBefore * 127)]);
                        result.tests.G.restoredApproximately = Math.abs((await settle(state => Math.abs(state.direct.outputVolume - volumeBefore) < 0.006)).direct.outputVolume - volumeBefore) < 0.006;
                    }
                    await request('diag.clear');
                    const panBefore = (await read()).pan;
                    await request('diag.script', { probe: 'H', value: 0.25 });
                    after = await settle(state => state.pan !== null && Math.abs(state.pan - 0.25) < 0.005);
                    result.tests.H = { kind: 'script bank pan', before: panBefore, target: 0.25, after: after.pan,
                        pass: after.pan !== null && Math.abs(after.pan - 0.25) < 0.005, events: tail(after) };
                    if (result.tests.H.pass && panBefore !== null) {
                        await request('diag.script', { probe: 'H', value: panBefore });
                        result.tests.H.restored = Math.abs((await settle(state => Math.abs(state.pan - panBefore) < 0.005)).pan - panBefore) < 0.005;
                    }
                }
                result.final = summary(await read());
            } catch (error) { result.error = String(error && error.message || error); }
            record(result);
            const line = Object.entries(result.tests).map(([name, test]) => `${name}:${test.pass ? 'PASS' : 'fail'}`).join(' ');
            process.stdout.write(`page ${index} ${page.name} [${page.probeSet}] bindings=${page.bindings} errors=${page.errors} ${line}${result.error ? ' ERROR ' + result.error : ''}\n`);
            if (result.error && /TIMEOUT/.test(result.error)) break;
        }
        try { await request('diag.page', { index: 0 }); } catch (error) { record({ step: 'return_failed', error: String(error.message || error) }); }
        await sleep(500);
        record({ step: 'finished', status: await request('diag.status').catch(error => ({ error: String(error.message || error) })) });
    } finally {
        fs.closeSync(fd);
        input.instance.closePort(); input.instance.destroy();
        output.instance.closePort(); output.instance.destroy();
        process.stdout.write('ledger ' + ledger + '\n');
    }
}

main().catch(error => { process.stderr.write(String(error && error.stack || error) + '\n'); process.exitCode = 1; });
