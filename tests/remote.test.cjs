'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
const commands = require('../remote/commands.js');
const protocol = require('../remote/protocol.js');
const { createController } = require('../remote/controller.js');

test('large host maxima and error messages preserve compact handshake and bounded discovery', () => {
    const harness = fixture((api, state, { host, page }) => {
        const channel = host.mTrackSelection.mMixerChannel;
        channel.mSends = { getSize: () => 32, getByIndex: () => ({ mOn: {}, mPrePost: {}, mLevel: {} }) };
        channel.mCueSends = { mBypass: {}, getSize: () => 32,
            getByIndex: () => ({ mOn: {}, mPrePost: {}, mLevel: {}, mPan: {} }) };
        page.makeValueBinding = () => { throw new Error('unavailable-' + 'x'.repeat(5000)); };
    });
    assert.equal(harness.status.ok, true, JSON.stringify(harness.status));
    assert.equal(harness.status.data.bridgeRevision, '2026-11-10-coverage-3.5');
    let offset = 0;
    const keys = [];
    do {
        const reply = harness.call('controls.list', { offset, limit: 16 });
        assert.equal(reply.ok, true, JSON.stringify(reply));
        keys.push(...reply.data.controls.map(control => control.key));
        offset = reply.data.nextOffset;
    } while (offset !== null);
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(keys.includes('track.send.31.level'));
    assert.ok(keys.includes('track.cueSend.31.pan'));
    const allGroups = listAll(harness).groups;
    assert.equal(allGroups['track.cueSend'].count, 32);
    const first = harness.call('controls.list', { limit: 1 }).data.controls[0];
    assert.ok(first.error.message.length <= 129);
    expectError(harness.call('controls.list', { limit: 17 }), 'INVALID_ARGUMENT');
});

test('strip effect controls are bounded to declared slots and preserve track guards', () => {
    const harness = fixture();
    for (const slot of ['gate', 'compressor', 'limiter', 'saturator', 'tools']) {
        for (const field of ['on', 'bypass', 'automationRead', 'automationWrite']) {
            const key = `track.strip.${slot}.${field}`;
            assert.equal(harness.call('controls.get', { key }).data.control.available, true);
        }
    }
    expectError(harness.call('controls.set', { key: 'track.strip.gate.on', value: 1,
        expectedTrackUniqueId: 'different' }), 'TRACK_CHANGED');
    assert.equal(harness.call('controls.set', { key: 'track.strip.gate.on', value: 1,
        expectedTrackUniqueId: 'track-uid-2' }).data.execution, 'submitted');
    expectError(harness.call('controls.get', { key: 'track.strip.gate.edit' }), 'INVALID_CONTROL');
});

test('missing strip branches report unavailable without affecting other controls', () => {
    const harness = fixture((api, state, { host }) => { delete host.mTrackSelection.mMixerChannel.mInsertAndStripEffects; });
    const result = harness.call('controls.get', { key: 'track.strip.gate.on' }).data.control;
    assert.equal(result.available, false);
    assert.equal(result.error.code, 'API_UNAVAILABLE');
    assert.equal(harness.call('controls.get', { key: 'track.volume' }).data.control.available, true);
});

test('strip parameter pages bind eight values and invalidate plugin identity on track change', () => {
    let slot;
    const harness = fixture((api, state, { host }) => {
        slot = host.mTrackSelection.mMixerChannel.mInsertAndStripEffects.mStripEffects.mGate;
        slot.mParameterBankZone = { makeParameterValue: () => ({}), mAction: { mPrevBank: {}, mNextBank: {}, mResetBank: {} } };
    });
    for (let index = 0; index < 8; index++)
        assert.equal(harness.call('controls.get', { key: `track.strip.gate.parameter.${index}` }).data.control.available, true);
    expectError(harness.call('controls.set', { key: 'track.strip.gate.bank.next', value: 0.5 }), 'INVALID_VALUE');
    assert.equal(harness.call('controls.set', { key: 'track.strip.gate.bank.next', value: 1,
        expectedTrackUniqueId: 'track-uid-2' }).data.execution, 'submitted');
    slot.mOnChangePluginIdentity(harness.device, harness.currentMapping(), 'Gate', 'Vendor', '1', '3');
    assert.equal(listAll(harness).groups['track.strip.gate'].pluginIdentity.name, 'Gate');
    harness.state.selectedTrackId = 'track-new';
    assert.equal(listAll(harness).groups['track.strip.gate'].pluginIdentity, null);
});

test('long track identifiers remain exact in paged groups and error details', () => {
    const uniqueId = 'track-' + 'x'.repeat(300);
    let slot;
    const harness = fixture((api, state, { host }) => {
        state.selectedTrackId = uniqueId;
        slot = host.mTrackSelection.mMixerChannel.mInsertAndStripEffects.mStripEffects.mGate;
    });
    slot.mOnChangePluginIdentity(harness.device, harness.currentMapping(), 'Gate', 'Vendor', '1', '3');
    const groups = listAll(harness).groups;
    assert.equal(groups['track.identity'].uniqueId, uniqueId);
    assert.equal(groups['track.strip.gate'].pluginIdentity.trackUniqueId, uniqueId);
    const mismatch = harness.call('controls.set', { key: 'track.strip.gate.on', value: 1, expectedTrackUniqueId: 'other' });
    expectError(mismatch, 'TRACK_CHANGED');
    assert.equal(mismatch.error.details.currentUniqueId, uniqueId);
});

test('insert viewers use fixed filters, read-only values and track-guarded navigation', () => {
    const viewers = {}, filters = [];
    const harness = fixture((api, state, { host }) => {
        api.mDefaults.getNumberOfInsertEffectSlots = () => 2;
        host.mTrackSelection.mMixerChannel.mInsertAndStripEffects.makeInsertEffectViewer = name => {
            const viewer = { mOn: {}, mBypass: {}, mAutomationRead: {}, mAutomationWrite: {},
                mAction: { mPrev: {}, mNext: {}, mReset: {} },
                mParameterBankZone: { makeParameterValue: () => ({}), mAction: { mPrevBank: {}, mNextBank: {}, mResetBank: {} } },
                includeEmptySlotsOnly() { filters.push([name, 'empty']); return viewer; },
                excludeEmptySlots() { filters.push([name, 'occupied']); return viewer; },
                accessSlotAtIndex(index) { filters.push([name, 'slot', index]); return viewer; } };
            viewers[name] = viewer;
            return viewer;
        };
    });
    assert.deepEqual(filters, [['CubaseAI MCP empty', 'empty'], ['CubaseAI MCP occupied', 'occupied'],
        ['CubaseAI MCP slot.0', 'slot', 0], ['CubaseAI MCP slot.1', 'slot', 1]]);
    for (const group of ['all', 'empty', 'occupied', 'slot.0', 'slot.1']) {
        const key = `track.insert.${group}.parameter.0`;
        assert.equal(harness.call('controls.get', { key }).data.control.readOnly, true);
        expectError(harness.call('controls.set', { key, value: 0.5 }), 'READ_ONLY');
        expectError(harness.call('controls.get', { key: `track.insert.${group}.edit` }), 'INVALID_CONTROL');
    }
    expectError(harness.call('controls.set', { key: 'track.insert.slot.0.bank.next', value: 1 }), 'CONFIRMATION_REQUIRED');
    expectError(harness.call('controls.set', { key: 'track.insert.slot.0.bank.next', value: 1, expectedTrackUniqueId: 'wrong' }), 'TRACK_CHANGED');
    assert.equal(harness.call('controls.set', { key: 'track.insert.slot.0.bank.next', value: 1,
        expectedTrackUniqueId: 'track-uid-2' }).data.execution, 'submitted');
    viewers['CubaseAI MCP slot.0'].mOnChangePluginIdentity(harness.device, harness.currentMapping(), 'Plugin', 'Vendor', '1', '3');
    assert.equal(listAll(harness).groups['track.insert.slot.0'].pluginIdentity.trackUniqueId, 'track-uid-2');
    harness.state.selectedTrackId = 'new-track';
    assert.equal(listAll(harness).groups['track.insert.slot.0'].pluginIdentity, null);
    expectError(harness.call('controls.get', { key: 'track.insert.slot.2.on' }), 'INVALID_CONTROL');
});

test('insert viewer rejects unavailable filters and excessive host slot maxima', () => {
    const harness = fixture((api, state, { host }) => {
        api.mDefaults.getNumberOfInsertEffectSlots = () => 17;
        host.mTrackSelection.mMixerChannel.mInsertAndStripEffects.makeInsertEffectViewer = () => ({});
    });
    const groups = listAll(harness).groups;
    assert.equal(groups['track.insert.empty'].error.code, 'API_UNAVAILABLE');
    assert.equal(groups['track.insert.slots'].error.code, 'HOST_LIMIT_EXCEEDED');
    expectError(harness.call('controls.get', { key: 'track.insert.slot.0.on' }), 'INVALID_CONTROL');
});

test('Control Room bindings use declared host maxima and report missing values', () => {
    const harness = fixture((api, state, { host }) => {
        const slot = () => ({ ...Object.fromEntries(['mLevelValue', 'mMuteValue', 'mBypassInserts',
            'mSelectSourceMonitorMixValue', 'mSelectSourceExternalInputValue', 'mSelectSourceAuxValue',
            'mListenEnabledValue', 'mListenLevelValue', 'mDimActiveValue', 'mTalkbackEnabledValue',
            'mTalkbackLevelValue', 'mMetronomeClickActiveValue', 'mMetronomeClickLevelValue',
            'mMetronomeClickPanValue', 'mReferenceLevelEnabledValue'].map(field => [field, {}])),
            getSelectSourceCueValueByIndex(index) { assert.equal(index, 0); return {}; } });
        host.mControlRoom = {
            mMainChannel: slot(), mTalkbackActiveValue: {}, mSelectNextDownmixPresetValue: {},
            getSelectSourceExternalInputValueByIndex: () => ({}), getSelectTargetMonitorValueByIndex: () => ({}),
            getMaxCueChannels: () => 1, getCueChannelByIndex: index => { assert.equal(index, 0); return slot(); },
            getMaxPhonesChannels: () => 1, getPhonesChannelByIndex: index => { assert.equal(index, 0); return slot(); },
            getMaxExternalInputChannels: () => 1, getExternalInputChannelByIndex: () => slot(),
            getMaxTalkbackChannels: () => 1, getTalkbackChannelByIndex: () => slot(),
            getMaxMonitorChannels: () => 1, getMonitorChannelByIndex: () => slot()
        };
    });
    for (const key of ['controlRoom.talkbackActive', 'controlRoom.main.referenceLevelEnabled',
        'controlRoom.cue.0.sourceAux', 'controlRoom.phones.0.listenLevel',
        'controlRoom.externalInput.0.level', 'controlRoom.talkback.0.mute', 'controlRoom.monitor.0.bypassInserts',
        'controlRoom.sourceExternalInput.0', 'controlRoom.targetMonitor.0',
        'controlRoom.main.sourceCue.0', 'controlRoom.phones.0.sourceCue.0']) {
        assert.equal(harness.call('controls.get', { key }).data.control.available, true);
    }
    assert.equal(harness.call('controls.set', { key: 'controlRoom.cue.0.level', value: 0.5 }).data.execution, 'submitted');
    assert.equal(harness.call('controls.set', { key: 'controlRoom.nextDownmix', value: 1 }).data.execution, 'submitted');
    expectError(harness.call('controls.get', { key: 'controlRoom.cue.1.level' }), 'INVALID_CONTROL');
    expectError(harness.call('controls.set', { key: 'controlRoom.alertDimActive', value: 1 }), 'API_UNAVAILABLE');
});

test('mixer bank actions use fixed host actions and reject non-unit values', () => {
    const harness = fixture((api, state, { host }) => {
        host.mMixConsole.makeMixerBankZone = name => {
            assert.equal(name, 'CubaseAI MCP');
            return { mAction: Object.fromEntries(['mPrevBank', 'mNextBank', 'mShiftLeft', 'mShiftRight', 'mResetBank'].map(key => [key, {}])) };
        };
    });
    assert.equal(harness.call('controls.get', { key: 'mixer.bank.next' }).data.control.available, true);
    expectError(harness.call('controls.set', { key: 'mixer.bank.next', value: 0.5 }), 'INVALID_VALUE');
    assert.equal(harness.call('controls.set', { key: 'mixer.bank.next', value: 1 }).data.execution, 'submitted');
});

test('mixer bank slots require observed identity and invalidate feedback on navigation or reassignment', () => {
    const ids = Array.from({ length: 8 }, (_, index) => `bank-track-${index}`);
    const values = [];
    const harness = fixture((api, state, { host }) => {
        host.mMixConsole.makeMixerBankZone = () => {
            let index = 0;
            return { mAction: { mPrevBank: {}, mNextBank: {}, mShiftLeft: {}, mShiftRight: {}, mResetBank: {} },
                makeMixerBankChannel() {
                    const slot = index++;
                    const v = Object.fromEntries(['mVolume', 'mPan', 'mMute', 'mSolo', 'mRecordEnable', 'mMonitorEnable', 'mSelected',
                        'mAutomationRead', 'mAutomationWrite', 'mVUMeter', 'mVUMeterMax', 'mVUMeterClip', 'mVUMeterPeak'].map(name => [name, {}]));
                    values[slot] = v;
                    return { mValue: v, getUniqueIDString: () => ids[slot], getRuntimeID: () => slot + 100 };
                } };
        };
    });
    const key = 'mixer.channel.0.volume';
    expectError(harness.call('controls.set', { key, value: 0.5, expectedChannelUniqueId: ids[0] }), 'CHANNEL_UNOBSERVED');
    const item = harness.call('controls.get', { key }).data.control;
    assert.deepEqual(item.channel, { index: 0, uniqueId: ids[0], runtimeId: 100 });
    values[0].mVolume.mOnProcessValueChange(harness.device, harness.currentMapping(), 0.6);
    assert.equal(harness.call('controls.get', { key }).data.control.observed.channelUniqueId, ids[0]);
    assert.equal(harness.call('controls.set', { key, value: 0.5, expectedChannelUniqueId: ids[0] }).data.execution, 'submitted');
    harness.emit('track.volume', 0.8);
    assert.equal(harness.call('controls.get', { key: 'track.volume' }).data.control.observed.value, 0.8);
    assert.equal(harness.call('controls.set', { key: 'mixer.channel.0.selected', value: 1,
        expectedChannelUniqueId: ids[0] }).data.execution, 'submitted');
    assert.equal(harness.call('controls.get', { key: 'track.volume' }).data.control.observed, null);
    expectError(harness.call('controls.set', { key: 'mixer.channel.0.meter.level', value: 1, expectedChannelUniqueId: ids[0] }), 'READ_ONLY');
    ids[0] = 'bank-new';
    expectError(harness.call('controls.set', { key, value: 0.5, expectedChannelUniqueId: 'bank-track-0' }), 'CHANNEL_CHANGED');
    assert.equal(harness.call('controls.get', { key }).data.control.observed, null);
    assert.equal(harness.call('controls.get', { key }).data.control.channel.uniqueId, 'bank-new');
    assert.equal(harness.call('controls.set', { key: 'mixer.bank.next', value: 1 }).data.execution, 'submitted');
    expectError(harness.call('controls.set', { key, value: 0.5, expectedChannelUniqueId: 'bank-new' }), 'CHANNEL_UNOBSERVED');
    assert.equal(harness.call('controls.get', { key: 'mixer.channel.7.pan' }).data.control.channel.uniqueId, ids[7]);
    harness.deactivate();
    harness.activate();
    expectError(harness.call('controls.set', { key, value: 0.5, expectedChannelUniqueId: 'bank-new' }), 'STALE_SESSION');
});

test('bank EQ, filter and sends stay bound to observed channel identities', () => {
    const ids = Array.from({ length: 8 }, (_, i) => `id-${i}`), slots = [];
    const harness = fixture((api, state, { host }) => {
        host.mMixConsole.makeMixerBankZone = () => {
            let index = 0;
            return { makeMixerBankChannel() {
                const i = index++, band = () => ({ mGain: {}, mFreq: {}, mQ: {}, mOn: {}, mFilterType: {} });
                const slot = { mValue: {}, getUniqueIDString: () => ids[i], getRuntimeID: () => i,
                    mPreFilter: { mGain: {} }, mChannelEQ: { mBand1: band(), mBand2: band(), mBand3: band(), mBand4: band() },
                    mSends: { getSize: () => 1, getByIndex: n => { assert.equal(n, 0); return { mLevel: {} }; } },
                    mCueSends: { mBypass: {}, getSize: () => 1, getByIndex: n => { assert.equal(n, 0); return { mPan: {} }; } },
                    mQuickControls: { getSize: () => 8, getByIndex: () => ({}) },
                    mInstrumentPluginSlot: { mBypass: {} },
                    mInsertAndStripEffects: { mStripEffects: { mGate: { mOn: {} }, mTools: { mAutomationWrite: {} } } } };
                slots.push(slot); return slot;
            } };
        };
    });
    expectError(harness.call('controls.set', { key: 'mixer.channel.0.filter.gain', value: 0.5, expectedChannelUniqueId: ids[0] }), 'CHANNEL_UNOBSERVED');
    for (const key of ['mixer.channel.0.filter.gain', 'mixer.channel.0.eq.1.gain',
        'mixer.channel.0.send.0.level', 'mixer.channel.0.cueSend.0.pan', 'mixer.channel.0.cueSend.bypass',
        'mixer.channel.0.quick.7', 'mixer.channel.0.instrument.bypass',
        'mixer.channel.0.strip.gate.on', 'mixer.channel.0.strip.tools.automationWrite']) {
        assert.equal(harness.call('controls.get', { key }).data.control.available, true);
        assert.equal(harness.call('controls.set', { key, value: 0.5, expectedChannelUniqueId: ids[0] }).data.execution, 'submitted');
    }
    slots[0].mChannelEQ.mBand1.mGain.mOnProcessValueChange(harness.device, harness.currentMapping(), 0.4);
    ids[0] = 'changed';
    expectError(harness.call('controls.set', { key: 'mixer.channel.0.eq.1.gain', value: 0.5, expectedChannelUniqueId: 'id-0' }), 'CHANNEL_CHANGED');
    assert.equal(harness.call('controls.get', { key: 'mixer.channel.0.eq.1.gain' }).data.control.observed, null);
    expectError(harness.call('controls.get', { key: 'mixer.channel.0.eq.5.gain' }), 'INVALID_CONTROL');
    expectError(harness.call('controls.get', { key: 'mixer.channel.0.send.1.level' }), 'INVALID_CONTROL');
    assert.equal(harness.call('controls.get', { key: 'mixer.channel.0.filter.bypass' }).data.control.error.code, 'API_UNAVAILABLE');
    expectError(harness.call('controls.get', { key: 'mixer.channel.0.instrument.edit' }), 'INVALID_CONTROL');
    expectError(harness.call('controls.get', { key: 'mixer.channel.0.strip.gate.edit' }), 'INVALID_CONTROL');
});

test('bank send bounds reject excessive counts and missing collections', () => {
    const harness = fixture((api, state, { host }) => {
        host.mMixConsole.makeMixerBankZone = () => ({ makeMixerBankChannel: () => ({
            mValue: {}, getUniqueIDString: () => 'id', getRuntimeID: () => 1,
            mSends: { getSize: () => 33, getByIndex: () => ({}) }
        }) });
    });
    const groups = listAll(harness).groups;
    assert.equal(groups['mixer.channel.0.send'].error.code, 'HOST_LIMIT_EXCEEDED');
    assert.equal(groups['mixer.channel.0.cueSend'].error.code, 'API_UNAVAILABLE');
    expectError(harness.call('controls.get', { key: 'mixer.channel.0.send.0.level' }), 'INVALID_CONTROL');
    assert.equal(harness.call('controls.get', { key: 'mixer.channel.0.eq.1.gain' }).data.control.error.code, 'API_UNAVAILABLE');
});

test('bank sends do not starve later channel slots at supported host maxima', () => {
    const harness = fixture((api, state, { host }) => {
        host.mMixConsole.makeMixerBankZone = () => {
            let index = 0;
            return { makeMixerBankChannel() {
                const slot = index++;
                return { mValue: {}, getUniqueIDString: () => `channel-${slot}`, getRuntimeID: () => slot,
                    mSends: { getSize: () => 32, getByIndex: () => ({ mOn: {}, mPrePost: {}, mLevel: {} }) },
                    mCueSends: { mBypass: {}, getSize: () => 32,
                        getByIndex: () => ({ mOn: {}, mPrePost: {}, mLevel: {}, mPan: {} }) } };
            } };
        };
    });
    for (const key of ['mixer.channel.7.send.31.level', 'mixer.channel.7.cueSend.31.pan', 'mixer.channel.7.cueSend.bypass']) {
        const result = harness.call('controls.get', { key }).data.control;
        assert.equal(result.available, true);
        assert.equal(result.channel.uniqueId, 'channel-7');
        assert.equal(harness.call('controls.set', { key, value: 0.5, expectedChannelUniqueId: 'channel-7' }).data.execution, 'submitted');
    }
});

test('nested bank groups report missing channel identity instead of branch readiness', () => {
    const harness = fixture((api, state, { host }) => {
        host.mMixConsole.makeMixerBankZone = () => ({ makeMixerBankChannel: () => ({
            mValue: {}, mPreFilter: { mGain: {} }, getUniqueIDString: () => '', getRuntimeID: () => 1
        }) });
    });
    const group = listAll(harness).groups['mixer.channel.0.filter'];
    assert.equal(group.available, false);
    assert.equal(group.error.code, 'NO_CHANNEL');
    assert.equal(group.channel.uniqueId, null);
});

test('bank insert viewers are read-only and navigation invalidates channel and plugin observations', () => {
    const ids = Array.from({ length: 8 }, (_, i) => `id-${i}`), viewers = {};
    const harness = fixture((api, state, { host }) => {
        api.mDefaults.getNumberOfInsertEffectSlots = () => 1;
        host.mMixConsole.makeMixerBankZone = () => {
            let i = 0;
            return { mAction: { mNextBank: {} }, makeMixerBankChannel() {
                const n = i++;
                return { mValue: {}, getUniqueIDString: () => ids[n], getRuntimeID: () => n,
                    mInsertAndStripEffects: { makeInsertEffectViewer(name) {
                        const v = { mOn: {}, mBypass: {}, mAutomationRead: {}, mAutomationWrite: {},
                            mAction: { mPrev: {}, mNext: {}, mReset: {} },
                            mParameterBankZone: { makeParameterValue: () => ({}), mAction: { mPrevBank: {}, mNextBank: {}, mResetBank: {} } },
                            includeEmptySlotsOnly() { return v; }, excludeEmptySlots() { return v; },
                            accessSlotAtIndex(slot) { assert.equal(slot, 0); return v; } };
                        viewers[name] = v; return v;
                    } } };
            } };
        };
    });
    const group = 'mixer.channel.0.insert.slot.0', key = group + '.on';
    const viewer = viewers['CubaseAI MCP bank 0 slot.0'];
    assert.equal(harness.call('controls.get', { key }).data.control.readOnly, true);
    expectError(harness.call('controls.set', { key, value: 1, expectedChannelUniqueId: ids[0] }), 'READ_ONLY');
    expectError(harness.call('controls.set', { key: group + '.parameter.0', value: 1, expectedChannelUniqueId: ids[0] }), 'READ_ONLY');
    viewer.mOnChangePluginIdentity(harness.device, harness.currentMapping(), 'A', 'V', '1', '3');
    viewer.mOn.mOnProcessValueChange(harness.device, harness.currentMapping(), 1);
    viewer.mOnChangePluginIdentity(harness.device, harness.currentMapping(), 'B', 'V', '1', '3');
    viewer.mOnChangePluginIdentity({}, harness.currentMapping(), 'Wrong device', 'V', '1', '3');
    viewer.mOnChangePluginIdentity(harness.device, {}, 'Wrong mapping', 'V', '1', '3');
    assert.equal(harness.call('controls.get', { key }).data.control.observed, null);
    assert.equal(listAll(harness).groups[group].pluginIdentity.name, 'B');
    expectError(harness.call('controls.set', { key: group + '.viewer.next', value: 1 }), 'CONFIRMATION_REQUIRED');
    expectError(harness.call('controls.set', { key: group + '.viewer.next', value: 1, expectedChannelUniqueId: ids[1] }), 'CHANNEL_UNOBSERVED');
    assert.equal(harness.call('controls.set', { key: group + '.viewer.next', value: 1, expectedChannelUniqueId: ids[0] }).data.execution, 'submitted');
    expectError(harness.call('controls.set', { key: group + '.bank.next', value: 1, expectedChannelUniqueId: ids[0] }), 'CHANNEL_UNOBSERVED');
    assert.equal(listAll(harness).groups[group].pluginIdentity, null);
    harness.call('controls.get', { key });
    ids[0] = 'changed';
    expectError(harness.call('controls.set', { key: group + '.bank.next', value: 1, expectedChannelUniqueId: 'id-0' }), 'CHANNEL_CHANGED');
    expectError(harness.call('controls.get', { key: 'mixer.channel.0.insert.slot.1.on' }), 'INVALID_CONTROL');
    harness.deactivate(); harness.activate();
    expectError(harness.call('controls.set', { key: group + '.viewer.next', value: 1, expectedChannelUniqueId: 'changed' }), 'STALE_SESSION');
});

test('bank insert viewer missing host and excessive slot count report unavailable', () => {
    const harness = fixture((api, state, { host }) => {
        api.mDefaults.getNumberOfInsertEffectSlots = () => 17;
        host.mMixConsole.makeMixerBankZone = () => ({ makeMixerBankChannel: () => ({
            mValue: {}, getUniqueIDString: () => 'id', getRuntimeID: () => 1
        }) });
    });
    const groups = listAll(harness).groups;
    assert.equal(groups['mixer.channel.0.insert.all'].error.code, 'API_UNAVAILABLE');
    assert.equal(groups['mixer.channel.0.insert.slots'].error.code, 'HOST_LIMIT_EXCEEDED');
    expectError(harness.call('controls.get', { key: 'mixer.channel.0.insert.slot.0.on' }), 'INVALID_CONTROL');
    const absent = fixture((api, state, { host }) => {
        api.mDefaults.getNumberOfInsertEffectSlots = () => 2;
        host.mMixConsole.makeMixerBankZone = () => ({ makeMixerBankChannel: () => ({
            mValue: {}, getUniqueIDString: () => 'id', getRuntimeID: () => 1
        }) });
    });
    assert.equal(listAll(absent).groups['mixer.channel.0.insert.slots'].error.code, 'API_UNAVAILABLE');
});

test('bank insert viewer indexed slots remain available on the final bank channel', () => {
    const harness = fixture((api, state, { host }) => {
        api.mDefaults.getNumberOfInsertEffectSlots = () => 16;
        host.mMixConsole.makeMixerBankZone = () => {
            let index = 0;
            return { makeMixerBankChannel() {
                const slot = index++;
                return { mValue: {}, getUniqueIDString: () => `id-${slot}`, getRuntimeID: () => slot,
                    mInsertAndStripEffects: { makeInsertEffectViewer() {
                        const viewer = { mOn: {}, mAction: { mNext: {} },
                            mParameterBankZone: { makeParameterValue: () => ({}), mAction: {} },
                            includeEmptySlotsOnly() { return viewer; }, excludeEmptySlots() { return viewer; },
                            accessSlotAtIndex(i) { assert.ok(i >= 0 && i < 16); return viewer; } };
                        return viewer;
                    } } };
            } };
        };
    });
    const key = 'mixer.channel.7.insert.slot.15.on';
    const result = harness.call('controls.get', { key }).data.control;
    assert.equal(result.available, true);
    assert.equal(result.channel.uniqueId, 'id-7');
    assert.equal(result.readOnly, true);
    assert.equal(harness.call('controls.set', { key: 'mixer.channel.7.insert.slot.15.viewer.next', value: 1,
        expectedChannelUniqueId: 'id-7' }).data.execution, 'submitted');
});

test('bank channel missing identities and wrong identifier fields fail closed', () => {
    const harness = fixture((api, state, { host }) => {
        host.mMixConsole.makeMixerBankZone = () => ({ makeMixerBankChannel: () => ({
            mValue: { mVolume: {} }, getUniqueIDString: () => '', getRuntimeID: () => 1
        }) });
    });
    expectError(harness.call('controls.get', { key: 'mixer.channel.0.volume' }), 'NO_CHANNEL');
    expectError(harness.call('controls.set', { key: 'mixer.channel.0.volume', value: 0.5 }), 'CONFIRMATION_REQUIRED');
    expectError(harness.call('controls.set', { key: 'track.volume', value: 0.5, expectedChannelUniqueId: 'id' }), 'INVALID_ARGUMENT');
});

test('bank slot runtime replacement invalidates admission even when its unique ID is unchanged', () => {
    let runtimeId = 100;
    const harness = fixture((api, state, { host }) => {
        host.mMixConsole.makeMixerBankZone = () => ({ makeMixerBankChannel: () => ({
            mValue: { mVolume: {} }, getUniqueIDString: () => 'same-id', getRuntimeID: () => runtimeId
        }) });
    });
    const key = 'mixer.channel.0.volume';
    assert.equal(harness.call('controls.get', { key }).data.control.channel.runtimeId, 100);
    runtimeId = 200;
    expectError(harness.call('controls.set', { key, value: 0.5, expectedChannelUniqueId: 'same-id' }), 'CHANNEL_CHANGED');
    expectError(harness.call('controls.set', { key, value: 0.5, expectedChannelUniqueId: 'same-id' }), 'CHANNEL_UNOBSERVED');
});

test('bank discovery reports an empty host slot as unavailable', () => {
    const harness = fixture((api, state, { host }) => {
        host.mMixConsole.makeMixerBankZone = () => ({ makeMixerBankChannel: () => ({
            mValue: { mVolume: {} }, getUniqueIDString: () => '', getRuntimeID: () => 1
        }) });
    });
    const listed = listAll(harness);
    const control = listed.controls.find(item => item.key === 'mixer.channel.0.volume');
    assert.equal(control.available, false);
    assert.equal(control.error.code, 'NO_CHANNEL');
    assert.equal(listed.groups['mixer.channel.0'].available, false);
    assert.equal(listed.groups['mixer.channel.0'].error.code, 'NO_CHANNEL');
});

test('a missing filtered action binding is unavailable rather than submitted', () => {
    const harness = fixture((api, state, { host, page }) => {
        host.mMixConsole.makeMixerBankZone = () => ({ mAction: { mNextBank: {} } });
        page.makeActionBinding = () => ({ filterByValue() { return null; } });
    });
    expectError(harness.call('controls.set', { key: 'mixer.bank.next', value: 1 }), 'API_UNAVAILABLE');
});

test('Control Room bounds and missing branches fail closed', () => {
    const missing = fixture();
    assert.equal(listAll(missing).groups.controlRoom.error.code, 'API_UNAVAILABLE');
    expectError(missing.call('controls.set', { key: 'controlRoom.main.level', value: 1 }), 'API_UNAVAILABLE');
    const excessive = fixture((api, state, { host }) => {
        host.mControlRoom = { getMaxCueChannels: () => 17, getCueChannelByIndex: () => ({}) };
    });
    const group = listAll(excessive).groups['controlRoom.cue'];
    assert.equal(group.count, 17);
    assert.equal(group.error.code, 'HOST_LIMIT_EXCEEDED');
    expectError(excessive.call('controls.get', { key: 'controlRoom.cue.0.level' }), 'INVALID_CONTROL');
});

function fixture(configure = () => {}, logger) {
    const device = {};
    let mapping = {};
    const nodes = new Map();
    const state = {
        version: '16.0.5', writes: [], pluginWrites: [], commandRuns: [], surfaces: {}, tempoWrites: [], timeWrites: [], trackMoves: [],
        accesses: {}, portNames: [], detectionNames: [], frames: [], replies: [],
        commandAllowed: true, pluginAccepted: true, selectedTrackId: 'track-uid-2'
    };
    function node(objectId, children = []) {
        const value = {
            objectId, children, uniqueIdString: `uid-${objectId}`, uniqueName: `object-${objectId}`,
            title: `Object ${objectId}`, typeName: children.length ? 'Folder' : 'Channel',
            color: [0.1, 0.2, 0.3, 1],
            parameters: [101, 102].map(tag => ({ tag, value: 0.25, display: '25%', locked: false }))
        };
        nodes.set(objectId, value);
        return value;
    }
    node(1, [2, 3]);
    node(2);
    node(3);
    node(10, [11]);
    node(11);
    node(20);
    node(30);
    function parameter(objectId, tag) {
        const found = nodes.get(objectId).parameters.find(item => item.tag === tag);
        assert.ok(found, `unknown fixture parameter ${tag}`);
        return found;
    }
    function directAccess(root) {
        const access = {
            activate(activeMapping) {
                assert.equal(activeMapping, mapping);
                assert.equal(typeof access.mOnParameterChange, 'function');
                access.mOnParameterChange(device, activeMapping, root.base, 101);
            },
            deactivate(activeMapping) { assert.equal(activeMapping, mapping); },
            update(activeMapping) { assert.equal(activeMapping, mapping); },
            getBaseObjectID(activeMapping) { assert.equal(activeMapping, mapping); return root.base; },
            getNumberOfChildObjects(activeMapping, objectId) { return nodes.get(objectId).children.length; },
            getChildObjectID(activeMapping, objectId, index) { return nodes.get(objectId).children[index]; },
            getObjectUniqueIDString(activeMapping, objectId) { return nodes.get(objectId).uniqueIdString; },
            getObjectUniqueName(activeMapping, objectId) { return nodes.get(objectId).uniqueName; },
            getObjectTypeName(activeMapping, objectId) { return nodes.get(objectId).typeName; },
            getObjectTitle(activeMapping, objectId) { return nodes.get(objectId).title; },
            getObjectColor(activeMapping, objectId) { return nodes.get(objectId).color; },
            isMixerChannelVisible(activeMapping, objectId) { return objectId !== 3; },
            getMixerChannelIndex(activeMapping, objectId) { return objectId === 3 ? -1 : objectId - 1; },
            getMixerChannelZone() { return 0; },
            getNumberOfParameters(activeMapping, objectId) { return nodes.get(objectId).parameters.length; },
            getParameterTagByIndex(activeMapping, objectId, index) { return nodes.get(objectId).parameters[index].tag; },
            getParameterTitle(activeMapping, objectId, tag, maxLength) { assert.equal(maxLength, 256); return `Parameter ${tag}`; },
            getParameterProcessValue(activeMapping, objectId, tag) { return parameter(objectId, tag).value; },
            getParameterDisplayValue(activeMapping, objectId, tag) { return parameter(objectId, tag).display; },
            getParameterDefaultProcessValue() { return 0.5; },
            getParameterDefaultDisplayValue() { return '50%'; },
            getParameterDisplayUnits() { return '%'; },
            getParameterProcessValueType() { return 'Float'; },
            getParameterEditLockState(activeMapping, objectId, tag) { return parameter(objectId, tag).locked; },
            isParameterAutomatable() { return true; },
            convertParameterProcessValueToPlain(activeMapping, objectId, tag, value) { return value * 100; },
            convertParameterPlainToProcessValue(activeMapping, objectId, tag, value) { return Math.max(0, Math.min(1, value / 100)); },
            setParameterProcessValue(activeMapping, objectId, tag, value) {
                assert.equal(activeMapping, mapping);
                state.writes.push({ kind: 'process', objectId, tag, value });
                parameter(objectId, tag).value = value;
                parameter(objectId, tag).display = `${value * 100}%`;
            },
            setParameterDisplayValue(activeMapping, objectId, tag, value) {
                assert.equal(activeMapping, mapping);
                state.writes.push({ kind: 'display', objectId, tag, value });
                parameter(objectId, tag).display = value;
                parameter(objectId, tag).value = parseFloat(value) / 100;
            },
            mPluginManager: {
                getNumberOfPluginCollections() { return 2; },
                getPluginCollectionByIndex(activeMapping, objectId, index) {
                    return { mName: `Collection ${index}`, mEntries: [0, 1, 2].map(number => ({
                        mPluginUID: `plug-${index}-${number}`, mPluginName: `Plugin ${number}`,
                        mPluginVendor: 'Fixture Vendor', mPluginVersion: '1.2.3', mFormatVersion: '3',
                        mSubCategories: 'Fx', mCollectionPath: `Folder/${number}`
                    })) };
                },
                getIndexOfDefaultPluginCollection() { return 0; },
                getIndexOfActivePluginCollection() { return 1; },
                trySetSlotPlugin(activeMapping, objectId, uid, dontAskDiscard) {
                    assert.equal(activeMapping, mapping);
                    state.pluginWrites.push({ objectId, uid, dontAskDiscard });
                    return state.pluginAccepted;
                }
            }
        };
        state.accesses[root.key] = access;
        return access;
    }
    function quickControls() {
        return { getSize() { return 8; }, getByIndex() { return {}; } };
    }
    function values(fields) {
        return Object.fromEntries(fields.map(field => [field, {}]));
    }
    const eqBands = Object.fromEntries([1, 2, 3, 4].map(index =>
        [`mBand${index}`, values(['mGain', 'mFreq', 'mQ', 'mOn', 'mFilterType'])]));
    const sendSlots = [0, 1].map(() => values(['mOn', 'mPrePost', 'mLevel']));
    const cueSlots = [values(['mOn', 'mPrePost', 'mLevel', 'mPan'])];
    function locator(display, name) {
        return { setTime(activeMapping, time) {
            assert.equal(activeMapping, mapping);
            state.timeWrites.push({ display, locator: name, time });
        } };
    }
    function timeDetails(display) {
        return { mTransportLocator: locator(display, 'cursor'), mCycleLocatorLeft: locator(display, 'cycleLeft'),
            mCycleLocatorRight: locator(display, 'cycleRight') };
    }
    const input = {};
    const responseDecoder = protocol.createDecoder();
    const output = {
        sendMidi(activeDevice, frame) {
            assert.equal(activeDevice, device);
            state.frames.push(frame);
            const decoded = responseDecoder.accept(frame, Date.now());
            if (decoded) state.replies.push(decoded);
        }
    };
    const host = {
        mTrackSelection: { key: 'trackSelection', base: 1, mAction: {
            mPrevTrack: { trigger(activeMapping) { assert.equal(activeMapping, mapping); state.trackMoves.push('previous'); } },
            mNextTrack: { trigger(activeMapping) { assert.equal(activeMapping, mapping); state.trackMoves.push('next'); } }
        }, mMixerChannel: {
            getUniqueIDString(activeMapping) { assert.equal(activeMapping, mapping); return state.selectedTrackId; },
            getRuntimeID(activeMapping) { assert.equal(activeMapping, mapping); return 2; },
            mValue: { mVolume: {}, mPan: {}, mMute: {}, mSolo: {}, mRecordEnable: {}, mMonitorEnable: {},
                mAutomationRead: {}, mAutomationWrite: {}, mVUMeter: {}, mVUMeterMax: {}, mVUMeterClip: {}, mVUMeterPeak: {} },
            mPreFilter: values(['mBypass', 'mGain', 'mPhaseSwitch', 'mHighCutOn', 'mHighCutFreq',
                'mHighCutSlope', 'mLowCutOn', 'mLowCutFreq', 'mLowCutSlope']),
            mChannelEQ: eqBands,
            mInsertAndStripEffects: { mStripEffects: Object.fromEntries(
                ['mGate', 'mCompressor', 'mLimiter', 'mSaturator', 'mTools'].map(name =>
                    [name, values(['mOn', 'mBypass', 'mAutomationRead', 'mAutomationWrite'])])) },
            mSends: { getSize() { return sendSlots.length; }, getByIndex(index) { return sendSlots[index]; } },
            mCueSends: { mBypass: {}, getSize() { return cueSlots.length; }, getByIndex(index) { return cueSlots[index]; } },
            mInstrumentPluginSlot: values(['mOn', 'mBypass', 'mAutomationRead', 'mAutomationWrite']),
            mQuickControls: quickControls()
        } },
        mMixConsole: { key: 'mixConsole', base: 10 },
        mTransport: { key: 'transport', base: 20,
            mValue: { mStart: {}, mStop: {}, mRecord: {}, mRewind: {}, mForward: {}, mCycleActive: {}, mMetronomeActive: {}, mMetronomeClickLevel: {} },
            mTimeDisplay: {
                mPrimary: timeDetails('primary'), mSecondary: timeDetails('secondary'),
                setTempoBPM(activeMapping, bpm) { assert.equal(activeMapping, mapping); state.tempoWrites.push(bpm); }
            } },
        mFocusedQuickControls: { key: 'focusedQuickControls', base: 30, mFocusLockedValue: {}, ...quickControls() },
        makeDirectAccess: directAccess
    };
    const page = {
        mHostAccess: host,
        makeActionBinding(surfaceValue, action) {
            assert.ok(surfaceValue && action);
            const binding = { filterByValue(value) { assert.equal(value, 1); return binding; } };
            return binding;
        },
        makeValueBinding(surfaceValue, hostValue) {
            surfaceValue.hostValue = hostValue;
            return { surfaceValue, hostValue };
        },
        makeCommandBinding(surfaceValue, category, name) {
            const binding = {
                category, name,
                canPerform(activeMapping) { assert.equal(activeMapping, mapping); return state.commandAllowed; },
                filterByValue(value) { assert.equal(value, 1); return binding; }
            };
            surfaceValue.command = binding;
            return binding;
        }
    };
    const detection = {
        detectPortPair(inPort, outPort) { assert.equal(inPort, input); assert.equal(outPort, output); return detection; },
        expectInputNameEquals(name) { state.detectionNames.push(name); return detection; },
        expectOutputNameEquals(name) { state.detectionNames.push(name); return detection; }
    };
    const driver = {
        mPorts: {
            makeMidiInput(name) { state.portNames.push(name); return input; },
            makeMidiOutput(name) { state.portNames.push(name); return output; }
        },
        makeDetectionUnit() { return detection; },
        mMapping: { makePage(name) { assert.equal(name, 'CubaseAI MCP'); return page; } },
        mSurface: {
            makeCustomValueVariable(name) {
                const value = {
                    setProcessValue(activeDevice, amount) {
                        assert.equal(activeDevice, device);
                        state.writes.push({ kind: 'surface', key: name, value: amount });
                        if (value.command && amount === 1) state.commandRuns.push(value.command.name);
                        value.mOnProcessValueChange(activeDevice, amount, 0);
                    }
                };
                state.surfaces[name] = value;
                return value;
            }
        }
    };
    const api = {
        mDefaults: {
            mAppVersion: { getVersionString() { return state.version; } },
            getAppName() { return 'Cubase AI'; },
            getNumberOfInsertEffectSlots() { return 4; },
            getNumberOfStripEffectSlots() { return 0; },
            getNumberOfSendSlots() { return 2; },
            getNumberOfQuickControls() { return 8; },
            getMaxControlRoomTalkbackChannels() { return 0; },
            getMaxControlRoomExternalInputChannels() { return 0; },
            getMaxControlRoomCueChannels() { return 0; },
            getMaxControlRoomPhonesChannels() { return 0; },
            getMaxControlRoomMonitorChannels() { return 0; },
            getMaxGainFactor() { return 4; }
        },
        makeDeviceDriver(...args) {
            assert.deepEqual(args, ['CubaseAI', 'MCP', 'CubaseAI MCP']);
            return driver;
        }
    };
    configure(api, state, { host, page, driver });
    const bridge = createController(api, logger);
    let requestNumber = 0;
    function receive(op, args, id = (++requestNumber).toString(16).padStart(32, '0'), deadline = Date.now() + 60000) {
        const request = { v: 1, id, op, args, deadline };
        for (const frame of protocol.encode(request)) input.mOnSysex(device, frame);
        return id;
    }
    function tick() {
        const before = state.frames.length;
        page.mOnIdle(device, mapping);
        assert.ok(state.frames.length - before <= 4, 'frame budget exceeded');
    }
    function transact(op, args, requestId, deadline) {
        const start = state.replies.length;
        const id = receive(op, args, requestId, deadline);
        for (let iteration = 0; iteration < 500; iteration++) {
            tick();
            const found = state.replies.slice(start).find(reply => reply.id === id);
            if (found) return found;
        }
        assert.fail(`no response for ${op}`);
    }
    function activate() {
        mapping = {};
        page.mOnActivate(device, mapping);
    }
    activate();
    const status = transact('bridge.status', {});
    const harness = {
        ...state, state, api, bridge, host, page, device, nodes, receive, tick, transact, activate, status,
        currentMapping() { return mapping; },
        call(op, args = {}, id) { return transact(op, { session: harness.session, ...args }, id); },
        emit(key, amount) { state.surfaces[key].mOnProcessValueChange(device, amount, 0); },
        deactivate() { page.mOnDeactivate(device, mapping); },
        changed(root = 'trackSelection') { state.accesses[root].mOnObjectWillBeRemoved(device, mapping, host[`m${root[0].toUpperCase()}${root.slice(1)}`].base); }
    };
    harness.session = status.ok ? status.data.session : undefined;
    return harness;
}

test('controller lifecycle telemetry records only bounded stages, not MIDI payloads', () => {
    const logs = [];
    const harness = fixture(() => {}, { log(message) { logs.push(message); } });
    assert.equal(harness.status.ok, true);
    assert.ok(logs.some(message => message.includes('controller constructed')));
    assert.ok(logs.some(message => message.includes('mapping activated')));
    assert.ok(logs.some(message => message.includes('first MIDI input')));
    assert.ok(logs.some(message => message.includes('first idle')));
    assert.ok(logs.some(message => message.includes('first response frame')));
    assert.ok(logs.length <= 8);
    assert.ok(logs.every(message => !message.includes(harness.session)));
});

function observeParameters(harness) {
    assert.equal(harness.call('objects.list', { root: 'trackSelection' }).ok, true);
    assert.equal(harness.call('parameters.list', { root: 'trackSelection', objectId: 2 }).ok, true);
}

function expectError(response, code) {
    assert.equal(response.ok, false, JSON.stringify(response));
    assert.equal(response.error.code, code, JSON.stringify(response));
}

function listAll(harness) {
    let offset = 0, groupOffset = 0, controlsDone = false, groupsDone = false;
    const controls = [], groups = {};
    while (!controlsDone || !groupsDone) {
        const page = harness.call('controls.list', { offset, groupOffset }).data;
        if (!controlsDone) { controls.push(...page.controls); controlsDone = page.nextOffset === null; }
        if (!groupsDone) { Object.assign(groups, page.groups); groupsDone = page.nextGroupOffset === null; }
        if (!controlsDone) offset = page.nextOffset;
        if (!groupsDone) groupOffset = page.nextGroupOffset;
    }
    return { controls, groups };
}

test('production remote modules parse as ES5', () => {
    for (const name of ['commands.js', 'controller.js', 'CubaseAI_MCP.js']) {
        acorn.parse(fs.readFileSync(path.join(__dirname, '../remote', name), 'utf8'), {
            ecmaVersion: 5, sourceType: 'script'
        });
    }
    assert.equal(typeof require('../remote/controller.js').createController, 'function');
});

test('command definitions are a fixed non-window allowlist', () => {
    assert.deepEqual(commands.map(command => [command.key, command.category, command.name]), [
        ['edit.undo', 'Edit', 'Undo'],
        ['edit.redo', 'Edit', 'Redo'],
        ['midi.quantize', 'Quantize Category', 'Quantize']
    ]);
    assert.ok(Object.isFrozen(commands));
    assert.ok(commands.every(command => Object.isFrozen(command) && command.context));
    acorn.parse(fs.readFileSync(path.join(__dirname, '../remote/commands.js'), 'utf8'), {
        ecmaVersion: 5, sourceType: 'script'
    });
});

test('factory registers exact ports and reports only real app and root data', () => {
    const harness = fixture();
    assert.equal(harness.status.ok, true);
    assert.deepEqual(harness.portNames, ['CubaseAI MCP To Cubase', 'CubaseAI MCP From Cubase']);
    assert.deepEqual(harness.detectionNames, harness.portNames);
    const status = harness.status.data;
    assert.equal(status.appVersion, '16.0.5');
    assert.equal(status.bridgeRevision, '2026-11-10-coverage-3.5');
    assert.deepEqual(status.policy, { backgroundOnly: true, fallback: false });
    assert.equal(status.discovery.controlTotal, 124);
    assert.equal(harness.call('objects.list', { root: 'trackSelection' }).data.baseObject.uniqueIdString, 'uid-1');
    assert.ok(listAll(harness).controls.every(control => control.observed === null));
    assert.deepEqual(harness.call('commands.list').data.commands.map(command => command.key), commands.map(command => command.key));
});

test('requests execute only on idle and all non-status operations require the active session', () => {
    const harness = fixture();
    expectError(harness.transact('controls.set', { key: 'track.volume', value: 0.4 }), 'STALE_SESSION');
    const id = harness.receive('controls.set', { session: harness.session, key: 'track.volume', value: 0.4 });
    assert.equal(harness.writes.length, 0);
    harness.tick();
    assert.equal(harness.writes.length, 1);
    assert.ok(harness.state.replies.some(reply => reply.id === id && reply.ok));
    const old = harness.session;
    harness.activate();
    const status = harness.transact('bridge.status', {});
    assert.notEqual(status.data.session, old);
    expectError(harness.transact('objects.list', { session: old, root: 'trackSelection' }), 'STALE_SESSION');
    harness.deactivate();
    assert.equal(harness.page.mOnIdle(harness.device, {}), undefined);
});

test('duplicate mutations are rejected and surface input echoes are not host readback', () => {
    const harness = fixture();
    const id = 'aa'.repeat(16);
    const response = harness.call('controls.set', { key: 'track.volume', value: 0.6 }, id);
    assert.equal(response.data.requestId, id);
    assert.equal(response.data.execution, 'submitted');
    assert.equal(response.data.before, null);
    assert.equal(response.data.after, null);
    expectError(harness.call('controls.set', { key: 'track.volume', value: 0.6 }, id), 'DUPLICATE_ID');
    assert.equal(harness.writes.length, 1);
    harness.emit('track.volume', 0.57);
    const controls = listAll(harness).controls;
    assert.deepEqual(controls.find(control => control.key === 'track.volume').observed, { value: 0.57, revision: 1 });
    harness.changed();
    assert.deepEqual(listAll(harness).controls.find(control => control.key === 'track.volume').observed,
        { value: 0.57, revision: 1 });
});

test('momentary transport uses a single pulse with no idle repeats', () => {
    const harness = fixture();
    assert.equal(harness.call('controls.set', { key: 'transport.start', value: 1 }).ok, true);
    assert.deepEqual(harness.writes.map(write => write.value), [1, 0]);
    harness.tick();
    harness.tick();
    assert.equal(harness.writes.length, 2);
    expectError(harness.call('controls.set', { key: 'track.volume', value: 1.1 }), 'INVALID_VALUE');
});

test('object traversal preserves root metadata, pagination, and observed-root admission', () => {
    const harness = fixture();
    expectError(harness.call('objects.get', { root: 'trackSelection', objectId: 2 }), 'OBJECT_UNOBSERVED');
    const first = harness.call('objects.list', { root: 'trackSelection', limit: 1 }).data;
    assert.equal(first.baseObjectId, 1);
    assert.equal(first.baseObject.title, 'Object 1');
    assert.deepEqual(first.items.map(item => item.objectId), [2]);
    assert.equal(first.total, 2);
    assert.equal(first.truncated, true);
    assert.equal(first.nextOffset, 1);
    assert.equal(harness.call('objects.get', { root: 'trackSelection', objectId: 2 }).data.object.title, 'Object 2');
    expectError(harness.call('objects.get', { root: 'mixConsole', objectId: 2 }), 'OBJECT_UNOBSERVED');
    expectError(harness.call('objects.list', { root: 'trackSelection', parentId: 3 }), 'OBJECT_UNOBSERVED');
    const second = harness.call('objects.list', { root: 'trackSelection', offset: 1, limit: 1 }).data;
    assert.deepEqual(second.items.map(item => item.objectId), [3]);
    assert.equal(second.nextOffset, null);
    expectError(harness.call('objects.list', { root: 'trackSelection', limit: 65 }), 'INVALID_ARGUMENT');
    harness.nodes.get(2).uniqueIdString = 'replacement';
    expectError(harness.call('objects.get', { root: 'trackSelection', objectId: 2 }), 'OBJECT_STALE');
});

test('parameter writes require listed tags, unlocked values, and matching expected value', () => {
    const harness = fixture();
    harness.call('objects.list', { root: 'trackSelection' });
    const args = { root: 'trackSelection', objectId: 2, tag: 101, mode: 'normalized', value: 0.5 };
    expectError(harness.call('parameters.set', args), 'PARAMETER_UNOBSERVED');
    const first = harness.call('parameters.list', { root: 'trackSelection', objectId: 2, limit: 1 }).data;
    assert.deepEqual(first.items[0], {
        tag: 101, title: 'Parameter 101', value: 0.25, display: '25%', plain: 25,
        defaultValue: 0.5, defaultDisplay: '50%', units: '%', type: 'Float', locked: false, automatable: true
    });
    expectError(harness.call('parameters.set', { ...args, tag: 102 }), 'PARAMETER_UNOBSERVED');
    expectError(harness.call('parameters.set', { ...args, expectedValue: 0.4 }), 'VALUE_CONFLICT');
    harness.nodes.get(2).parameters[0].locked = true;
    expectError(harness.call('parameters.set', args), 'PARAMETER_LOCKED');
    assert.equal(harness.writes.length, 0);
    harness.nodes.get(2).parameters[0].locked = false;
    const response = harness.call('parameters.set', { ...args, expectedValue: 0.25 });
    assert.equal(response.data.before.value, 0.25);
    assert.equal(response.data.after.value, 0.5);
    assert.equal(response.data.execution, 'submitted');
    assert.equal(harness.writes.length, 1);
});

test('single parameter reads require a discovered current object and tag', () => {
    const harness = fixture();
    const args = { root: 'trackSelection', objectId: 2, tag: 101 };
    expectError(harness.call('parameters.get', args), 'OBJECT_UNOBSERVED');
    harness.call('objects.list', { root: 'trackSelection' });
    expectError(harness.call('parameters.get', args), 'PARAMETER_UNOBSERVED');
    const listed = harness.call('parameters.list', { root: 'trackSelection', objectId: 2, limit: 1 }).data.items[0];
    assert.deepEqual(harness.call('parameters.get', args).data.parameter, listed);
    harness.nodes.get(2).parameters[0].value = 0.75;
    assert.equal(harness.call('parameters.get', args).data.parameter.value, 0.75);
    harness.nodes.get(2).parameters.reverse();
    expectError(harness.call('parameters.get', args), 'PARAMETER_STALE');
    expectError(harness.call('parameters.get', args), 'PARAMETER_UNOBSERVED');
    assert.equal(harness.writes.length, 0);
});

test('plain conversion is finite and round-trips; display uses only its exact setter', () => {
    const harness = fixture();
    observeParameters(harness);
    const args = { root: 'trackSelection', objectId: 2, tag: 101 };
    expectError(harness.call('parameters.set', { ...args, mode: 'plain', value: 500 }), 'INVALID_VALUE');
    expectError(harness.call('parameters.set', { ...args, mode: 'plain', value: null }), 'INVALID_VALUE');
    assert.equal(harness.writes.length, 0);
    assert.equal(harness.call('parameters.set', { ...args, mode: 'plain', value: 75 }).data.after.value, 0.75);
    assert.equal(harness.call('parameters.set', { ...args, mode: 'display', value: '40%' }).data.after.display, '40%');
    assert.deepEqual(harness.writes.map(write => write.kind), ['process', 'display']);
    delete harness.accesses.trackSelection.setParameterDisplayValue;
    expectError(harness.call('parameters.set', { ...args, mode: 'display', value: '80%' }), 'API_UNAVAILABLE');
    assert.equal(harness.writes.length, 2);
    delete harness.accesses.trackSelection.convertParameterPlainToProcessValue;
    expectError(harness.call('parameters.set', { ...args, mode: 'plain', value: 80 }), 'API_UNAVAILABLE');
    assert.equal(harness.writes.length, 2);
});

test('root change revokes object and parameter observations', () => {
    const harness = fixture();
    observeParameters(harness);
    harness.changed();
    expectError(harness.call('parameters.set', { root: 'trackSelection', objectId: 2, tag: 101, mode: 'normalized', value: 0.9 }), 'OBJECT_UNOBSERVED');
    assert.equal(harness.writes.length, 0);
    harness.call('objects.list', { root: 'trackSelection' });
    expectError(harness.call('parameters.set', { root: 'trackSelection', objectId: 2, tag: 101, mode: 'normalized', value: 0.9 }), 'PARAMETER_UNOBSERVED');
});

test('plugin metadata is real and replacement uses observed UID and dontAskDiscard=true', () => {
    const harness = fixture();
    harness.call('objects.list', { root: 'trackSelection' });
    const args = { root: 'trackSelection', objectId: 2, pluginUid: 'plug-1-1', confirmReplacement: true };
    expectError(harness.call('plugins.set', args), 'PLUGIN_UNOBSERVED');
    const plugins = harness.call('plugins.list', { root: 'trackSelection', objectId: 2, collection: 1, offset: 1, limit: 1 }).data;
    assert.equal(plugins.collectionName, 'Collection 1');
    assert.equal(plugins.collectionCount, 2);
    assert.equal(plugins.defaultCollection, 0);
    assert.equal(plugins.activeCollection, 1);
    assert.equal(plugins.nextOffset, 2);
    assert.deepEqual(plugins.items[0], { pluginUid: 'plug-1-1', name: 'Plugin 1', vendor: 'Fixture Vendor',
        version: '1.2.3', formatVersion: '3', subCategories: 'Fx', collectionPath: 'Folder/1' });
    expectError(harness.call('plugins.set', { ...args, confirmReplacement: false }), 'CONFIRMATION_REQUIRED');
    const response = harness.call('plugins.set', args);
    assert.equal(response.data.accepted, true);
    assert.equal(response.data.execution, 'submitted');
    assert.deepEqual(harness.pluginWrites, [{ objectId: 2, uid: 'plug-1-1', dontAskDiscard: true }]);
    expectError(harness.call('objects.get', { root: 'trackSelection', objectId: 2 }), 'OBJECT_UNOBSERVED');
});

test('rejected plugin assignment is an error and never retries or opens a dialog', () => {
    const harness = fixture();
    harness.call('objects.list', { root: 'trackSelection' });
    harness.call('plugins.list', { root: 'trackSelection', objectId: 2 });
    harness.state.pluginAccepted = false;
    const id = 'bb'.repeat(16);
    const args = { root: 'trackSelection', objectId: 2, pluginUid: 'plug-0-0', confirmReplacement: true };
    const response = harness.call('plugins.set', args, id);
    expectError(response, 'PLUGIN_REJECTED');
    assert.equal(response.error.execution, 'submitted');
    expectError(harness.call('plugins.set', args, id), 'DUPLICATE_ID');
    assert.equal(harness.pluginWrites.length, 1);
});

test('only confirmed allowlisted commands with canPerform true pulse their bound surface', () => {
    const harness = fixture();
    expectError(harness.call('commands.execute', { key: 'File Save', confirmCurrentSelection: true }), 'COMMAND_NOT_ALLOWED');
    expectError(harness.call('commands.execute', { key: 'edit.undo' }), 'CONFIRMATION_REQUIRED');
    harness.state.commandAllowed = false;
    expectError(harness.call('commands.execute', { key: 'edit.undo', confirmCurrentSelection: true }), 'COMMAND_UNAVAILABLE');
    assert.equal(harness.writes.length, 0);
    harness.state.commandAllowed = true;
    const response = harness.call('commands.execute', { key: 'edit.undo', confirmCurrentSelection: true });
    assert.equal(response.data.execution, 'submitted');
    assert.deepEqual(harness.commandRuns, ['Undo']);
    assert.deepEqual(harness.writes.map(write => [write.key, write.value]), [['command.edit.undo', 1], ['command.edit.undo', 0]]);
    delete harness.state.surfaces['command.edit.redo'].command.canPerform;
    expectError(harness.call('commands.execute', { key: 'edit.redo', confirmCurrentSelection: true }), 'API_UNAVAILABLE');
    assert.equal(harness.commandRuns.length, 1);
});

test('missing DirectAccess and wrong app versions fail closed', () => {
    const absent = fixture((api, state, { host }) => { delete host.makeDirectAccess; });
    assert.equal(absent.status.data.features.directAccess, false);
    expectError(absent.call('objects.list', { root: 'trackSelection' }), 'API_UNAVAILABLE');
    expectError(absent.call('controls.set', { key: 'track.volume', value: 0.9 }), 'API_UNAVAILABLE');
    assert.equal(absent.writes.length, 0);
    const wrong = fixture((api, state) => { state.version = '15.0.5'; });
    expectError(wrong.status, 'UNSUPPORTED_VERSION');
    assert.equal(wrong.writes.length, 0);
});

test('request saturation is bounded and rejected requests are not replayable', () => {
    const harness = fixture();
    const ids = [];
    for (let index = 0; index < 40; index++) {
        ids.push(harness.receive('controls.set', { session: harness.session, key: 'track.volume', value: 0.1 }));
    }
    for (let index = 0; index < 80; index++) harness.tick();
    assert.equal(harness.writes.length, 32);
    const rejected = harness.state.replies.filter(reply => !reply.ok && reply.error.code === 'QUEUE_FULL');
    assert.equal(rejected.length, 8);
    expectError(harness.call('controls.set', { key: 'track.volume', value: 0.1 }, ids[39]), 'DUPLICATE_ID');
    assert.equal(harness.writes.length, 32);
});

test('native tempo and time setters are validated, feature-tested and submitted once', () => {
    const harness = fixture();
    expectError(harness.call('transport.tempo', { bpm: 0 }), 'INVALID_VALUE');
    assert.equal(harness.call('transport.tempo', { bpm: 10 }).data.execution, 'submitted');
    const tempo = harness.call('transport.tempo', { bpm: 123.5 });
    assert.equal(tempo.data.requestedBpm, 123.5);
    assert.equal(tempo.data.execution, 'submitted');
    assert.deepEqual(harness.tempoWrites, [10, 123.5]);
    const time = harness.call('transport.time', { display: 'secondary', locator: 'cycleRight', time: '12.1.1.0' });
    assert.equal(time.data.execution, 'submitted');
    assert.deepEqual(harness.timeWrites, [{ display: 'secondary', locator: 'cycleRight', time: '12.1.1.0' }]);
    expectError(harness.call('transport.time', { display: 'secondary', locator: 'window', time: '1' }), 'INVALID_ARGUMENT');
    expectError(harness.call('transport.time', { display: 'primary', locator: 'cursor', time: ' ' }), 'INVALID_VALUE');
    delete harness.host.mTransport.mTimeDisplay.mSecondary.mCycleLocatorRight.setTime;
    expectError(harness.call('transport.time', { display: 'secondary', locator: 'cycleRight', time: '1' }), 'API_UNAVAILABLE');
    assert.equal(harness.timeWrites.length, 1);
    assert.equal(harness.call('controls.set', { key: 'track.automationWrite', value: 1 }).data.execution, 'submitted');
});

test('required deadlines reject missing, malformed and queue-expired work as not_started', () => {
    const harness = fixture();
    const args = { session: harness.session, key: 'track.volume', value: 0.9 };
    const missingId = 'cc'.repeat(16);
    for (const frame of protocol.encode({ v: 1, id: missingId, op: 'controls.set', args })) {
        harness.bridge.midiInput.mOnSysex(harness.device, frame);
    }
    harness.tick();
    const missing = harness.state.replies.find(reply => reply.id === missingId);
    expectError(missing, 'INVALID_REQUEST');
    assert.equal(missing.error.execution, 'not_started');
    const invalid = harness.transact('controls.set', args, undefined, 'soon');
    expectError(invalid, 'INVALID_REQUEST');
    assert.equal(invalid.error.execution, 'not_started');
    const deadline = Date.now() + 1000;
    const id = harness.receive('controls.set', args, undefined, deadline);
    const now = Date.now;
    try {
        Date.now = () => deadline + 1;
        harness.tick();
    } finally {
        Date.now = now;
    }
    const expired = harness.state.replies.find(reply => reply.id === id);
    expectError(expired, 'REQUEST_EXPIRED');
    assert.equal(expired.error.execution, 'not_started');
    assert.equal(harness.writes.length, 0);
});

test('host value feedback is not suppressed during a surface write', () => {
    const harness = fixture();
    const surface = harness.surfaces['track.volume'];
    surface.setProcessValue = (activeDevice, value) => {
        surface.mOnProcessValueChange(activeDevice, value, 0);
        surface.hostValue.mOnProcessValueChange(activeDevice, harness.currentMapping(), value);
    };
    const response = harness.call('controls.set', { key: 'track.volume', value: 0.5 });
    assert.equal(response.ok, true);
    assert.equal(response.data.after.value, 0.5);
});

test('native callback properties may be write-only', () => {
    const harness = fixture((api, state, { host }) => {
        const create = host.makeDirectAccess;
        host.makeDirectAccess = root => {
            const access = create(root);
            Object.defineProperty(access, 'mOnObjectChange', {
                set(callback) { assert.equal(typeof callback, 'function'); },
                get() { throw new Error('DukValue is uninitialized'); }
            });
            return access;
        };
    });
    assert.equal(harness.call('objects.list', { root: 'trackSelection' }).ok, true);
});

test('ordinary update notifications preserve observed IDs and host feedback', () => {
    const harness = fixture();
    observeParameters(harness);
    const access = harness.accesses.trackSelection;
    harness.surfaces['track.volume'].hostValue.mOnProcessValueChange(harness.device, harness.currentMapping(), 0.5);
    access.mOnObjectChange(harness.device, harness.currentMapping(), 2);
    assert.equal(harness.call('parameters.list', { root: 'trackSelection', objectId: 2 }).ok, true);
    const controls = listAll(harness).controls;
    assert.equal(controls.find(control => control.key === 'track.volume').observed.value, 0.5);
});

test('parameter reads do not rebuild the DirectAccess snapshot', () => {
    const harness = fixture();
    const access = harness.accesses.trackSelection;
    let updates = 0;
    access.update = mapping => {
        updates++;
        access.mOnObjectWillBeRemoved(harness.device, mapping, 1);
    };
    assert.equal(harness.call('objects.list', { root: 'trackSelection' }).ok, true);
    assert.equal(updates, 1);
    assert.equal(harness.call('parameters.list', { root: 'trackSelection', objectId: 2 }).ok, true);
    assert.equal(harness.call('objects.get', { root: 'trackSelection', objectId: 2 }).ok, true);
    assert.equal(updates, 1);
    access.mOnObjectWillBeRemoved(harness.device, harness.currentMapping(), 3);
    assert.equal(harness.call('objects.get', { root: 'trackSelection', objectId: 2 }).ok, true);
    expectError(harness.call('objects.get', { root: 'trackSelection', objectId: 3 }), 'OBJECT_UNOBSERVED');
});

test('native parameter read values are not forced into a normalized interval', () => {
    const harness = fixture();
    harness.nodes.get(2).parameters[0].value = -1;
    harness.accesses.trackSelection.getParameterDefaultProcessValue = () => -1;
    harness.accesses.trackSelection.getParameterProcessValueType = () => 'Integer';
    harness.call('objects.list', { root: 'trackSelection' });
    const response = harness.call('parameters.list', { root: 'trackSelection', objectId: 2 });
    assert.equal(response.ok, true);
    assert.equal(response.data.items[0].value, -1);
    assert.equal(response.data.items[0].defaultValue, -1);
});

test('extended EQ, filter, send and metronome controls use actual host bindings', () => {
    const harness = fixture();
    const listed = listAll(harness);
    assert.deepEqual(listed.groups['track.send'], { available: true, count: 2 });
    assert.deepEqual(listed.groups['track.cueSend'], { available: true, count: 1 });
    for (const key of ['track.filter.gain', 'track.filter.lowCutFrequency', 'track.eq.1.gain',
        'track.eq.4.filterType', 'track.send.0.level', 'track.send.1.prePost', 'transport.metronomeLevel',
        'track.cueSend.0.pan', 'track.cueSend.bypass']) {
        assert.equal(listed.controls.find(control => control.key === key).available, true, key);
        assert.equal(harness.call('controls.set', { key, value: 0.5 }).data.execution, 'submitted');
    }
    expectError(harness.call('controls.set', { key: 'track.send.2.level', value: 0.5 }), 'INVALID_CONTROL');
    assert.equal(harness.writes.length, 9);
});

test('missing send collections report unavailable rather than inventing slots', () => {
    const harness = fixture((api, state, context) => {
        delete context.host.mTrackSelection.mMixerChannel.mSends;
    });
    const listed = listAll(harness);
    assert.equal(listed.groups['track.send'].available, false);
    assert.equal(listed.groups['track.send'].error.code, 'API_UNAVAILABLE');
    assert.equal(listed.controls.some(control => control.key.indexOf('track.send.') === 0), false);
});

test('track navigation is bound to the observed selected channel identity', () => {
    const harness = fixture();
    const current = harness.call('track.current').data;
    assert.equal(current.uniqueId, 'track-uid-2');
    assert.equal(current.runtimeId, 2);
    expectError(harness.call('track.navigate', { direction: 'next', expectedUniqueId: 'stale' }), 'TRACK_CHANGED');
    expectError(harness.call('track.navigate', { direction: 'arbitrary', expectedUniqueId: current.uniqueId }), 'INVALID_ARGUMENT');
    assert.deepEqual(harness.trackMoves, []);
    const moved = harness.call('track.navigate', { direction: 'next', expectedUniqueId: current.uniqueId });
    assert.equal(moved.data.execution, 'submitted');
    assert.deepEqual(harness.trackMoves, ['next']);
    delete harness.host.mTrackSelection.mAction.mPrevTrack;
    expectError(harness.call('track.navigate', { direction: 'previous', expectedUniqueId: current.uniqueId }), 'API_UNAVAILABLE');
    assert.deepEqual(harness.trackMoves, ['next']);
});

test('transport reads only active-session host callbacks', () => {
    const harness = fixture();
    const initial = harness.call('transport.get').data;
    assert.equal(initial.observed.tempo, null);
    assert.equal(initial.observed.primary.cursor, null);
    assert.equal(initial.features.tempo, true);
    assert.equal(initial.features.time.secondary.cycleRight, true);
    const display = harness.host.mTransport.mTimeDisplay;
    const previousMapping = harness.currentMapping();
    display.mOnChangeTempoBPM(harness.device, previousMapping, 123);
    display.mPrimary.mTransportLocator.mOnChange(harness.device, previousMapping, '1.2.3.0', 'Bars+Beats');
    delete display.mSecondary.mCycleLocatorRight.setTime;
    assert.equal(harness.call('transport.get').data.features.time.secondary.cycleRight, false);
    const observed = harness.call('transport.get').data.observed;
    assert.deepEqual(observed.tempo, { bpm: 123 });
    assert.deepEqual(observed.primary.cursor, { time: '1.2.3.0', format: 'Bars+Beats' });
    harness.activate();
    const next = harness.transact('bridge.status', {});
    harness.session = next.data.session;
    display.mOnChangeTempoBPM(harness.device, previousMapping, 130);
    assert.equal(harness.call('transport.get').data.observed.tempo, null);
});

test('mixer channel information requires a discovered object and returns host values', () => {
    const harness = fixture();
    const args = { root: 'trackSelection', objectId: 2 };
    expectError(harness.call('mixer.channel', args), 'OBJECT_UNOBSERVED');
    harness.call('objects.list', { root: 'trackSelection' });
    assert.deepEqual(harness.call('mixer.channel', args).data, {
        session: harness.session, root: args.root, objectId: 2, visible: true, index: 1, zone: 0
    });
    delete harness.accesses.trackSelection.getMixerChannelZone;
    expectError(harness.call('mixer.channel', args), 'API_UNAVAILABLE');
});

test('single controls support track identity guards and reject writes to meters', () => {
    const harness = fixture();
    const meter = harness.call('controls.get', { key: 'track.meter.level' }).data.control;
    assert.equal(meter.readOnly, true);
    expectError(harness.call('controls.set', { key: 'track.meter.level', value: 0.5 }), 'READ_ONLY');
    expectError(harness.call('controls.set', { key: 'track.eq.1.gain', value: 0.5, expectedTrackUniqueId: 'other' }), 'TRACK_CHANGED');
    expectError(harness.call('controls.set', { key: 'transport.cycle', value: 0.5, expectedTrackUniqueId: 'track-uid-2' }), 'INVALID_ARGUMENT');
    assert.equal(harness.writes.length, 0);
    assert.equal(harness.call('controls.set', { key: 'track.eq.1.gain', value: 0.5, expectedTrackUniqueId: 'track-uid-2' }).data.execution, 'submitted');
    expectError(harness.call('controls.get', { key: 'missing' }), 'INVALID_CONTROL');
    assert.equal(harness.call('controls.get', { key: 'track.instrument.bypass' }).data.control.available, true);
    assert.equal(harness.call('controls.get', { key: 'focus.lock' }).data.control.available, true);
});

test('control display and units are captured only from the active host mapping', () => {
    const harness = fixture();
    const hostValue = harness.surfaces['track.eq.1.gain'].hostValue;
    assert.equal(harness.call('controls.get', { key: 'track.eq.1.gain' }).data.control.display, null);
    hostValue.mOnDisplayValueChange(harness.device, harness.currentMapping(), '-3.0', 'dB');
    assert.deepEqual(harness.call('controls.get', { key: 'track.eq.1.gain' }).data.control.display,
        { value: '-3.0', units: 'dB' });
    hostValue.mOnDisplayValueChange(harness.device, {}, 'unexpected', 'dB');
    assert.equal(harness.call('controls.get', { key: 'track.eq.1.gain' }).data.control.display.value, '-3.0');
    harness.activate();
    const next = harness.transact('bridge.status', {});
    harness.session = next.data.session;
    assert.equal(harness.call('controls.get', { key: 'track.eq.1.gain' }).data.control.display, null);
});

test('selected track changes revoke old track control values before reading or writing', () => {
    const harness = fixture();
    const hostValue = harness.surfaces['track.volume'].hostValue;
    hostValue.mOnProcessValueChange(harness.device, harness.currentMapping(), 0.6);
    hostValue.mOnDisplayValueChange(harness.device, harness.currentMapping(), '-3', 'dB');
    assert.equal(harness.call('controls.get', { key: 'track.volume' }).data.control.observed.value, 0.6);
    harness.state.selectedTrackId = 'track-uid-3';
    const changed = harness.call('controls.get', { key: 'track.volume' }).data.control;
    assert.equal(changed.observed, null);
    assert.equal(changed.display, null);
    expectError(harness.call('controls.set', { key: 'track.volume', value: 0.5, expectedTrackUniqueId: 'track-uid-2' }), 'TRACK_CHANGED');
    assert.equal(harness.writes.length, 0);
    harness.state.selectedTrackId = 'track-uid-4';
    hostValue.mOnProcessValueChange(harness.device, harness.currentMapping(), 0.8);
    hostValue.mOnDisplayValueChange(harness.device, harness.currentMapping(), '-1', 'dB');
    const fresh = harness.call('controls.get', { key: 'track.volume' }).data.control;
    assert.equal(fresh.observed.value, 0.8);
    assert.deepEqual(fresh.display, { value: '-1', units: 'dB' });
});

test('host info uses actual API limits and reports missing fields', () => {
    const harness = fixture();
    delete harness.api.mDefaults.getNumberOfStripEffectSlots;
    const info = harness.call('host.info').data;
    assert.equal(info.application, 'Cubase AI');
    assert.equal(info.appVersion, '16.0.5');
    assert.equal(info.limits.insertEffects, 4);
    assert.equal(info.limits.sendSlots, 2);
    assert.equal(info.limits.stripEffects, null);
    assert.equal(info.errors.stripEffects.code, 'API_UNAVAILABLE');
});

test('a throwing edition-specific host branch does not prevent the bridge from starting', () => {
    const harness = fixture((api, state, context) => {
        Object.defineProperty(context.host.mTrackSelection.mMixerChannel, 'mChannelEQ', {
            get() { throw new Error('native branch unavailable'); }
        });
    });
    assert.equal(harness.status.ok, true);
    const listed = listAll(harness);
    assert.equal(listed.groups['track.eq'].available, false);
    assert.match(listed.groups['track.eq'].error.message, /native branch unavailable/);
    expectError(harness.call('controls.set', { key: 'track.eq.1.gain', value: 0.5 }), 'API_UNAVAILABLE');
    assert.equal(harness.call('controls.set', { key: 'track.volume', value: 0.5 }).ok, true);
});
