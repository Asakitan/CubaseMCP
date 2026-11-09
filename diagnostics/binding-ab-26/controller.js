'use strict';
var protocol = require('./protocol');
var UID = '604DE95A858E93754BEA0BE43A9D6B2', TAG = 1025, EPS = 0.000001;
function createController(api, arm) {
    if (arm !== 'default' && arm !== 'jump') throw new Error('INVALID_ARM');
    var target = arm === 'default' ? 0.625 : 0.375;
    var driver = api.makeDeviceDriver('BindingAB26', arm, 'BindingAB26 ' + arm);
    var input = driver.mPorts.makeMidiInput('CubaseAI Binding26 To Cubase');
    var output = driver.mPorts.makeMidiOutput('CubaseAI Binding26 From Cubase');
    var detect = driver.makeDetectionUnit().detectPortPair(input, output);
    detect.expectInputNameEquals('CubaseAI Binding26 To Cubase'); detect.expectOutputNameEquals('CubaseAI Binding26 From Cubase');
    var page = driver.mMapping.makePage('BindingAB26 ' + arm), host = page.mHostAccess;
    var channel = host.mMixConsole.makeMixerBankZone('BindingAB26').makeMixerBankChannel();
    var value = channel.mValue.mVolume;
    var surface = driver.mSurface.makeCustomValueVariable('BindingAB26 ' + arm);
    var binding = page.makeValueBinding(surface, value);
    if (arm === 'jump') binding.setValueTakeOverModeJump();
    var access = host.makeDirectAccess(host.mTrackSelection), device = null, mapping = null, session = null;
    var decoder = protocol.createDecoder(), pending = [], outbound = [], seen = Object.create(null), seenCount = 0;
    var inIdle = false;
    var generation = 0, instance = Date.now().toString(16) + '-' + Math.random().toString(16).slice(2);
    var events = [], dropped = 0, sequence = 0, baseline = null, state = 'not_started';
    var writeConsumed = false, restoreConsumed = false, observed = false;
    function record(kind, d, m, v, diff) {
        if (d !== device || (m !== null && m !== mapping)) return;
        var item = { seq: ++sequence, time: Date.now(), kind: kind, value: v };
        if (typeof diff === 'number' && isFinite(diff)) item.diff = diff;
        if (events.length === 64) { events.shift(); dropped++; }
        events.push(item);
    }
    binding.mOnValueChange = function (d, m, v, diff) { record('binding', d, m, v, diff); };
    surface.mOnProcessValueChange = function (d, v, diff) { record('surface', d, null, v, diff); };
    value.mOnProcessValueChange = function (d, m, v) { record('host', d, m, v); };
    function check() {
        access.update(mapping);
        var id = channel.getRuntimeID(mapping), uid = channel.getUniqueIDString(mapping);
        if (typeof id !== 'number' || !isFinite(id) || Math.floor(id) !== id || id > 9007199254740991 || id < 0 || uid !== UID || access.getObjectUniqueIDString(mapping, id) !== UID) throw new Error('IDENTITY_MISMATCH');
        var count = access.getNumberOfParameters(mapping, id), hits = 0;
        if (typeof count !== 'number' || !isFinite(count) || Math.floor(count) !== count || count > 9007199254740991 || count < 0 || count > 4096) throw new Error('PARAMETER_COUNT');
        for (var i = 0; i < count; i++) if (access.getParameterTagByIndex(mapping, id, i) === TAG) hits++;
        if (hits !== 1) throw new Error('TAG_MISMATCH');
        var locked = access.getParameterEditLockState(mapping, id, TAG);
        var current = access.getParameterProcessValue(mapping, id, TAG);
        if (locked !== false || typeof current !== 'number' || !isFinite(current) || current < 0 || current > 1) throw new Error('LOCKED_OR_INVALID');
        return { objectId: id, uniqueId: uid, tag: TAG, locked: locked, value: current };
    }
    function run(req) {
        if (req.op === 'status' && req.session === undefined) return { session: session, arm: arm, state: state, target: target };
        if (req.session !== session || !session) throw new Error('SESSION_MISMATCH');
        if (req.op === 'baseline') {
            if (writeConsumed || baseline) throw new Error('BASELINE_CONSUMED');
            baseline = check();
            if (Math.abs(baseline.value - target) <= EPS) { baseline = null; throw new Error('TARGET_ALREADY_PRESENT'); }
            return { baseline: baseline, state: state };
        }
        if (req.op === 'write') {
            if (writeConsumed || !baseline) throw new Error('WRITE_NOT_ADMITTED');
            var before = check();
            if (before.objectId !== baseline.objectId || Math.abs(before.value - baseline.value) > EPS) throw new Error('BASELINE_CHANGED');
            if (Date.now() >= req.deadline) throw new Error('DEADLINE_EXPIRED');
            writeConsumed = true; state = 'unknown'; req._submitted = true;
            surface.setProcessValue(device, target);
            return { state: state, before: before, target: target };
        }
        if (req.op === 'read') {
            var read = check();
            if (baseline && read.objectId !== baseline.objectId) throw new Error('IDENTITY_CHANGED');
            if (writeConsumed && !restoreConsumed && Math.abs(read.value - target) <= EPS) { observed = true; state = 'target_observed'; }
            if (restoreConsumed && Math.abs(read.value - baseline.value) <= EPS) state = 'restored_observed';
            return { state: state, read: read, events: events.slice(), droppedEvents: dropped };
        }
        if (req.op === 'restore') {
            if (!observed || restoreConsumed || !baseline) throw new Error('RESTORE_NOT_ADMITTED');
            var prior = check();
            if (prior.objectId !== baseline.objectId || Math.abs(prior.value - target) > EPS) throw new Error('TARGET_NOT_CURRENT');
            if (Date.now() >= req.deadline) throw new Error('DEADLINE_EXPIRED');
            restoreConsumed = true; state = 'restore_unknown'; req._submitted = true;
            surface.setProcessValue(device, baseline.value);
            return { state: state, before: prior, target: baseline.value };
        }
        throw new Error('INVALID_OPERATION');
    }
    function respond(response) {
        var frames = protocol.encode(response);
        if (outbound.length + frames.length > 1024) return;
        outbound = outbound.concat(frames);
    }
    function validDeadline(deadline) {
        return typeof deadline === 'number' && isFinite(deadline) && Math.floor(deadline) === deadline &&
            deadline >= 0 && deadline <= 9007199254740991;
    }
    function reject(req, code, execution) {
        respond({ v: 1, id: req.id, ok: false, error: code, execution: execution, state: state });
    }
    input.mOnSysex = function (d, bytes) {
        if (d !== device || !session) return;
        var req; try { req = decoder.accept(bytes, Date.now()); } catch (_) { return; }
        if (!req) return;
        if (seen[req.id]) { reject(req, 'DUPLICATE_ID', 'prior_outcome_unknown'); return; }
        if (seenCount >= 256) { reject(req, 'REQUEST_LIMIT', 'not_started'); return; }
        seen[req.id] = true; seenCount++;
        if (!validDeadline(req.deadline)) { reject(req, 'INVALID_DEADLINE', 'not_started'); return; }
        if (Date.now() >= req.deadline) { reject(req, 'DEADLINE_EXPIRED', 'not_started'); return; }
        if (pending.length >= 8) { reject(req, 'QUEUE_FULL', 'not_started'); return; }
        pending.push(req);
    };
    page.mOnActivate = function (d, m) {
        device = d; mapping = m; session = instance + '-' + (++generation); pending = []; outbound = []; decoder.reset();
        baseline = null; observed = false; if (!writeConsumed) state = 'not_started';
        access.activate(m); record('activate', d, m, 0);
    };
    page.mOnDeactivate = function (d, m) {
        if (d !== device || m !== mapping) return;
        access.deactivate(m); device = null; mapping = null; session = null; pending = []; outbound = []; decoder.reset(); baseline = null; observed = false;
    };
    page.mOnIdle = function (d, m) {
        if (d !== device || m !== mapping || inIdle) return;
        inIdle = true;
        try {
            if (pending.length && outbound.length === 0) {
                var req = pending.shift(), result;
                if (Date.now() >= req.deadline) {
                    reject(req, 'DEADLINE_EXPIRED', 'not_started');
                } else {
                    req._submitted = false;
                    try { result = { v: 1, id: req.id, ok: true, data: run(req) }; }
                    catch (e) { result = { v: 1, id: req.id, ok: false, error: String(e.message || e).slice(0, 128), state: state };
                        result.execution = req._submitted ? 'unknown' : 'not_started'; }
                    respond(result);
                }
            }
            if (outbound.length) output.sendMidi(d, outbound.shift());
        } finally { inIdle = false; }
    };
    return { deviceDriver: driver };
}
exports.createController = createController;
