'use strict';
var protocol = require('./protocol');
function createController(api, logger) {
    var driver = api.makeDeviceDriver('CubaseAI', 'MCP', 'CubaseAI MCP');
    var input = driver.mPorts.makeMidiInput('CubaseAI MCP To Cubase');
    var output = driver.mPorts.makeMidiOutput('CubaseAI MCP From Cubase');
    var detection = driver.makeDetectionUnit().detectPortPair(input, output);
    detection.expectInputNameEquals('CubaseAI MCP To Cubase');
    detection.expectOutputNameEquals('CubaseAI MCP From Cubase');
    var button = driver.mSurface.makeButton(0, 0, 1, 1).mSurfaceValue;
    button.mMidiBinding.setInputPort(input).setIsConsuming(true).bindToNote(0, 1);
    var page = driver.mMapping.makePage('CubaseAI MCP');
    var save = page.makeCommandBinding(button, 'File', 'Save');
    var time = page.mHostAccess.mTransport.mTimeDisplay;
    var device = null, mapping = null, session = null, tempo = null, stagedTempo = null, consumed = false;
    var generation = 0, instance = Date.now().toString(16), busy = false;
    var seen = Object.create(null), count = 0, pending = [], outbound = [], events = [];
    var decoder = protocol.createDecoder();
    function event(kind, d, m, value) {
        var e = { kind: kind, value: value, deviceMatches: d === device, mappingMatches: m === mapping, at: Date.now() };
        if (events.length === 16) events.shift();
        events.push(e);
        if (logger) logger.log('[minimal-save30] ' + kind + ' ' + value + ' device=' + e.deviceMatches + ' mapping=' + e.mappingMatches);
    }
    button.mOnProcessValueChange = function (d, v) { event('button', d, mapping, v); };
    save.mOnValueChange = function (d, m, v) { event('saveBinding', d, m, v); };
    time.mOnChangeTempoBPM = function (d, m, bpm) {
        event('tempo', d, m, bpm);
        if (typeof bpm === 'number' && isFinite(bpm)) {
            stagedTempo = { device: d, mapping: m, value: bpm };
            if (d === device && m === mapping) tempo = bpm;
        }
    };
    function send(r) { r.v = 1; var frames = protocol.encode(r); if (outbound.length + frames.length <= 128) outbound = outbound.concat(frames); }
    input.mOnSysex = function (d, bytes) {
        if (d !== device || !mapping) return;
        var r; try { r = decoder.accept(bytes, Date.now()); } catch (e) { return; }
        if (!r) return;
        if (seen[r.id] || count >= 128) { send({ id: r.id, ok: false, error: { code: 'ADMISSION_CONSUMED', execution: 'not_started' } }); return; }
        seen[r.id] = true; count++;
        if (typeof r.deadline !== 'number' || !isFinite(r.deadline) || Date.now() >= r.deadline || pending.length >= 8) {
            send({ id: r.id, ok: false, error: { code: 'EXPIRED_OR_FULL', execution: 'not_started' } }); return;
        }
        pending.push(r);
    };
    page.mOnActivate = function (d, m) {
        device = d; mapping = m; session = instance + '-' + (++generation);
        tempo = stagedTempo && stagedTempo.device === d && stagedTempo.mapping === m ? stagedTempo.value : null;
        event('activate', d, m, generation);
    };
    page.mOnDeactivate = function (d, m) { if (d === device && m === mapping) { device = null; mapping = null; session = null; pending = []; outbound = []; decoder.reset(); } };
    page.mOnIdle = function (d, m) {
        if (d !== device || m !== mapping || busy) return;
        busy = true;
        try {
            if (pending.length && !outbound.length) {
                var r = pending.shift(), submitted = false;
                try {
                    if (Date.now() >= r.deadline) throw new Error('DEADLINE_EXPIRED');
                    var a = r.args || {}, data;
                    if (r.op === 'diag.status') data = { profile: 'minimal-save30', session: session, tempo: tempo, canPerform: save.canPerform(mapping), consumed: consumed, events: events.slice() };
                    else {
                        if (a.session !== session) throw new Error('SESSION_MISMATCH');
                        if (r.op === 'diag.read') data = { tempo: tempo, canPerform: save.canPerform(mapping), events: events.slice() };
                        else if (r.op === 'diag.edit') {
                            if (consumed || tempo === null || a.expectedTempo !== tempo || tempo === 137.5) throw new Error('EDIT_NOT_ADMITTED');
                            if (Date.now() >= r.deadline) throw new Error('DEADLINE_EXPIRED');
                            consumed = true; submitted = true;
                            time.setTempoBPM(mapping, 137.5);
                            data = { execution: 'submitted', requestedTempo: 137.5 };
                        } else throw new Error('INVALID_OPERATION');
                    }
                    send({ id: r.id, ok: true, data: data });
                } catch (e) { send({ id: r.id, ok: false, error: { code: String(e.message || e), execution: submitted ? 'unknown' : 'not_started' } }); }
            }
            if (outbound.length) output.sendMidi(d, outbound.shift());
        } finally { busy = false; }
    };
    if (logger) logger.log('[minimal-save30] constructed');
    return { deviceDriver: driver };
}
module.exports = { createController: createController };
