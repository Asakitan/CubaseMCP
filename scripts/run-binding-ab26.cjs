'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const protocol = require('../diagnostics/binding-ab-26/protocol.js');
const INPUT = 'CubaseAI Binding26 From Cubase';
const OUTPUT = 'CubaseAI Binding26 To Cubase';
const UID = '604DE95A858E93754BEA0BE43A9D6B2';
const TIMEOUT = 2500;
function portIndex(port, name) {
    const found = [];
    for (let i = 0; i < port.getPortCount(); i++) if (port.getPortName(i) === name) found.push(i);
    if (found.length !== 1) throw new Error('PORT_NOT_UNIQUE');
    return found[0];
}
function openTransport(driver) {
    let input, output;
    try { input = new driver.Input(); output = new driver.Output(); }
    catch (err) {
        for (const port of [input, output]) if (port) {
            try { port.closePort(); } catch (_) {} try { port.destroy(); } catch (_) {}
        }
        throw err;
    }
    const decoder = protocol.createDecoder();
    let fault = null, pending = null, closed = false;
    function fail(err) { fault = err; if (pending) { const p = pending; pending = null; clearTimeout(p.timer); p.reject(err); } }
    function connected() {
        if (fault || closed || !input.isPortOpen() || !output.isPortOpen()) throw new Error('MIDI_DISCONNECTED');
        portIndex(input, INPUT); portIndex(output, OUTPUT);
    }
    try {
        input.on('message', (_delta, bytes) => {
            if (!pending) return;
            try {
                const answer = decoder.accept(bytes, Date.now());
                if (!answer || answer.id !== pending.id) return;
                if (answer.v !== 1 || typeof answer.ok !== 'boolean') throw new Error('INVALID_RESPONSE');
                const p = pending; pending = null; clearTimeout(p.timer); p.resolve(answer);
            } catch (err) { fail(err); }
        });
        for (const port of [input, output]) if (typeof port.on === 'function') {
            for (const event of ['error', 'disconnect', 'close']) port.on(event, () => { if (!closed) fail(new Error('MIDI_DISCONNECTED')); });
        }
        const i = portIndex(input, INPUT), o = portIndex(output, OUTPUT);
        input.ignoreTypes(false, true, true); input.openPort(i); output.openPort(o); connected();
    } catch (err) { closed = true; try { input.closePort(); } catch (_) {} try { output.closePort(); } catch (_) {} try { input.destroy(); } catch (_) {} try { output.destroy(); } catch (_) {} throw err; }
    const monitor = setInterval(() => { try { connected(); } catch (err) { fail(err); } }, 100);
    function close() { closed = true; clearInterval(monitor); try { input.closePort(); } catch (_) {} try { output.closePort(); } catch (_) {} try { input.destroy(); } catch (_) {} try { output.destroy(); } catch (_) {} }
    function request(op, session) {
        connected();
        const req = { v: 1, id: crypto.randomBytes(16).toString('hex'), op, deadline: Date.now() + TIMEOUT };
        if (session !== undefined) req.session = session;
        const frames = protocol.encode(req);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => fail(new Error('MIDI_TIMEOUT')), TIMEOUT);
            pending = { id: req.id, resolve, reject, timer };
            try { for (const frame of frames) { connected(); output.sendMessage(frame); } }
            catch (err) { fail(err); }
        });
    }
    return { request, close };
}
function requireOk(reply) {
    if (!reply || reply.ok !== true || !reply.data || typeof reply.data !== 'object') throw new Error('REMOTE_REJECTED');
    return reply.data;
}
function validRead(x) {
    return x && Number.isSafeInteger(x.objectId) && x.objectId >= 0 && x.uniqueId === UID && x.tag === 1025 &&
        x.locked === false && typeof x.value === 'number' && Number.isFinite(x.value) && x.value >= 0 && x.value <= 1;
}
function durableAdmission(dir, plan, runId, session, baseline, target) {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `binding26-${plan.pid}-${plan.creation}.json`);
    const fd = fs.openSync(file, 'wx', 0o600);
    try {
        fs.writeFileSync(fd, JSON.stringify({ runId, mode: plan.mode, pid: plan.pid, creation: plan.creation,
            session, baseline, target, admittedAt: new Date().toISOString(), interpretation: 'external_plan_claim_not_verified' }) + '\n');
        fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    return file;
}
async function run(plan, dependencies = {}) {
    if (!plan || !['default', 'jump'].includes(plan.mode) || !Number.isSafeInteger(plan.pid) || plan.pid < 1 ||
        typeof plan.creation !== 'string' || !/^[0-9]{1,24}$/.test(plan.creation) || Object.keys(plan).some(k => !['mode','pid','creation'].includes(k))) throw new Error('INVALID_PLAN');
    const runId = crypto.randomBytes(16).toString('hex'), target = plan.mode === 'default' ? .625 : .375;
    const record = { runId, planClaim: plan, outcome: 'not_started', steps: [] };
    let transport, admitted = false;
    if (!dependencies.driver || !dependencies.admissionDir) throw new Error('LIVE_EXPERIMENT_NOT_ADMITTED');
    const driver = dependencies.driver;
    const dir = dependencies.admissionDir;
    try {
        transport = openTransport(driver);
        async function call(op, session) { const reply = await transport.request(op, session); record.steps.push({ op, reply }); return requireOk(reply); }
        const status = await call('status');
        if (status.arm !== plan.mode || typeof status.session !== 'string' || !status.session || status.state !== 'not_started' || status.target !== target) throw new Error('STATUS_MISMATCH');
        const base = await call('baseline', status.session);
        if (base.state !== 'not_started' || !validRead(base.baseline) || Math.abs(base.baseline.value - target) <= 1e-6) throw new Error('BASELINE_MISMATCH');
        record.admission = durableAdmission(dir, plan, runId, status.session, base.baseline, target); admitted = true;
        record.outcome = 'unknown';
        const submitted = await call('write', status.session);
        if (submitted.state !== 'unknown' || submitted.target !== target || !validRead(submitted.before) ||
            submitted.before.objectId !== base.baseline.objectId || Math.abs(submitted.before.value - base.baseline.value) > 1e-6) throw new Error('WRITE_RESPONSE_MISMATCH');
        const read = await call('read', status.session);
        if (!validRead(read.read) || read.read.objectId !== base.baseline.objectId) throw new Error('READ_IDENTITY_MISMATCH');
        if (read.state !== 'target_observed' || Math.abs(read.read.value - target) > 1e-6) return record;
        record.outcome = 'target_observed';
        const restore = await call('restore', status.session);
        if (restore.state !== 'restore_unknown' || restore.target !== base.baseline.value || !validRead(restore.before) ||
            restore.before.objectId !== base.baseline.objectId || Math.abs(restore.before.value - target) > 1e-6) throw new Error('RESTORE_RESPONSE_MISMATCH');
        record.outcome = 'restore_unknown';
        return record;
    } catch (error) {
        record.error = String(error.message || error);
        if (admitted && record.outcome !== 'target_observed') record.outcome = 'unknown';
        else if (admitted && record.outcome === 'target_observed') record.outcome = 'restore_unknown';
        return record;
    } finally { if (transport) transport.close(); }
}
exports.run = run;
if (require.main === module) {
    process.stderr.write('LIVE_EXPERIMENT_NOT_ADMITTED\n');
    process.exitCode = 1;
}
