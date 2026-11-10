'use strict';

// DIAGNOSTIC ONLY (session 30). Not a production controller and never a selectable backend.
// It rebuilds the production binding groups on separate mapping pages so that one owned
// Cubase lifetime can show which page content stops surface-to-host propagation.
// The three lifecycle trace lines are emitted so the owned-launch readiness gate can
// observe this script; a separate DIAGNOSTIC line marks every console record.
var protocol = require('./protocol');
var commandSample = require('./command-sample');
var PROFILE = 'binding-scale-30';
var MAX_POOL = 2800;

function createController(api, logger) {
    var driver = api.makeDeviceDriver('CubaseAI', 'MCP', 'CubaseAI MCP');
    var input = driver.mPorts.makeMidiInput('CubaseAI MCP To Cubase');
    var output = driver.mPorts.makeMidiOutput('CubaseAI MCP From Cubase');
    var detection = driver.makeDetectionUnit().detectPortPair(input, output);
    detection.expectInputNameEquals('CubaseAI MCP To Cubase');
    detection.expectOutputNameEquals('CubaseAI MCP From Cubase');
    var surface = driver.mSurface;
    var decoder = protocol.createDecoder();
    var pages = [];
    var pool = [];
    var counters = { surface: 0, host: 0, display: 0 };
    var events = [];
    var pending = [], outbound = [], seen = Object.create(null), seenCount = 0;
    var device = null, mapping = null, active = -1, generation = 0, loggedIdle = false, busy = false;
    var state = null;

    function trace(text) { if (logger && typeof logger.log === 'function') logger.log('[CubaseAI MCP] ' + text); }
    function note(kind, value) {
        if (events.length >= 96) events.shift();
        events.push({ t: Date.now(), page: active, kind: kind, value: typeof value === 'number' ? value : String(value) });
    }
    function poolVar(index) {
        if (index >= MAX_POOL) throw new Error('POOL_LIMIT');
        while (pool.length <= index) {
            var created = surface.makeCustomValueVariable('p' + pool.length);
            created.mOnProcessValueChange = function () { counters.surface++; };
            pool.push(created);
        }
        return pool[index];
    }
    function hostCounter() { counters.host++; }
    function displayCounter() { counters.display++; }

    // ---- probe surface values ---------------------------------------------------------
    // A set is created either before any mapping page exists ("early", the documented
    // script order) or after a page object was already made ("late", the order used by the
    // production controller up to revision 3.13).
    function makeProbeSet(suffix, noteC, noteE, ccD, ccG) {
        function customProbe(name) {
            var value = surface.makeCustomValueVariable(name + suffix);
            value.mOnProcessValueChange = function (activeDevice, current) { if (activeDevice === device) note('s' + name, current); };
            return value;
        }
        var set = { suffix: suffix, noteC: noteC, noteE: noteE, ccD: ccD, ccG: ccG };
        set.A = customProbe('A');              // script -> value binding (metronome active)
        set.B = customProbe('B');              // script pulse -> filtered command binding (cycle)
        set.B2 = customProbe('B2');            // script pulse -> unfiltered command binding (metronome)
        set.D = customProbe('D');              // MIDI CC -> custom variable -> value binding (click level)
        set.D.mMidiBinding.setInputPort(input).setIsConsuming(true).bindToControlChange(0, ccD);
        set.E = customProbe('E');              // MIDI note -> custom variable -> command binding (metronome)
        set.E.mMidiBinding.setInputPort(input).setIsConsuming(true).bindToNote(0, noteE);
        set.F = customProbe('F');              // observer for cycle active
        set.H = customProbe('H');              // script -> bank channel 0 pan (page option)
        set.C = surface.makeButton(suffix ? 2 : 0, 0, 1, 1).mSurfaceValue;   // MIDI note -> button -> command binding (cycle)
        set.C.mMidiBinding.setInputPort(input).setIsConsuming(true).bindToNote(0, noteC);
        set.C.mOnProcessValueChange = function (activeDevice, current) { if (activeDevice === device) note('sC', current); };
        set.G = surface.makeKnob(suffix ? 3 : 1, 0, 1, 1).mSurfaceValue;     // MIDI CC -> knob -> bank channel 0 volume (page option)
        set.G.mMidiBinding.setInputPort(input).setIsConsuming(true).bindToControlChange(0, ccG);
        set.G.mOnProcessValueChange = function (activeDevice, current) { if (activeDevice === device) note('sG', current); };
        return set;
    }
    var early = makeProbeSet('', 60, 61, 20, 21);

    // ---- production group replicas ---------------------------------------------------
    function bindValue(ctx, hostValue) {
        var slot = ctx.n++;
        try {
            if (!hostValue) throw new Error('missing host value');
            var binding = ctx.page.makeValueBinding(poolVar(slot), hostValue);
            if (!binding) throw new Error('no value binding');
            if (ctx.faithful) {
                hostValue.mOnProcessValueChange = hostCounter;
                try { hostValue.mOnDisplayValueChange = displayCounter; } catch (ignored) {}
            }
            ctx.bindings++;
        } catch (error) { ctx.errors++; ctx.lastError = String(error && error.message || error).slice(0, 160); }
    }
    function bindAction(ctx, action) {
        var slot = ctx.n++;
        try {
            if (!action) throw new Error('missing host action');
            var binding = ctx.page.makeActionBinding(poolVar(slot), action).filterByValue(1);
            if (!binding) throw new Error('no action binding');
            ctx.bindings++;
        } catch (error) { ctx.errors++; ctx.lastError = String(error && error.message || error).slice(0, 160); }
    }
    function bindCommand(ctx, category, name, filtered) {
        var slot = ctx.n++;
        try {
            var binding = ctx.page.makeCommandBinding(poolVar(slot), category, name);
            if (filtered) binding = binding.filterByValue(1);
            if (!binding) throw new Error('no command binding');
            ctx.bindings++;
        } catch (error) { ctx.errors++; ctx.lastError = String(error && error.message || error).slice(0, 160); }
    }
    function field(object, name) { try { return object ? object[name] : null; } catch (error) { return null; } }
    function fields(ctx, object, names) { names.forEach(function (name) { bindValue(ctx, field(object, name)); }); }
    var PLUGIN_FIELDS = ['mOn', 'mBypass', 'mAutomationRead', 'mAutomationWrite'];
    var FILTER_FIELDS = ['mBypass', 'mGain', 'mPhaseSwitch', 'mHighCutOn', 'mHighCutFreq', 'mHighCutSlope', 'mLowCutOn', 'mLowCutFreq', 'mLowCutSlope'];
    var EQ_FIELDS = ['mGain', 'mFreq', 'mQ', 'mOn', 'mFilterType'];
    var STRIPS = ['mGate', 'mCompressor', 'mLimiter', 'mSaturator', 'mTools'];

    function parameterBank(ctx, slot) {
        var bank = field(slot, 'mParameterBankZone');
        for (var index = 0; index < 8; index++) {
            var value = null;
            try { value = bank.makeParameterValue(); } catch (ignored) {}
            bindValue(ctx, value);
        }
        ['mPrevBank', 'mNextBank', 'mResetBank'].forEach(function (name) { bindAction(ctx, field(field(bank, 'mAction'), name)); });
    }
    function sends(ctx, channel, name, names, withBypass) {
        var folder = field(channel, name), count = 0;
        try { count = folder.getSize(); } catch (ignored) {}
        if (typeof count !== 'number' || count < 0 || count > 32) count = 0;
        for (var index = 0; index < count; index++) {
            var slot = null;
            try { slot = folder.getByIndex(index); } catch (ignored) {}
            fields(ctx, slot, names);
        }
        if (withBypass) bindValue(ctx, field(folder, 'mBypass'));
    }
    function quick(ctx, collection) {
        for (var index = 0; index < 8; index++) {
            var value = null;
            try { if (index < collection.getSize()) value = collection.getByIndex(index); } catch (ignored) {}
            bindValue(ctx, value);
        }
    }
    function insertViewers(ctx, effects, label) {
        var count = 0;
        try { count = api.mDefaults.getNumberOfInsertEffectSlots(); } catch (ignored) {}
        if (typeof count !== 'number' || count < 0 || count > 16) count = 0;
        var kinds = [['all', -1], ['empty', -1], ['occupied', -1]];
        for (var slot = 0; slot < count; slot++) kinds.push(['slot', slot]);
        kinds.forEach(function (kind) {
            var viewer = null;
            try {
                viewer = effects.makeInsertEffectViewer(label + ' ' + kind[0] + (kind[1] < 0 ? '' : '.' + kind[1]));
                if (kind[0] === 'empty') viewer = viewer.includeEmptySlotsOnly();
                else if (kind[0] === 'occupied') viewer = viewer.excludeEmptySlots();
                else if (kind[0] === 'slot') viewer = viewer.accessSlotAtIndex(kind[1]);
            } catch (error) { ctx.errors++; ctx.lastError = String(error && error.message || error).slice(0, 160); viewer = null; }
            if (!viewer) return;
            fields(ctx, viewer, PLUGIN_FIELDS);
            ['mPrev', 'mNext', 'mReset'].forEach(function (name) { bindAction(ctx, field(field(viewer, 'mAction'), name)); });
            parameterBank(ctx, viewer);
        });
    }
    function strips(ctx, effects) {
        var strip = field(effects, 'mStripEffects');
        STRIPS.forEach(function (name) {
            var slot = field(strip, name);
            fields(ctx, slot, PLUGIN_FIELDS);
            parameterBank(ctx, slot);
        });
    }
    var groups = {
        transport: function (ctx) {
            // mCycleActive, mMetronomeActive and mMetronomeClickLevel are bound by the probes on every page.
            fields(ctx, field(ctx.host.mTransport, 'mValue'), ['mStart', 'mStop', 'mRecord', 'mRewind', 'mForward']);
        },
        track: function (ctx) {
            var values = field(ctx.channel, 'mValue');
            fields(ctx, values, ['mVolume', 'mPan', 'mMute', 'mSolo', 'mRecordEnable', 'mMonitorEnable', 'mAutomationRead',
                'mAutomationWrite', 'mVUMeter', 'mVUMeterMax', 'mVUMeterClip', 'mVUMeterPeak']);
        },
        trackFilterEq: function (ctx) {
            fields(ctx, field(ctx.channel, 'mPreFilter'), FILTER_FIELDS);
            var eq = field(ctx.channel, 'mChannelEQ');
            for (var band = 1; band <= 4; band++) fields(ctx, field(eq, 'mBand' + band), EQ_FIELDS);
        },
        trackSends: function (ctx) {
            sends(ctx, ctx.channel, 'mSends', ['mOn', 'mPrePost', 'mLevel'], false);
            sends(ctx, ctx.channel, 'mCueSends', ['mOn', 'mPrePost', 'mLevel', 'mPan'], true);
        },
        trackInstrument: function (ctx) {
            var slot = field(ctx.channel, 'mInstrumentPluginSlot');
            fields(ctx, slot, PLUGIN_FIELDS);
            parameterBank(ctx, slot);
        },
        trackStrips: function (ctx) { strips(ctx, field(ctx.channel, 'mInsertAndStripEffects')); },
        trackInserts: function (ctx) { insertViewers(ctx, field(ctx.channel, 'mInsertAndStripEffects'), 'diag track'); },
        quickControls: function (ctx) {
            quick(ctx, field(ctx.channel, 'mQuickControls'));
            quick(ctx, ctx.host.mFocusedQuickControls);
            bindValue(ctx, field(ctx.host.mFocusedQuickControls, 'mFocusLockedValue'));
        },
        controlRoom: function (ctx) {
            var room = field(ctx.host, 'mControlRoom');
            fields(ctx, room, ['mAlertDimActiveValue', 'mTalkbackActiveValue', 'mTalkbackDimLevelValue', 'mListenDimLevelValue',
                'mReferenceLevelValue', 'mSelectNextDownmixPresetValue']);
            fields(ctx, field(room, 'mMainChannel'), ['mLevelValue', 'mMuteValue', 'mBypassInserts', 'mSelectSourceMonitorMixValue',
                'mSelectSourceExternalInputValue', 'mListenEnabledValue', 'mListenLevelValue', 'mDimActiveValue',
                'mMetronomeClickActiveValue', 'mMetronomeClickLevelValue', 'mMetronomeClickPanValue', 'mReferenceLevelEnabledValue']);
        },
        bankBasic: function (ctx) {
            ctx.zone = null; ctx.bankChannels = [];
            try { ctx.zone = ctx.host.mMixConsole.makeMixerBankZone('diag replica'); } catch (error) { ctx.errors++; ctx.lastError = String(error.message || error).slice(0, 160); }
            ['mPrevBank', 'mNextBank', 'mShiftLeft', 'mShiftRight', 'mResetBank'].forEach(function (name) {
                bindAction(ctx, field(field(ctx.zone, 'mAction'), name));
            });
            for (var index = 0; index < 8; index++) {
                var channel = null;
                try { channel = ctx.zone.makeMixerBankChannel(); } catch (ignored) {}
                ctx.bankChannels.push(channel);
                fields(ctx, field(channel, 'mValue'), ['mVolume', 'mPan', 'mMute', 'mSolo', 'mRecordEnable', 'mMonitorEnable', 'mSelected',
                    'mAutomationRead', 'mAutomationWrite', 'mVUMeter', 'mVUMeterMax', 'mVUMeterClip', 'mVUMeterPeak']);
            }
        },
        bankFilterEqSends: function (ctx) {
            (ctx.bankChannels || []).forEach(function (channel) {
                fields(ctx, field(channel, 'mPreFilter'), FILTER_FIELDS);
                var eq = field(channel, 'mChannelEQ');
                for (var band = 1; band <= 4; band++) fields(ctx, field(eq, 'mBand' + band), EQ_FIELDS);
                sends(ctx, channel, 'mSends', ['mOn', 'mPrePost', 'mLevel'], false);
                sends(ctx, channel, 'mCueSends', ['mOn', 'mPrePost', 'mLevel', 'mPan'], true);
                quick(ctx, field(channel, 'mQuickControls'));
            });
        },
        bankInstrumentStrips: function (ctx) {
            (ctx.bankChannels || []).forEach(function (channel) {
                var slot = field(channel, 'mInstrumentPluginSlot');
                fields(ctx, slot, PLUGIN_FIELDS);
                parameterBank(ctx, slot);
                strips(ctx, field(channel, 'mInsertAndStripEffects'));
            });
        },
        bankInserts: function (ctx) {
            (ctx.bankChannels || []).forEach(function (channel, index) {
                insertViewers(ctx, field(channel, 'mInsertAndStripEffects'), 'diag bank ' + index);
            });
        },
        commands: function (ctx) {
            bindCommand(ctx, 'Edit', 'Undo', true);
            bindCommand(ctx, 'Edit', 'Redo', true);
            bindCommand(ctx, 'Quantize Category', 'Quantize', true);   // production 3.13 name; absent from the installed list
        },
        commandCapacity: function (ctx) {
            commandSample.forEach(function (pair) { bindCommand(ctx, pair[0], pair[1], false); });
        },
        countSimple: function (ctx) {
            // Count-only comparison: many plain mixer values without viewers, strips or parameter banks.
            for (var zoneIndex = 0; zoneIndex < 36; zoneIndex++) {
                var zone = null;
                try { zone = ctx.host.mMixConsole.makeMixerBankZone('diag count ' + zoneIndex); } catch (ignored) {}
                for (var index = 0; index < 8; index++) {
                    var channel = null;
                    try { channel = zone.makeMixerBankChannel(); } catch (ignored) {}
                    fields(ctx, field(channel, 'mValue'), ['mVolume', 'mPan', 'mMute', 'mSolo', 'mRecordEnable', 'mMonitorEnable',
                        'mAutomationRead', 'mAutomationWrite']);
                }
            }
        }
    };

    // ---- pages -----------------------------------------------------------------------
    function makePage(name, groupNames, options) {
        var index = pages.length;
        var page = options && options.page ? options.page : driver.mMapping.makePage(name);
        var set = options && options.set ? options.set : early;
        var host = page.mHostAccess;
        var record = { name: name, page: page, set: set, groups: groupNames, bindings: 0, errors: 0, lastError: null, probeErrors: [],
            metro: null, cycle: null, click: null, volume: null, pan: null, bindingEvents: 0, transportAccess: null, mixerAccess: null };
        pages.push(record);
        var transport = host.mTransport.mValue;
        function probe(label, make) {
            try {
                var binding = make();
                if (binding) binding.mOnValueChange = function (activeDevice, activeMapping, current) {
                    if (activeDevice === device && activeMapping === mapping) { record.bindingEvents++; note('b' + label, current); }
                };
            } catch (error) { record.probeErrors.push(label + ': ' + String(error && error.message || error).slice(0, 120)); }
        }
        function observe(hostValue, key, label) {
            hostValue.mOnProcessValueChange = function (activeDevice, activeMapping, current) {
                if (activeDevice === device && activeMapping === mapping && active === index) { record[key] = current; note('h' + label, current); }
            };
        }
        probe('A', function () { return page.makeValueBinding(set.A, transport.mMetronomeActive); });
        probe('B', function () { return page.makeCommandBinding(set.B, 'Transport', 'Cycle').filterByValue(1); });
        probe('B2', function () { return page.makeCommandBinding(set.B2, 'Transport', 'Metronome On'); });
        probe('C', function () { return page.makeCommandBinding(set.C, 'Transport', 'Cycle'); });
        probe('D', function () { return page.makeValueBinding(set.D, transport.mMetronomeClickLevel).setValueTakeOverModeJump(); });
        probe('E', function () { return page.makeCommandBinding(set.E, 'Transport', 'Metronome On'); });
        probe('F', function () { return page.makeValueBinding(set.F, transport.mCycleActive); });
        try {
            observe(transport.mMetronomeActive, 'metro', 'Metro');
            observe(transport.mCycleActive, 'cycle', 'Cycle');
            observe(transport.mMetronomeClickLevel, 'click', 'Click');
        } catch (error) { record.probeErrors.push('observe: ' + String(error && error.message || error).slice(0, 120)); }
        if (options && options.bankProbe) {
            try {
                var probeZone = host.mMixConsole.makeMixerBankZone('diag probe');
                var probeChannel = probeZone.makeMixerBankChannel();
                probe('G', function () { return page.makeValueBinding(set.G, probeChannel.mValue.mVolume).setValueTakeOverModeJump(); });
                probe('H', function () { return page.makeValueBinding(set.H, probeChannel.mValue.mPan); });
                observe(probeChannel.mValue.mVolume, 'volume', 'Volume');
                observe(probeChannel.mValue.mPan, 'pan', 'Pan');
            } catch (error) { record.probeErrors.push('bank probe: ' + String(error && error.message || error).slice(0, 120)); }
        }
        try {
            record.transportAccess = host.makeDirectAccess(host.mTransport);
            record.mixerAccess = host.makeDirectAccess(host.mMixConsole);
        } catch (error) { record.probeErrors.push('direct access: ' + String(error && error.message || error).slice(0, 120)); }
        var ctx = { page: page, host: host, channel: null, n: 0, bindings: 0, errors: 0, lastError: null,
            faithful: !options || options.faithful !== false };
        try { ctx.channel = host.mTrackSelection.mMixerChannel; } catch (ignored) {}
        groupNames.forEach(function (groupName) {
            try { groups[groupName](ctx); }
            catch (error) { ctx.errors++; ctx.lastError = groupName + ': ' + String(error && error.message || error).slice(0, 140); }
        });
        record.bindings = ctx.bindings; record.errors = ctx.errors; record.lastError = ctx.lastError;
        page.mOnActivate = function (activeDevice, activeMapping) {
            device = activeDevice; mapping = activeMapping; active = index; generation++;
            record.metro = null; record.cycle = null; record.click = null; record.volume = null; record.pan = null; record.bindingEvents = 0;
            ['transportAccess', 'mixerAccess'].forEach(function (key) {
                try { if (record[key]) record[key].activate(activeMapping); }
                catch (error) { record.probeErrors.push(key + ' activate: ' + String(error && error.message || error).slice(0, 100)); }
            });
            trace(index === 0 ? 'mapping activated' : 'diagnostic page activated ' + index);
            note('activate', index);
        };
        page.mOnDeactivate = function (activeDevice, activeMapping) {
            if (activeDevice !== device || activeMapping !== mapping) return;
            ['transportAccess', 'mixerAccess'].forEach(function (key) {
                try { if (record[key]) record[key].deactivate(activeMapping); } catch (ignored) {}
            });
            if (index === 0) trace('diagnostic page 0 left');
            mapping = null; active = -1;
        };
        page.mOnIdle = idle;
        return record;
    }

    function directRead(record) {
        var result = { cycle: null, metronome: null, outputVolume: null, error: null };
        try {
            var transportAccess = record.transportAccess, base = transportAccess.getBaseObjectID(mapping);
            result.cycle = transportAccess.getParameterProcessValue(mapping, base, 4022);
            result.metronome = transportAccess.getParameterProcessValue(mapping, base, 4099);
            var mixer = record.mixerAccess, mixerBase = mixer.getBaseObjectID(mapping);
            var count = mixer.getNumberOfChildObjects(mapping, mixerBase);
            for (var index = 0; index < count && index < 64; index++) {
                var child = mixer.getChildObjectID(mapping, mixerBase, index);
                if (mixer.getObjectTypeName(mapping, child) === 'OutputChannel') {
                    result.outputVolume = mixer.getParameterProcessValue(mapping, child, 1025);
                    break;
                }
            }
        } catch (error) { result.error = String(error && error.message || error).slice(0, 160); }
        return result;
    }

    function statusData() {
        return { profile: PROFILE, page: active, generation: generation, poolSize: pool.length, counters: counters,
            pages: pages.map(function (record) {
                return { name: record.name, groups: record.groups, bindings: record.bindings, errors: record.errors,
                    lastError: record.lastError, probeErrors: record.probeErrors, probeSet: record.set.suffix ? 'late' : 'early',
                    inputs: { noteC: record.set.noteC, noteE: record.set.noteE, ccD: record.set.ccD, ccG: record.set.ccG } };
            }) };
    }

    function handle(request) {
        var args = request.args || {};
        if (request.op === 'diag.status') return statusData();
        if (active < 0 || !mapping) throw new Error('NO_ACTIVE_PAGE');
        var record = pages[active];
        if (request.op === 'diag.read') {
            return { page: active, generation: generation, metro: record.metro, cycle: record.cycle, click: record.click,
                volume: record.volume, pan: record.pan, bindingEvents: record.bindingEvents, direct: directRead(record),
                counters: counters, events: events.slice() };
        }
        if (request.op === 'diag.clear') { events = []; return { cleared: true }; }
        if (request.op === 'diag.page') {
            if (typeof args.index !== 'number' || !pages[args.index]) throw new Error('INVALID_PAGE');
            if (args.index === active) return { page: active, switching: false };
            pages[args.index].page.mAction.mActivate.trigger(mapping);
            return { requested: args.index, switching: true };
        }
        if (request.op === 'diag.script') {
            var probes = record.set;
            if (args.probe === 'A') { probes.A.setProcessValue(device, args.value === 1 ? 1 : 0); return { probe: 'A', value: args.value === 1 ? 1 : 0 }; }
            if (args.probe === 'H') {
                if (typeof args.value !== 'number' || !(args.value >= 0 && args.value <= 1)) throw new Error('INVALID_VALUE');
                probes.H.setProcessValue(device, args.value); return { probe: 'H', value: args.value };
            }
            if (args.probe === 'B' || args.probe === 'B2') {
                var target = args.probe === 'B' ? probes.B : probes.B2;
                target.setProcessValue(device, 1); target.setProcessValue(device, 0);
                return { probe: args.probe, pulsed: true };
            }
            throw new Error('INVALID_PROBE');
        }
        throw new Error('UNKNOWN_OPERATION');
    }

    function send(response) {
        response.v = 1;
        var frames = protocol.encode(response);
        if (outbound.length + frames.length > 512) return;
        for (var index = 0; index < frames.length; index++) outbound.push(frames[index]);
    }

    input.mOnSysex = function (activeDevice, bytes) {
        if (activeDevice !== device) return;
        var request;
        try { request = decoder.accept(bytes, Date.now()); } catch (error) { return; }
        if (!request) return;
        if (seen[request.id] || seenCount >= 4096 || pending.length >= 32) {
            send({ id: request.id, ok: false, error: { code: 'NOT_ADMITTED', message: 'Duplicate, full or exhausted.' } });
            return;
        }
        seen[request.id] = true; seenCount++;
        pending.push(request);
    };

    function idle(activeDevice, activeMapping) {
        if (!loggedIdle && active === 0) {
            loggedIdle = true;
            trace('first idle: matching device=' + (activeDevice === device) + ', mapping=' + (activeMapping === mapping));
        }
        if (activeDevice !== device || activeMapping !== mapping || busy) return;
        busy = true;
        try {
            if (pending.length && outbound.length < 256) {
                var request = pending.shift();
                try {
                    if (typeof request.deadline !== 'number' || Date.now() >= request.deadline) throw new Error('REQUEST_EXPIRED');
                    send({ id: request.id, ok: true, data: handle(request) });
                } catch (error) {
                    send({ id: request.id, ok: false, error: { code: String(error && error.message || error).slice(0, 80), message: 'Diagnostic request failed.' } });
                }
            }
            for (var index = 0; index < 4 && outbound.length; index++) output.sendMidi(activeDevice, outbound.shift());
        } finally { busy = false; }
    }

    driver.mOnActivate = function () { trace('device activated'); };
    driver.mOnDeactivate = function () { trace('device deactivated'); };

    var replica = ['transport', 'track', 'trackFilterEq', 'trackSends', 'trackInstrument', 'trackStrips', 'trackInserts',
        'quickControls', 'controlRoom', 'bankBasic', 'bankFilterEqSends', 'bankInstrumentStrips', 'bankInserts'];
    makePage('CubaseAI MCP', []);                                              // 0: probes only
    makePage('diag bank probe', [], { bankProbe: true });                      // 1: probes + one bank channel
    makePage('diag commands', ['commands']);                                   // 2: three production command bindings
    makePage('diag command capacity', ['commandCapacity']);                    // 3: 200 command bindings
    makePage('diag replica', replica, { bankProbe: false });                   // 4: production value/action groups
    makePage('diag replica commands', replica.concat(['commands']));           // 5: plus production commands
    makePage('diag count', ['countSimple'], { faithful: false });              // 6: comparable count, plain values
    makePage('diag selected track', ['transport', 'track', 'trackFilterEq', 'trackSends', 'trackInstrument', 'trackStrips',
        'trackInserts', 'quickControls', 'controlRoom']);                      // 7: replica without the mixer bank
    makePage('diag bank basic', ['bankBasic']);                                // 8: bank zone basic values only
    makePage('diag bank full', ['bankBasic', 'bankFilterEqSends', 'bankInstrumentStrips', 'bankInserts']); // 9: bank only
    // Creation-order comparison. The page object for index 10 exists before the "late" surface
    // values are made (production order); index 11 is made after them and binds the same values.
    var latePage = driver.mMapping.makePage('diag late surface');
    var late = makeProbeSet('L', 62, 63, 22, 23);
    makePage('diag late surface', [], { page: latePage, set: late, bankProbe: true });      // 10
    makePage('diag late surface next', [], { set: late, bankProbe: true });                 // 11
    makePage('diag early on late page order', [], { bankProbe: true });                     // 12: early set, page made last

    trace('DIAGNOSTIC ' + PROFILE + ' (not the production controller)');
    // The owned launcher waits for the construction line of the production revision before it reports
    // readiness. The session-30 runs were made while 3.13 was current; a later run has to print the
    // revision that remote/controller.js declares at that time.
    trace('controller constructed 2026-11-10-coverage-3.13');
    return { deviceDriver: driver, pages: pages, status: statusData };
}

module.exports = { createController: createController };
