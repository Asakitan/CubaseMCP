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
    assert.equal(harness.status.data.bridgeRevision, '2026-11-10-coverage-3.14');
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

test('insert viewers use fixed filters and identity-guarded values and navigation', () => {
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
        assert.equal(harness.call('controls.get', { key }).data.control.readOnly, false);
        expectError(harness.call('controls.set', { key, value: 0.5 }), 'CONFIRMATION_REQUIRED');
        expectError(harness.call('controls.get', { key: `track.insert.${group}.edit` }), 'INVALID_CONTROL');
    }
    expectError(harness.call('controls.set', { key: 'track.insert.slot.0.bank.next', value: 1 }), 'CONFIRMATION_REQUIRED');
    expectError(harness.call('controls.set', { key: 'track.insert.slot.0.bank.next', value: 1, expectedTrackUniqueId: 'wrong' }), 'TRACK_CHANGED');
    assert.equal(harness.call('controls.set', { key: 'track.insert.slot.0.bank.next', value: 1,
        expectedTrackUniqueId: 'track-uid-2' }).data.execution, 'submitted');
    viewers['CubaseAI MCP slot.0'].mOnChangePluginIdentity(harness.device, harness.currentMapping(), 'Plugin', 'Vendor', '1', '3');
    const identity = { name: 'Plugin', vendor: 'Vendor', version: '1', formatVersion: '3' };
    const guard = { expectedTrackUniqueId: 'track-uid-2', expectedTrackRuntimeId: 2, expectedPluginIdentity: identity };
    expectError(harness.call('controls.set', { key: 'track.insert.slot.0.on', value: 1,
        ...guard, expectedPluginIdentity: { ...identity, name: 'other' } }), 'PLUGIN_CHANGED');
    for (const key of ['track.insert.slot.0.on', 'track.insert.slot.0.parameter.0']) {
        assert.deepEqual(harness.call('controls.get', { key }).data.control.pluginIdentity, identity);
        assert.equal(harness.call('controls.set', { key, value: 0.5, ...guard }).data.execution, 'submitted');
    }
    viewers['CubaseAI MCP slot.0'].mOnChangePluginIdentity(harness.device, harness.currentMapping(), null, 'Vendor', '1', '3');
    expectError(harness.call('controls.set', { key: 'track.insert.slot.0.on', value: 1, ...guard }), 'PLUGIN_UNOBSERVED');
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

test('selected insert identity changes revoke only that viewer feedback', () => {
    const viewers = {};
    const harness = fixture((api, state, { host }) => {
        api.mDefaults.getNumberOfInsertEffectSlots = () => 2;
        host.mTrackSelection.mMixerChannel.mInsertAndStripEffects.makeInsertEffectViewer = name => {
            const viewer = { mOn: {}, mAction: {},
                mParameterBankZone: { makeParameterValue: () => ({}), mAction: {} },
                includeEmptySlotsOnly() { return viewer; }, excludeEmptySlots() { return viewer; },
                accessSlotAtIndex() { return viewer; } };
            viewers[name] = viewer;
            return viewer;
        };
    });
    const viewer = viewers['CubaseAI MCP slot.0'];
    viewer.mOnChangePluginIdentity(harness.device, harness.currentMapping(), 'A', 'V', '1', '3');
    viewer.mOn.mOnProcessValueChange(harness.device, harness.currentMapping(), 1);
    viewer.mOn.mOnDisplayValueChange(harness.device, harness.currentMapping(), 'On', '');
    harness.emit('track.insert.slot.0.parameter.0', 0.25);
    harness.emit('track.insert.slot.1.on', 0.4);
    harness.emit('track.volume', 0.8);
    viewer.mOnChangePluginIdentity({}, harness.currentMapping(), 'Ignored', 'V', '1', '3');
    assert.equal(harness.call('controls.get', { key: 'track.insert.slot.0.on' }).data.control.observed.value, 1);
    viewer.mOnChangePluginIdentity(harness.device, harness.currentMapping(), 'B', 'V', '1', '3');
    const changed = harness.call('controls.get', { key: 'track.insert.slot.0.on' }).data.control;
    assert.equal(changed.observed, null);
    assert.equal(changed.display, null);
    assert.equal(harness.call('controls.get', { key: 'track.insert.slot.0.parameter.0' }).data.control.observed, null);
    assert.equal(harness.call('controls.get', { key: 'track.insert.slot.1.on' }).data.control.observed.value, 0.4);
    assert.equal(harness.call('controls.get', { key: 'track.volume' }).data.control.observed.value, 0.8);
    assert.equal(listAll(harness).groups['track.insert.slot.0'].pluginIdentity.name, 'B');
});

test('selected strip identity changes revoke that plugin feedback', () => {
    let slot;
    const harness = fixture((api, state, { host }) => {
        slot = host.mTrackSelection.mMixerChannel.mInsertAndStripEffects.mStripEffects.mGate;
        slot.mParameterBankZone = { makeParameterValue: () => ({}), mAction: {} };
    });
    slot.mOnChangePluginIdentity(harness.device, harness.currentMapping(), 'Gate A', 'V', '1', '3');
    slot.mOn.mOnProcessValueChange(harness.device, harness.currentMapping(), 1);
    harness.emit('track.strip.gate.parameter.0', 0.3);
    harness.emit('track.volume', 0.7);
    slot.mOnChangePluginIdentity(harness.device, harness.currentMapping(), 'Gate B', 'V', '1', '3');
    assert.equal(harness.call('controls.get', { key: 'track.strip.gate.on' }).data.control.observed, null);
    assert.equal(harness.call('controls.get', { key: 'track.strip.gate.parameter.0' }).data.control.observed, null);
    assert.equal(harness.call('controls.get', { key: 'track.volume' }).data.control.observed.value, 0.7);
    assert.equal(listAll(harness).groups['track.strip.gate'].pluginIdentity.name, 'Gate B');
});

test('selected channel runtime replacement revokes cached track feedback', () => {
    let runtimeId = 2;
    const harness = fixture((api, state, { host }) => {
        host.mTrackSelection.mMixerChannel.getRuntimeID = () => runtimeId;
    });
    harness.emit('track.volume', 0.6);
    const value = harness.surfaces['track.volume'].hostValue;
    value.mOnDisplayValueChange(harness.device, harness.currentMapping(), '-3', 'dB');
    assert.equal(harness.call('track.current').data.runtimeId, 2);
    runtimeId = 3;
    const changed = harness.call('controls.get', { key: 'track.volume' }).data.control;
    assert.equal(changed.observed, null);
    assert.equal(changed.display, null);
    assert.equal(harness.call('track.current').data.runtimeId, 3);
    expectError(harness.call('controls.set', { key: 'track.volume', value: 0.5,
        expectedTrackUniqueId: 'track-uid-2', expectedTrackRuntimeId: 2 }), 'TRACK_CHANGED');
    expectError(harness.call('track.navigate', { direction: 'next', expectedUniqueId: 'track-uid-2',
        expectedRuntimeId: 2 }), 'TRACK_CHANGED');
    expectError(harness.call('controls.set', { key: 'transport.cycle', value: 1,
        expectedTrackRuntimeId: 3 }), 'INVALID_ARGUMENT');
    expectError(harness.call('controls.set', { key: 'track.volume', value: 0.5,
        expectedTrackRuntimeId: 3 }), 'INVALID_ARGUMENT');
    assert.equal(harness.writes.length, 0);
    assert.equal(harness.state.trackMoves.length, 0);
    assert.equal(harness.call('controls.set', { key: 'track.volume', value: 0.5,
        expectedTrackUniqueId: 'track-uid-2', expectedTrackRuntimeId: 3 }).data.execution, 'submitted');
    assert.equal(harness.call('track.navigate', { direction: 'next', expectedUniqueId: 'track-uid-2',
        expectedRuntimeId: 3 }).data.execution, 'submitted');
});

test('an unavailable selected channel revokes prior observations even if the same identity returns', () => {
    const harness = fixture();
    harness.emit('track.volume', 0.6);
    assert.equal(harness.call('controls.get', { key: 'track.volume' }).data.control.observed.value, 0.6);
    harness.state.selectedTrackId = '';
    expectError(harness.call('controls.get', { key: 'track.volume' }), 'NO_TRACK_SELECTED');
    harness.state.selectedTrackId = 'track-uid-2';
    assert.equal(harness.call('controls.get', { key: 'track.volume' }).data.control.observed, null);
    harness.emit('track.volume', 0.4);
    const channel = harness.host.mTrackSelection.mMixerChannel;
    const getRuntimeID = channel.getRuntimeID;
    delete channel.getRuntimeID;
    expectError(harness.call('controls.get', { key: 'track.volume' }), 'API_UNAVAILABLE');
    channel.getRuntimeID = getRuntimeID;
    assert.equal(harness.call('controls.get', { key: 'track.volume' }).data.control.observed, null);
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
    const harness = mixerFixture((api, state, { host }) => {
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
    const harness = mixerFixture((api, state, { host }) => {
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
    // Selected-track controls belong to the main page: their feedback is not admitted here.
    harness.emit('track.volume', 0.8);
    const offPage = harness.call('controls.get', { key: 'track.volume' }).data.control;
    assert.equal(offPage.observed, null);
    assert.equal(offPage.available, false);
    assert.equal(offPage.error.code, 'PAGE_INACTIVE');
    expectError(harness.call('controls.set', { key: 'track.volume', value: 0.5 }), 'PAGE_INACTIVE');
    assert.equal(harness.call('controls.set', { key: 'mixer.channel.0.selected', value: 1,
        expectedChannelUniqueId: ids[0] }).data.execution, 'submitted');
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
    const harness = mixerFixture((api, state, { host }) => {
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
    const harness = mixerFixture((api, state, { host }) => {
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
    const harness = mixerFixture((api, state, { host }) => {
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
    const harness = mixerFixture((api, state, { host }) => {
        host.mMixConsole.makeMixerBankZone = () => ({ makeMixerBankChannel: () => ({
            mValue: {}, mPreFilter: { mGain: {} }, getUniqueIDString: () => '', getRuntimeID: () => 1
        }) });
    });
    const group = listAll(harness).groups['mixer.channel.0.filter'];
    assert.equal(group.available, false);
    assert.equal(group.error.code, 'NO_CHANNEL');
    assert.equal(group.channel.uniqueId, null);
});

test('bank insert viewers require channel and plugin identities and navigation invalidates observations', () => {
    const ids = Array.from({ length: 8 }, (_, i) => `id-${i}`), viewers = {};
    const harness = mixerFixture((api, state, { host }) => {
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
    assert.equal(harness.call('controls.get', { key }).data.control.readOnly, false);
    expectError(harness.call('controls.set', { key, value: 1, expectedChannelUniqueId: ids[0] }), 'CONFIRMATION_REQUIRED');
    const a = { name: 'A', vendor: 'V', version: '1', formatVersion: '3' };
    expectError(harness.call('controls.set', { key: group + '.parameter.0', value: 1,
        expectedChannelUniqueId: ids[0], expectedPluginIdentity: a }), 'PLUGIN_UNOBSERVED');
    viewer.mOnChangePluginIdentity(harness.device, harness.currentMapping(), 'A', 'V', '1', '3');
    viewer.mOn.mOnProcessValueChange(harness.device, harness.currentMapping(), 1);
    viewer.mOnChangePluginIdentity(harness.device, harness.currentMapping(), 'B', 'V', '1', '3');
    viewer.mOnChangePluginIdentity({}, harness.currentMapping(), 'Wrong device', 'V', '1', '3');
    viewer.mOnChangePluginIdentity(harness.device, {}, 'Wrong mapping', 'V', '1', '3');
    assert.equal(harness.call('controls.get', { key }).data.control.observed, null);
    assert.equal(listAll(harness).groups[group].pluginIdentity.name, 'B');
    const b = { ...a, name: 'B' };
    expectError(harness.call('controls.set', { key, value: 1, expectedChannelUniqueId: ids[0], expectedPluginIdentity: a }), 'PLUGIN_CHANGED');
    for (const writable of [key, group + '.parameter.0']) {
        assert.deepEqual(harness.call('controls.get', { key: writable }).data.control.pluginIdentity, b);
        assert.equal(harness.call('controls.set', { key: writable, value: 0.5,
            expectedChannelUniqueId: ids[0], expectedPluginIdentity: b }).data.execution, 'submitted');
    }
    viewer.mOnChangePluginIdentity(harness.device, harness.currentMapping(), null, 'V', '1', '3');
    expectError(harness.call('controls.set', { key, value: 1, expectedChannelUniqueId: ids[0], expectedPluginIdentity: b }), 'PLUGIN_UNOBSERVED');
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
    const harness = mixerFixture((api, state, { host }) => {
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
    const harness = mixerFixture((api, state, { host }) => {
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
    assert.equal(result.readOnly, false);
    assert.equal(harness.call('controls.set', { key: 'mixer.channel.7.insert.slot.15.viewer.next', value: 1,
        expectedChannelUniqueId: 'id-7' }).data.execution, 'submitted');
});

test('bank channel missing identities and wrong identifier fields fail closed', () => {
    const harness = mixerFixture((api, state, { host }) => {
        host.mMixConsole.makeMixerBankZone = () => ({ makeMixerBankChannel: () => ({
            mValue: { mVolume: {} }, getUniqueIDString: () => '', getRuntimeID: () => 1
        }) });
    });
    expectError(harness.call('controls.get', { key: 'mixer.channel.0.volume' }), 'NO_CHANNEL');
    expectError(harness.call('controls.set', { key: 'mixer.channel.0.volume', value: 0.5 }), 'CONFIRMATION_REQUIRED');
    harness.usePage('main');
    expectError(harness.call('controls.set', { key: 'track.volume', value: 0.5, expectedChannelUniqueId: 'id' }), 'INVALID_ARGUMENT');
    expectError(harness.call('controls.set', { key: 'mixer.channel.0.volume', value: 0.5, expectedChannelUniqueId: 'id' }), 'PAGE_INACTIVE');
});

test('bank slot runtime replacement invalidates admission even when its unique ID is unchanged', () => {
    let runtimeId = 100;
    const harness = mixerFixture((api, state, { host }) => {
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
    const harness = mixerFixture((api, state, { host }) => {
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
    const harness = mixerFixture((api, state, { host, page }) => {
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
        version: '16.0.5', writes: [], lockWrites: [], pluginWrites: [], commandRuns: [], surfaces: {}, tempoWrites: [], timeWrites: [], trackMoves: [],
        accesses: {}, portNames: [], detectionNames: [], frames: [], replies: [], pageNames: [],
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
            setParameterEditLockState(activeMapping, objectId, tag, locked) {
                assert.equal(activeMapping, mapping);
                state.lockWrites.push({ objectId, tag, locked });
                parameter(objectId, tag).locked = locked;
            },
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
    let activePage = page;
    function switchPage(next) {
        if (activePage.mOnDeactivate) activePage.mOnDeactivate(device, mapping);
        mapping = {}; activePage = next;
        next.mOnActivate(device, mapping);
    }
    page.mAction = { mActivate: { trigger() { switchPage(page); } } };
    const savePage = { makeCommandBinding: page.makeCommandBinding,
        mAction: { mActivate: { trigger() { switchPage(savePage); } } } };
    // The fixture shares one host model between the main and mixer pages; real pages own separate host objects.
    const mixerPage = { mHostAccess: host,
        makeActionBinding(...values) { return page.makeActionBinding(...values); },
        makeValueBinding(...values) { return page.makeValueBinding(...values); },
        makeCommandBinding(...values) { return page.makeCommandBinding(...values); },
        mAction: { mActivate: { trigger() { switchPage(mixerPage); } } } };
    const pagesByName = { 'CubaseAI MCP': page, 'CubaseAI MCP Save': savePage, 'CubaseAI MCP Mixer': mixerPage };
    const driver = {
        mPorts: {
            makeMidiInput(name) { state.portNames.push(name); return input; },
            makeMidiOutput(name) { state.portNames.push(name); return output; }
        },
        makeDetectionUnit() { return detection; },
        mMapping: { makePage(name) { assert.ok(pagesByName[name], name); state.pageNames.push(name); return pagesByName[name]; } },
        mSurface: {
            makeButton(x, y, w, h) {
                assert.deepEqual([x, y, w, h], [0, 0, 1, 1]);
                const value = this.makeCustomValueVariable('command.project.save');
                value.getProcessValue = () => 0;
                value.mMidiBinding = { setInputPort(port) { assert.equal(port, input); return this; },
                    setIsConsuming(value) { assert.equal(value, true); return this; },
                    bindToNote(channel, note) { assert.deepEqual([channel, note], [0, 1]); return this; } };
                return { mSurfaceValue: value };
            },
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
        activePage.mOnIdle(device, mapping);
        assert.ok(state.frames.length - before <= 12, 'frame budget exceeded');
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
    function activate(beforeActivate) {
        activePage = page;
        mapping = {};
        if (beforeActivate) beforeActivate(device, mapping);
        page.mOnActivate(device, mapping);
    }
    activate();
    const status = transact('bridge.status', {});
    const harness = {
        ...state, state, api, bridge, host, page, savePage, mixerPage, device, nodes, receive, tick, transact, activate, status,
        currentMapping() { return mapping; },
        currentPage() { return activePage; },
        call(op, args = {}, id) { return transact(op, { session: harness.session, ...args }, id); },
        usePage(key) {
            const reply = harness.call('pages.activate', { page: key });
            assert.equal(reply.ok, true, JSON.stringify(reply));
            harness.session = reply.data.session;
            return reply.data;
        },
        emit(key, amount) { state.surfaces[key].mOnProcessValueChange(device, amount, 0); },
        deactivate() { activePage.mOnDeactivate(device, mapping); },
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

// Mixer bank controls live on the separate mixer mapping page.
function mixerFixture(configure, logger) {
    const harness = fixture(configure, logger);
    harness.usePage('mixer');
    return harness;
}

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

test('command definitions are a fixed allowlist', () => {
    const keys = commands.map(command => command.key);
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(new Set(commands.map(command => command.category + '\u0000' + command.name)).size, commands.length);
    assert.ok(commands.length >= 150 && commands.length <= 256);
    assert.deepEqual(commands.filter(command => ['edit.undo', 'edit.redo', 'midi.quantize', 'project.save'].includes(command.key))
        .map(command => [command.key, command.category, command.name]), [
        ['edit.undo', 'Edit', 'Undo'],
        ['edit.redo', 'Edit', 'Redo'],
        ['midi.quantize', 'MIDI', 'Quantize'],
        ['project.save', 'File', 'Save']
    ]);
    assert.ok(Object.isFrozen(commands));
    assert.ok(commands.every(command => Object.isFrozen(command) && command.context && command.group &&
        /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/.test(command.key) && ['verified', 'submitted', 'unverified'].includes(command.live)));
    // Commands that open a dialog or need typed input are never bound.
    const forbidden = /^(Save As|Open|New|Close|Quit|Revert|Import |Export MIDI File|Export Audio Mixdown$|Save as Template|Preferences|Key Commands|Setup|Repeat$|Transpose$|Velocity$|Delete Notes|Merge MIDI|Dissolve Part$|Detect Silence|Bounce|Rename|Input )/;
    // The export window is the one host window that a tool opens on purpose; it is reachable only through that tool.
    assert.deepEqual(commands.filter(command => !command.tool && command.category !== 'Audio' && forbidden.test(command.name)).map(command => command.key), []);
    assert.deepEqual(commands.filter(command => command.tool).map(command => [command.key, command.tool]), [
        ['track.removeSelected', 'cubase_track_edit'], ['export.openMixdownWindow', 'cubase_audio_export'], ['export.perform', 'cubase_audio_export']]);
    // Commands that opened a window in the session-30 live probe stay out of the table.
    const opened = ['AddTrack\u0000Audio', 'AddTrack\u0000Instrument', 'AddTrack\u0000MIDI', 'AddTrack\u0000FX Channel', 'AddTrack\u0000Group Channel',
        'AddTrack\u0000Folder', 'AddTrack\u0000Ruler', 'Edit\u0000Insert Tempo Event at Cursor', 'File\u0000Export Audio Mixdown Simple',
        'Mixer\u0000Add Track To Selected: Group Channel', 'Mixer\u0000Add Track To Selected: FX Channel'];
    assert.deepEqual(commands.filter(command => opened.includes(command.category + '\u0000' + command.name)).map(command => command.key), []);
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
    assert.equal(status.bridgeRevision, '2026-11-10-coverage-3.14');
    assert.deepEqual(status.policy, { backgroundOnly: true, fallback: false });
    assert.equal(status.discovery.controlTotal, 135);
    assert.equal(harness.call('objects.list', { root: 'trackSelection' }).data.baseObject.uniqueIdString, 'uid-1');
    assert.ok(listAll(harness).controls.every(control => control.observed === null));
    const listedCommands = [];
    for (let offset = 0; offset !== null;) {
        const listing = harness.call('commands.list', { offset, limit: 64 }).data;
        listedCommands.push(...listing.commands.map(command => command.key));
        offset = listing.nextOffset;
    }
    assert.deepEqual(listedCommands, commands.map(command => command.key));
    assert.deepEqual(harness.pageNames, ['CubaseAI MCP', 'CubaseAI MCP Mixer', 'CubaseAI MCP Save']);
    assert.equal(status.page, 'main');
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

test('parameter edit locks require observed identity and matching host lock state', () => {
    const h = fixture();
    const args = { root: 'trackSelection', objectId: 2, tag: 101, locked: true, expectedLocked: false };
    expectError(h.call('parameters.lock', args), 'OBJECT_UNOBSERVED');
    h.call('objects.list', { root: 'trackSelection' });
    expectError(h.call('parameters.lock', args), 'PARAMETER_UNOBSERVED');
    h.call('parameters.list', { root: 'trackSelection', objectId: 2 });
    expectError(h.call('parameters.lock', { ...args, locked: 1 }), 'INVALID_ARGUMENT');
    expectError(h.call('parameters.lock', { ...args, expectedLocked: true }), 'LOCK_STATE_CONFLICT');
    const access = h.accesses.trackSelection, setter = access.setParameterEditLockState;
    delete access.setParameterEditLockState;
    expectError(h.call('parameters.lock', args), 'API_UNAVAILABLE');
    access.setParameterEditLockState = setter;
    const result = h.call('parameters.lock', args).data;
    assert.equal(result.execution, 'submitted');
    assert.equal(result.beforeLocked, false);
    assert.equal(result.requestedLocked, true);
    assert.deepEqual(h.state.lockWrites, [{ objectId: 2, tag: 101, locked: true }]);
    assert.equal(h.call('parameters.get', args).data.parameter.locked, true);
    expectError(h.call('parameters.set', { ...args, mode: 'normalized', value: 0.5 }), 'PARAMETER_LOCKED');
    assert.equal(h.call('parameters.lock', { ...args, locked: false, expectedLocked: true }).data.execution, 'submitted');
    assert.equal(h.call('parameters.get', args).data.parameter.locked, false);
});

test('edit-lock submission rejects invalidated parameters and records uncertain setter errors', () => {
    const h = fixture(); observeParameters(h);
    const args = { root: 'trackSelection', objectId: 2, tag: 101, locked: true, expectedLocked: false };
    const access = h.accesses.trackSelection, getter = access.getParameterEditLockState;
    access.getParameterEditLockState = function (mapping, objectId, tag) {
        const value = getter.call(this, mapping, objectId, tag);
        access.mOnObjectWillBeRemoved(h.device, mapping, objectId);
        return value;
    };
    expectError(h.call('parameters.lock', args), 'PARAMETER_STALE');
    assert.equal(h.state.lockWrites.length, 0);
    access.getParameterEditLockState = getter;
    observeParameters(h);
    access.setParameterEditLockState = function (mapping, objectId, tag, locked) {
        h.nodes.get(objectId).parameters.find(item => item.tag === tag).locked = locked;
        throw new Error('uncertain host result');
    };
    const result = h.call('parameters.lock', args);
    expectError(result, 'HOST_ERROR');
    assert.equal(result.error.execution, 'submitted');
    assert.equal(h.nodes.get(2).parameters[0].locked, true);
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
    // The press stays held until the next idle callback releases it.
    assert.deepEqual(harness.writes.map(write => [write.key, write.value]), [['command.edit.undo', 1]]);
    harness.tick();
    assert.deepEqual(harness.writes.map(write => [write.key, write.value]), [['command.edit.undo', 1], ['command.edit.undo', 0]]);
    delete harness.state.surfaces['command.edit.redo'].command.canPerform;
    expectError(harness.call('commands.execute', { key: 'edit.redo', confirmCurrentSelection: true }), 'API_UNAVAILABLE');
    assert.equal(harness.commandRuns.length, 1);
    expectError(harness.call('commands.execute', { key: 'project.save' }), 'SAVE_INPUT_REQUIRED');
    const save = { key: 'project.save', confirmCurrentSelection: true, inputDeadline: Date.now() + 10000 };
    harness.state.commandAllowed = false;
    expectError(harness.call('commands.prepare', save), 'COMMAND_UNAVAILABLE');
    harness.session = harness.transact('bridge.status', {}).data.session;
    harness.state.commandAllowed = true;
    const prepared = harness.call('commands.prepare', save).data;
    assert.equal(prepared.execution, 'prepared_not_submitted');
    harness.session = prepared.session;
    assert.equal(harness.call('commands.result', { token: prepared.token }).data.execution, 'awaiting_input');
    harness.state.surfaces['command.project.save'].command.mOnValueChange(harness.device, harness.currentMapping(), 1);
    assert.equal(harness.call('commands.result', { token: prepared.token }).data.bindingObserved, true);
    const finished = harness.call('commands.finish', { token: prepared.token }).data;
    assert.equal(finished.returnedToMain, true); harness.session = finished.session;
    assert.deepEqual(harness.commandRuns, ['Undo']);
    assert.equal(harness.writes.some(write => write.key === 'command.project.save'), false);
});

test('commands press and release in separate idle callbacks and count host binding events', () => {
    const harness = fixture();
    const surface = harness.state.surfaces['command.edit.undo'];
    const writes = () => harness.writes.filter(write => write.key === 'command.edit.undo').map(write => write.value);
    const first = harness.call('commands.execute', { key: 'edit.undo', confirmCurrentSelection: true }).data;
    assert.equal(first.bindingEventsBefore, 0);
    surface.command.mOnValueChange(harness.device, harness.currentMapping(), 1);
    const observed = harness.call('commands.get', { key: 'edit.undo' }).data.command;
    assert.equal(observed.bindingEvents, 1);
    assert.equal(observed.lastRequestId, first.requestId);
    assert.equal(observed.context.length > 0, true);
    assert.deepEqual(writes(), [1, 0]);
    surface.command.mOnValueChange(harness.device, harness.currentMapping(), 0);
    assert.equal(harness.call('commands.get', { key: 'edit.undo' }).data.command.bindingEvents, 1);
    // Two queued executions of one command never share an idle callback with its release.
    const start = harness.replies.length;
    const ids = [1, 2].map(() => harness.receive('commands.execute', { session: harness.session, key: 'edit.undo', confirmCurrentSelection: true }));
    harness.tick();
    assert.deepEqual(writes(), [1, 0, 1]);
    harness.tick();
    assert.deepEqual(writes(), [1, 0, 1, 0]);
    assert.equal(harness.replies.slice(start).filter(reply => ids.includes(reply.id)).length, 1);
    harness.tick();
    assert.deepEqual(writes(), [1, 0, 1, 0, 1]);
    assert.equal(harness.replies.slice(start).filter(reply => ids.includes(reply.id) && reply.ok).length, 2);
    assert.deepEqual(harness.commandRuns, ['Undo', 'Undo', 'Undo']);
    const listed = harness.call('commands.list', { group: 'marker', limit: 64 }).data;
    assert.equal(listed.total, listed.commands.length);
    assert.ok(listed.commands.every(command => command.group === 'marker' && command.context === undefined));
    assert.ok(listed.groups.track > 20);
    expectError(harness.call('commands.get', { key: 'file.quit' }), 'COMMAND_NOT_ALLOWED');
    expectError(harness.call('commands.list', { group: '' }), 'INVALID_ARGUMENT');
});

test('tempo arriving immediately before activation is adopted only for that mapping', () => {
    const h = fixture(), display = h.host.mTransport.mTimeDisplay;
    h.deactivate();
    h.activate((device, mapping) => display.mOnChangeTempoBPM(device, mapping, 134));
    h.session = h.transact('bridge.status', {}).data.session;
    assert.equal(h.call('transport.get').data.observed.tempo.bpm, 134);
    h.deactivate();
    display.mOnChangeTempoBPM(h.device, {}, 199);
    h.activate(); h.session = h.transact('bridge.status', {}).data.session;
    assert.equal(h.call('transport.get').data.observed.tempo, null);
});

test('a project reopening on the saved internal page returns without issuing Save', () => {
    const h = fixture();
    h.savePage.mAction.mActivate.trigger(h.currentMapping());
    h.tick();
    h.session = h.transact('bridge.status', {}).data.session;
    assert.equal(h.call('transport.get').ok, true);
    assert.equal(h.commandRuns.length, 0);
    assert.equal(h.writes.some(write => write.key === 'command.project.save'), false);
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

test('surface echo alone does not claim a submitted host change was observed', () => {
    const harness = fixture();
    const surface = harness.surfaces['track.volume'];
    surface.hostValue.mOnProcessValueChange(harness.device, harness.currentMapping(), 0.7890625);
    const response = harness.call('controls.set', { key: 'track.volume', value: 0.25 });
    assert.equal(response.data.execution, 'submitted');
    assert.equal(response.data.before.value, 0.7890625);
    assert.equal(response.data.after.value, 0.7890625);
    assert.equal(harness.call('controls.get', { key: 'track.volume' }).data.control.observed.value, 0.7890625);
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
    assert.deepEqual(listed.groups['track.send'], { available: true, count: 2, page: 'main' });
    assert.deepEqual(listed.groups['track.cueSend'], { available: true, count: 1, page: 'main' });
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

function pluginPageFixture() {
    const slots = [], ids = Array.from({ length: 8 }, (_, i) => `plugin-channel-${i}`);
    const runtimes = ids.map((_, i) => 100 + i);
    let trackRuntime = 2, trackSlot;
    function plugin() {
        return { mParameterBankZone: { makeParameterValue: () => ({}),
            mAction: { mPrevBank: {}, mNextBank: {}, mResetBank: {} } } };
    }
    const harness = fixture((api, state, { host }) => {
        trackSlot = plugin();
        host.mTrackSelection.mMixerChannel.mInstrumentPluginSlot = trackSlot;
        host.mTrackSelection.mMixerChannel.getRuntimeID = () => trackRuntime;
        host.mMixConsole.makeMixerBankZone = () => {
            let index = 0;
            return { mAction: { mNextBank: {} }, makeMixerBankChannel() {
                const n = index++, strip = {};
                for (const name of ['mGate', 'mCompressor', 'mLimiter', 'mSaturator', 'mTools']) strip[name] = plugin();
                const channel = { mValue: {}, getUniqueIDString: () => ids[n], getRuntimeID: () => runtimes[n],
                    mInstrumentPluginSlot: plugin(), mInsertAndStripEffects: { mStripEffects: strip } };
                slots.push(channel); return channel;
            } };
        };
    });
    return { harness, trackSlot, slots, ids, runtimes, setTrackRuntime(value) { trackRuntime = value; } };
}

const pluginIdentity = { name: 'Synth', vendor: 'Vendor', version: '1', formatVersion: '3' };
function observePlugin(h, slot, identity = pluginIdentity, device = h.device, mapping = h.currentMapping()) {
    slot.mOnChangePluginIdentity(device, mapping, identity.name, identity.vendor, identity.version, identity.formatVersion);
}
function checkPluginIdentity(actual, expected) {
    assert.ok(actual);
    for (const key of Object.keys(expected)) assert.equal(actual[key], expected[key]);
}

test('instrument and bank strip parameter pages bind all slots with guarded feedback and writes', () => {
    const { harness: h, trackSlot, slots, ids } = pluginPageFixture();
    const targets = [['track.instrument', trackSlot, { expectedTrackUniqueId: 'track-uid-2' }]];
    for (const index of [0, 7]) {
        targets.push([`mixer.channel.${index}.instrument`, slots[index].mInstrumentPluginSlot, { expectedChannelUniqueId: ids[index] }]);
        for (const [name, field] of [['gate', 'mGate'], ['compressor', 'mCompressor'], ['limiter', 'mLimiter'],
            ['saturator', 'mSaturator'], ['tools', 'mTools']])
            targets.push([`mixer.channel.${index}.strip.${name}`, slots[index].mInsertAndStripEffects.mStripEffects[field],
                { expectedChannelUniqueId: ids[index] }]);
    }
    for (const [group, slot, guard] of targets) {
        h.usePage(group.startsWith('mixer.') ? 'mixer' : 'main');
        const key = group + '.parameter.7';
        for (let i = 0; i < 8; i++) assert.equal(h.call('controls.get', { key: group + '.parameter.' + i }).data.control.available, true);
        observePlugin(h, slot);
        const control = h.call('controls.get', { key }).data.control;
        checkPluginIdentity(control.pluginIdentity, pluginIdentity);
        h.emit(key, 0.37);
        assert.equal(h.call('controls.get', { key }).data.control.observed.value, 0.37);
        assert.equal(h.call('controls.set', { key, value: 0.6, ...guard, expectedPluginIdentity: pluginIdentity }).data.execution, 'submitted');
        assert.equal(h.writes.at(-1).key, key);
        for (const action of ['previous', 'next', 'reset'])
            assert.equal(h.call('controls.get', { key: group + '.bank.' + action }).data.control.available, true);
    }
    assert.notEqual(h.surfaces['mixer.channel.0.instrument.parameter.7'].hostValue,
        h.surfaces['mixer.channel.7.instrument.parameter.7'].hostValue);
});

test('plugin identity guards reject absent, invalid, stale and wrong callback identities', () => {
    const { harness: h, trackSlot } = pluginPageFixture();
    const key = 'track.instrument.parameter.7', track = { expectedTrackUniqueId: 'track-uid-2' };
    expectError(h.call('controls.set', { key, value: 0.5, ...track }), 'CONFIRMATION_REQUIRED');
    expectError(h.call('controls.set', { key, value: 0.5, ...track, expectedPluginIdentity: pluginIdentity }), 'PLUGIN_UNOBSERVED');
    observePlugin(h, trackSlot, pluginIdentity, {});
    observePlugin(h, trackSlot, pluginIdentity, h.device, {});
    expectError(h.call('controls.set', { key, value: 0.5, ...track, expectedPluginIdentity: pluginIdentity }), 'PLUGIN_UNOBSERVED');
    observePlugin(h, trackSlot, { ...pluginIdentity, name: '' });
    expectError(h.call('controls.set', { key, value: 0.5, ...track, expectedPluginIdentity: pluginIdentity }), 'PLUGIN_UNOBSERVED');
    observePlugin(h, trackSlot);
    expectError(h.call('controls.set', { key: 'track.volume', value: 0.5,
        expectedPluginIdentity: pluginIdentity }), 'INVALID_ARGUMENT');
    h.emit(key, 0.3);
    trackSlot.mOnChangePluginIdentity(h.device, h.currentMapping(), null, 'Vendor', '1', '3');
    assert.equal(h.call('controls.get', { key }).data.control.pluginIdentity, null);
    assert.equal(h.call('controls.get', { key }).data.control.observed, null);
    expectError(h.call('controls.set', { key, value: 0.5, ...track, expectedPluginIdentity: pluginIdentity }), 'PLUGIN_UNOBSERVED');
    observePlugin(h, trackSlot);
    expectError(h.call('controls.set', { key, value: 0.5, expectedPluginIdentity: pluginIdentity }), 'CONFIRMATION_REQUIRED');
    expectError(h.call('controls.set', { key, value: 0.5, expectedTrackUniqueId: 'other', expectedPluginIdentity: pluginIdentity }), 'TRACK_CHANGED');
    for (const field of Object.keys(pluginIdentity))
        expectError(h.call('controls.set', { key, value: 0.5, ...track,
            expectedPluginIdentity: { ...pluginIdentity, [field]: 'different' } }), 'PLUGIN_CHANGED');
    h.emit(key, 0.4);
    observePlugin(h, trackSlot, { ...pluginIdentity, name: 'Replacement' });
    assert.equal(h.call('controls.get', { key }).data.control.observed, null);
    expectError(h.call('controls.set', { key, value: 0.5, ...track, expectedPluginIdentity: pluginIdentity }), 'PLUGIN_CHANGED');
    h.deactivate(); h.activate();
    expectError(h.call('controls.set', { key, value: 0.5, ...track, expectedPluginIdentity: pluginIdentity }), 'STALE_SESSION');
});

test('plugin page navigation and channel or track runtime changes revoke identities', () => {
    const f = pluginPageFixture(), h = f.harness;
    const trackKey = 'track.instrument.parameter.7', bankKey = 'mixer.channel.7.instrument.parameter.7';
    const tg = { expectedTrackUniqueId: 'track-uid-2', expectedPluginIdentity: pluginIdentity };
    const bg = { expectedChannelUniqueId: f.ids[7], expectedPluginIdentity: pluginIdentity };
    observePlugin(h, f.trackSlot);
    expectError(h.call('controls.set', { key: 'track.instrument.bank.next', value: 0.5, ...tg }), 'INVALID_VALUE');
    h.emit(trackKey, 0.2);
    assert.equal(h.call('controls.set', { key: 'track.instrument.bank.next', value: 1, ...tg }).data.execution, 'submitted');
    assert.equal(h.call('controls.get', { key: trackKey }).data.control.observed, null);
    expectError(h.call('controls.set', { key: trackKey, value: 0.2, ...tg }), 'PLUGIN_UNOBSERVED');
    observePlugin(h, f.trackSlot); f.setTrackRuntime(3);
    expectError(h.call('controls.set', { key: trackKey, value: 0.2, ...tg }), 'PLUGIN_UNOBSERVED');
    h.usePage('mixer');
    h.call('controls.get', { key: bankKey });
    observePlugin(h, f.slots[7].mInstrumentPluginSlot);
    h.emit(bankKey, 0.3);
    assert.equal(h.call('controls.set', { key: 'mixer.channel.7.instrument.bank.reset', value: 1, ...bg }).data.execution, 'submitted');
    assert.equal(h.call('controls.get', { key: bankKey }).data.control.observed, null);
    expectError(h.call('controls.set', { key: bankKey, value: 0.2, ...bg }), 'PLUGIN_UNOBSERVED');
    observePlugin(h, f.slots[7].mInstrumentPluginSlot); f.runtimes[7]++;
    expectError(h.call('controls.set', { key: bankKey, value: 0.2, ...bg }), 'CHANNEL_CHANGED');
});

test('new plugin parameter pages report missing host branches', () => {
    const h = fixture((api, state, { host }) => {
        delete host.mTrackSelection.mMixerChannel.mInstrumentPluginSlot;
        host.mMixConsole.makeMixerBankZone = () => ({ makeMixerBankChannel: () => ({
            mValue: {}, getUniqueIDString: () => 'id', getRuntimeID: () => 1 }) });
    });
    for (const key of ['track.instrument.parameter.0', 'track.instrument.bank.next',
        'mixer.channel.7.instrument.parameter.7', 'mixer.channel.7.strip.gate.parameter.7'])
        assert.equal(h.call('controls.get', { key }).data.control.error.code, 'API_UNAVAILABLE');
});

test('plugin get preserves long identity fields for exact guards without expanding list summaries', () => {
    const { harness: h, trackSlot } = pluginPageFixture();
    const identity = Object.fromEntries(Object.keys(pluginIdentity).map(field => [field, field + '-'.repeat(150) + 'tail']));
    const key = 'track.instrument.parameter.7', guard = { expectedTrackUniqueId: 'track-uid-2' };
    observePlugin(h, trackSlot, identity);
    const item = h.call('controls.get', { key }).data.control;
    checkPluginIdentity(item.pluginIdentity, identity);
    assert.equal(h.call('controls.set', { key, value: 0.5, ...guard, expectedPluginIdentity: identity }).data.execution, 'submitted');
    for (const field of Object.keys(identity))
        expectError(h.call('controls.set', { key, value: 0.5, ...guard,
            expectedPluginIdentity: { ...identity, [field]: identity[field].slice(0, -1) + 'X' } }), 'PLUGIN_CHANGED');
    const listed = listAll(h).controls.find(control => control.key === key);
    if (listed.pluginIdentity) for (const field of Object.keys(identity))
        assert.ok(listed.pluginIdentity[field].length <= 129);
});

// ---- session 30: channel overview, transport object, pages, response replay ----------------

function channelFixture() {
    const harness = fixture();
    const parameters = tags => tags.map(tag => ({ tag, value: 0, display: `d${tag}`, locked: false }));
    const make = (objectId, typeName, title, tags, children = []) => harness.nodes.set(objectId, {
        objectId, children, uniqueIdString: `uid-${objectId}`, uniqueName: typeName, title, typeName, color: [0, 0, 0, 1], parameters: parameters(tags) });
    make(11, 'AudioChannel', 'Vocals', [4013, 4014, 1024, 4000, 1025, 1027, 1028, 4101, 4102, 4002, 4001, 4113], [13, 14]);
    make(13, 'InputFilter', 'Input Filter', [4201]);
    make(14, 'Panner', 'Panner', [4201, 4204]);
    make(12, 'MidiChannel', 'Bass', [1024, 4014, 4013, 1025, 1026, 1027, 1028, 4002, 4001, 4000, 4006, 4007, 4008]);
    // Cubase lists the last channel twice once tracks exist.
    harness.nodes.get(10).children = [11, 12, 12];
    // Names and dB texts are not percentages: keep the process value and store the text as given.
    harness.accesses.mixConsole.setParameterDisplayValue = (mapping, objectId, tag, value) => {
        assert.equal(mapping, harness.currentMapping());
        harness.writes.push({ kind: 'display', objectId, tag, value });
        harness.nodes.get(objectId).parameters.find(item => item.tag === tag).display = value;
    };
    return harness;
}

test('channel overview lists each channel once and admits the parameters behind its fields', () => {
    const harness = channelFixture();
    const listed = harness.call('channels.list').data;
    assert.equal(listed.total, 3);
    assert.equal(listed.duplicatesSkipped, 1);
    assert.equal(listed.nextOffset, null);
    assert.deepEqual(listed.items.map(item => [item.objectId, item.typeName, item.title, item.uniqueIdString]),
        [[11, 'AudioChannel', 'Vocals', 'uid-11'], [12, 'MidiChannel', 'Bass', 'uid-12']]);
    const [audio, midi] = listed.items;
    // An audio channel carries its pan on the Panner child, not on the input filter that shares the tag.
    assert.deepEqual(audio.fields.pan, { objectId: 14, tag: 4201, value: 0, display: 'd4201', writable: true });
    assert.deepEqual(midi.fields.pan, { objectId: 12, tag: 1026, value: 0, display: 'd1026', writable: true });
    assert.equal(audio.fields.midiChannel, null);
    assert.deepEqual([audio.fields.input.tag, audio.fields.output.tag, midi.fields.input.tag, midi.fields.output.tag], [4101, 4102, 4007, 4008]);
    assert.equal(midi.fields.output.writable, false);
    assert.equal(midi.fields.freeze, null);
    // Listed field parameters are admitted for the generic parameter operations.
    assert.equal(harness.call('parameters.set', { root: 'mixConsole', objectId: 14, tag: 4201, mode: 'normalized', value: 0.25 }).ok, true);
    assert.equal(harness.call('parameters.get', { root: 'mixConsole', objectId: 12, tag: 1024 }).data.parameter.display, 'd1024');
    expectError(harness.call('parameters.get', { root: 'mixConsole', objectId: 13, tag: 4201 }), 'OBJECT_UNOBSERVED');
    const paged = harness.call('channels.list', { offset: 1, limit: 1 }).data;
    assert.deepEqual([paged.items.length, paged.items[0].objectId, paged.nextOffset], [1, 12, 2]);
    assert.deepEqual(harness.call('channels.list', { offset: 2, limit: 1 }).data.items, []);
    harness.usePage('mixer');
    expectError(harness.call('channels.list'), 'PAGE_INACTIVE');
});

test('channel field writes need the listed identity and use the setter that matches the value', () => {
    const harness = channelFixture();
    const base = { objectId: 12, expectedUniqueId: 'uid-12' };
    expectError(harness.call('channels.set', { ...base, field: 'mute', value: true }), 'OBJECT_UNOBSERVED');
    harness.call('channels.list');
    expectError(harness.call('channels.set', { objectId: 12, field: 'mute', value: true }), 'CONFIRMATION_REQUIRED');
    expectError(harness.call('channels.set', { ...base, expectedUniqueId: 'uid-11', field: 'mute', value: true }), 'CHANNEL_CHANGED');
    expectError(harness.call('channels.set', { ...base, field: 'gain', value: 1 }), 'INVALID_ARGUMENT');
    expectError(harness.call('channels.set', { ...base, field: 'output', value: 1 }), 'READ_ONLY');
    expectError(harness.call('channels.set', { ...base, field: 'mute', value: 1 }), 'INVALID_VALUE');
    expectError(harness.call('channels.set', { ...base, field: 'name', value: '' }), 'INVALID_VALUE');
    expectError(harness.call('channels.set', { ...base, field: 'name', value: 'line\nbreak' }), 'INVALID_VALUE');
    expectError(harness.call('channels.set', { ...base, field: 'volume', value: 1.5 }), 'INVALID_VALUE');
    expectError(harness.call('channels.set', { objectId: 11, expectedUniqueId: 'uid-11', field: 'midiChannel', value: 1 }), 'READ_ONLY');
    assert.equal(harness.writes.length, 0);
    const renamed = harness.call('channels.set', { ...base, field: 'name', value: 'Bass Line' }).data;
    assert.equal(renamed.execution, 'submitted');
    assert.deepEqual(renamed.parameter, { objectId: 12, tag: 1024 });
    assert.equal(renamed.before.display, 'd1024');
    assert.equal(renamed.after.display, 'Bass Line');
    assert.equal(harness.call('channels.set', { ...base, field: 'mute', value: true }).data.after.value, 1);
    assert.equal(harness.call('channels.set', { ...base, field: 'selected', value: false }).ok, true);
    assert.equal(harness.call('channels.set', { ...base, field: 'volume', value: '-6' }).ok, true);
    assert.equal(harness.call('channels.set', { ...base, field: 'volume', value: 0.5 }).ok, true);
    assert.equal(harness.call('channels.set', { objectId: 11, expectedUniqueId: 'uid-11', field: 'pan', value: 0.25 }).ok, true);
    assert.deepEqual(harness.writes, [
        { kind: 'display', objectId: 12, tag: 1024, value: 'Bass Line' },
        { kind: 'process', objectId: 12, tag: 1027, value: 1 },
        { kind: 'process', objectId: 12, tag: 4000, value: 0 },
        { kind: 'display', objectId: 12, tag: 1025, value: '-6' },
        { kind: 'process', objectId: 12, tag: 1025, value: 0.5 },
        { kind: 'process', objectId: 14, tag: 4201, value: 0.25 }
    ]);
    harness.nodes.get(12).parameters.find(item => item.tag === 1028).locked = true;
    expectError(harness.call('channels.set', { ...base, field: 'solo', value: true }), 'PARAMETER_LOCKED');
    // A channel without the field reports that instead of writing a neighbouring parameter.
    harness.nodes.get(11).children = [13];
    harness.call('channels.list');
    expectError(harness.call('channels.set', { objectId: 11, expectedUniqueId: 'uid-11', field: 'pan', value: 0.5 }), 'FIELD_UNAVAILABLE');
    assert.equal(harness.writes.length, 6);
});

function transportFixture(titles = {}) {
    const harness = fixture();
    const tags = { start: 4015, stop: 4016, record: 4019, cycle: 4022, punchIn: 4020, punchOut: 4021, time: 4023, time2: 4101,
        timeFormat: 4025, timeFormat2: 4102, signature: 4027, cycleLeftTime: 4030, cycleRightTime: 4031, cycleDuration: 4051,
        metronomeOn: 4099, precountOn: 4100, returnToZero: 1, gotoEnd: 2, gotoNextMarker: 3, gotoPrevMarker: 4, stepBar: 5, stepBackBar: 6 };
    const displays = { time: '5. 1. 1.  0', time2: '0:00:08.000', timeFormat: 'Bars+Beats', timeFormat2: 'Seconds', signature: '4/4',
        cycleLeftTime: '1. 1. 1.  0', cycleRightTime: '9. 1. 1.  0', cycleDuration: '8. 0. 0.  0' };
    const values = { stop: 1, precountOn: 1 };
    const names = Object.keys(tags);
    harness.nodes.get(20).parameters = names.map(name => ({ tag: tags[name], value: values[name] || 0, display: displays[name] || 'Off', locked: false }));
    harness.accesses.transport.getParameterTitle = (mapping, objectId, tag) => {
        const name = names.find(candidate => tags[candidate] === tag);
        return titles[name] || name;
    };
    return { harness, tags };
}

test('transport state reads the titled transport parameters and writes actions and switches once', () => {
    const { harness, tags } = transportFixture();
    harness.host.mTransport.mTimeDisplay.mOnChangeTempoBPM(harness.device, harness.currentMapping(), 96);
    const state = harness.call('transport.state').data;
    assert.deepEqual({ playing: state.playing, stopped: state.stopped, recording: state.recording, cycle: state.cycle,
        metronome: state.metronome, precount: state.precount, signature: state.signature, tempo: state.tempo, baseObjectId: state.baseObjectId },
        { playing: false, stopped: true, recording: false, cycle: false, metronome: false, precount: true, signature: '4/4', tempo: { bpm: 96 }, baseObjectId: 20 });
    assert.deepEqual(state.position, { primary: '5. 1. 1.  0', secondary: '0:00:08.000', primaryFormat: 'Bars+Beats', secondaryFormat: 'Seconds' });
    assert.deepEqual([state.cycleLeft, state.cycleRight, state.cycleDuration], ['1. 1. 1.  0', '9. 1. 1.  0', '8. 0. 0.  0']);
    assert.equal(harness.writes.length, 0);
    expectError(harness.call('transport.action', { action: 'record' }), 'INVALID_ARGUMENT');
    expectError(harness.call('transport.set', { field: 'tempo', value: 100 }), 'INVALID_ARGUMENT');
    expectError(harness.call('transport.set', { field: 'cycle', value: 1 }), 'INVALID_VALUE');
    expectError(harness.call('transport.set', { field: 'signature', value: '3-4' }), 'INVALID_VALUE');
    expectError(harness.call('transport.set', { field: 'signature', value: '4/3' }), 'INVALID_VALUE');
    assert.equal(harness.writes.length, 0);
    const started = harness.call('transport.action', { action: 'start' }).data;
    assert.equal(started.execution, 'submitted');
    assert.equal(started.before.playing, false);
    const cycle = harness.call('transport.set', { field: 'cycle', value: true }).data;
    assert.deepEqual([cycle.before.cycle, cycle.after.cycle], [false, true]);
    const signature = harness.call('transport.set', { field: 'signature', value: '3/4' }).data;
    assert.deepEqual([signature.before.signature, signature.after.signature], ['4/4', '3/4']);
    assert.equal(harness.call('transport.set', { field: 'precount', value: false }).ok, true);
    assert.deepEqual(harness.writes, [
        { kind: 'process', objectId: 20, tag: tags.start, value: 1 },
        { kind: 'process', objectId: 20, tag: tags.cycle, value: 1 },
        { kind: 'display', objectId: 20, tag: tags.signature, value: '3/4' },
        { kind: 'process', objectId: 20, tag: tags.precountOn, value: 0 }
    ]);
    // The admitted transport tags also serve the generic parameter operations.
    assert.equal(harness.call('parameters.get', { root: 'transport', objectId: 20, tag: tags.time }).data.parameter.display, '5. 1. 1.  0');
});

test('a transport parameter with a different title is treated as absent', () => {
    const { harness } = transportFixture({ metronomeOn: 'somethingElse', gotoEnd: 'other' });
    const state = harness.call('transport.state').data;
    assert.equal(state.metronome, null);
    assert.equal(state.precount, true);
    expectError(harness.call('transport.set', { field: 'metronome', value: true }), 'API_UNAVAILABLE');
    expectError(harness.call('transport.action', { action: 'gotoEnd' }), 'API_UNAVAILABLE');
    assert.equal(harness.writes.length, 0);
});

test('status samples one command so a blocked host is visible, and composite-only commands need their tool', () => {
    const harness = fixture();
    assert.deepEqual(harness.status.data.commandGate, { key: 'transport.cycle', canPerform: true });
    harness.state.commandAllowed = false;
    assert.deepEqual(harness.transact('bridge.status', {}).data.commandGate, { key: 'transport.cycle', canPerform: false });
    harness.state.commandAllowed = true;
    const info = harness.call('commands.get', { key: 'track.removeSelected' }).data.command;
    assert.equal(info.tool, 'cubase_track_edit');
    expectError(harness.call('commands.execute', { key: 'track.removeSelected', confirmCurrentSelection: true }), 'COMPOSITE_REQUIRED');
    expectError(harness.call('commands.execute', { key: 'track.removeSelected', confirmCurrentSelection: true, tool: 'other' }), 'COMPOSITE_REQUIRED');
    assert.deepEqual(harness.commandRuns, []);
    assert.equal(harness.call('commands.execute', { key: 'track.removeSelected', confirmCurrentSelection: true, tool: 'cubase_track_edit' }).ok, true);
    assert.deepEqual(harness.commandRuns, ['Remove Selected Tracks']);
    harness.usePage('mixer');
    assert.equal(harness.transact('bridge.status', {}).data.commandGate, null);
});

test('pages are listed, activation returns a new session and main-only operations wait for the main page', () => {
    const harness = fixture();
    const listed = harness.call('pages.list').data;
    assert.equal(listed.active, 'main');
    assert.deepEqual(listed.pages.map(page => [page.key, page.available, page.active]), [['main', true, true], ['mixer', true, false]]);
    assert.ok(listed.pages[0].controlTotal > 0 && listed.pages[1].controlTotal > 0);
    assert.equal(listed.activation.page, 'main');
    const same = harness.call('pages.activate', { page: 'main' }).data;
    assert.deepEqual([same.changed, same.session], [false, harness.session]);
    expectError(harness.call('pages.activate', { page: 'save' }), 'INVALID_ARGUMENT');
    const origin = harness.session;
    const switched = harness.usePage('mixer');
    assert.deepEqual([switched.page, switched.changed, switched.originSession, switched.originPage], ['mixer', true, origin, 'main']);
    assert.notEqual(switched.session, origin);
    expectError(harness.transact('pages.list', { session: origin }), 'STALE_SESSION');
    assert.equal(harness.call('pages.list').data.active, 'mixer');
    for (const op of ['objects.list', 'commands.list', 'track.current', 'transport.get', 'transport.state', 'channels.list']) {
        expectError(harness.call(op, { root: 'trackSelection' }), 'PAGE_INACTIVE');
    }
    assert.equal(harness.call('host.info').ok, true);
    assert.equal(harness.call('controls.list').ok, true);
    harness.usePage('main');
    assert.equal(harness.call('objects.list', { root: 'trackSelection' }).ok, true);
});

test('a page that delivered host feedback but no surface feedback refuses binding writes', () => {
    const harness = fixture();
    const host = harness.surfaces['track.volume'].hostValue;
    for (let count = 0; count < 63; count++) host.mOnProcessValueChange(harness.device, harness.currentMapping(), count / 100);
    assert.equal(harness.call('pages.list').data.activation.surfaceInput, 'unobserved');
    assert.equal(harness.call('controls.set', { key: 'track.volume', value: 0.5 }).ok, true);
    // Each write above echoed through the fixture surface, so start again from a fresh activation.
    harness.activate();
    harness.session = harness.transact('bridge.status', {}).data.session;
    const again = harness.surfaces['track.volume'].hostValue;
    for (let count = 0; count < 64; count++) again.mOnProcessValueChange(harness.device, harness.currentMapping(), count / 100);
    const activation = harness.call('pages.list').data.activation;
    assert.deepEqual([activation.hostCallbacks, activation.surfaceCallbacks, activation.surfaceInput], [64, 0, 'stalled']);
    const before = harness.writes.length;
    expectError(harness.call('controls.set', { key: 'track.volume', value: 0.5 }), 'SURFACE_INACTIVE');
    expectError(harness.call('commands.execute', { key: 'edit.undo', confirmCurrentSelection: true }), 'SURFACE_INACTIVE');
    assert.equal(harness.writes.length, before);
});

test('no bridge operation unloads a plug-in, because the host call for it prompts', () => {
    const harness = fixture();
    const manager = harness.accesses.trackSelection.mPluginManager;
    manager.resetSlotPlugin = () => assert.fail('resetSlotPlugin opens a blocking host prompt and must never be called');
    harness.call('objects.list', { root: 'trackSelection' });
    expectError(harness.call('plugins.reset', { root: 'trackSelection', objectId: 2, confirmRemoval: true }), 'UNKNOWN_OPERATION');
    assert.deepEqual(harness.pluginWrites, []);
});

test('a stored response is returned again by request ID without repeating the operation', () => {
    const harness = fixture();
    const id = 'ab'.repeat(16);
    const first = harness.transact('controls.set', { session: harness.session, key: 'track.volume', value: 0.5 }, id);
    assert.equal(first.ok, true);
    const writes = harness.writes.length;
    const replay = harness.call('bridge.response', { requestId: id }).data;
    assert.equal(replay.state, 'completed');
    assert.equal(replay.sameInstance, true);
    assert.deepEqual(replay.response, first);
    assert.equal(harness.writes.length, writes);
    // A response look-up needs no current session and is not itself stored.
    const lookup = harness.transact('bridge.response', { requestId: id, session: 'other-1' });
    assert.deepEqual([lookup.data.state, lookup.data.sameInstance], ['completed', false]);
    assert.equal(harness.call('bridge.response', { requestId: lookup.id }).data.state, 'evicted');
    const never = harness.call('bridge.response', { requestId: 'cd'.repeat(16) }).data;
    assert.deepEqual([never.state, never.sameInstance], ['unknown', true]);
    expectError(harness.call('bridge.response', { requestId: 'short' }), 'INVALID_ARGUMENT');
    // A queued request is reported as pending until an idle callback executes it.
    const queued = harness.receive('controls.get', { session: harness.session, key: 'track.volume' });
    const probe = harness.receive('bridge.response', { session: harness.session, requestId: queued });
    harness.tick();
    harness.tick();
    const answered = harness.replies.find(reply => reply.id === probe);
    assert.ok(['pending', 'completed'].includes(answered.data.state));
    // The same request ID is never executed twice, also after a page activation.
    harness.usePage('mixer');
    harness.usePage('main');
    expectError(harness.transact('controls.set', { session: harness.session, key: 'track.volume', value: 0.9 }, id), 'DUPLICATE_ID');
    assert.equal(harness.writes.filter(write => write.key === 'track.volume').length, 1);
});

test('request identifiers are remembered until their deadline and far deadlines are refused', () => {
    const harness = fixture();
    const far = harness.transact('controls.get', { session: harness.session, key: 'track.volume' }, undefined, Date.now() + 601000);
    expectError(far, 'INVALID_REQUEST');
    assert.equal(far.error.execution, 'not_started');
    const id = 'ef'.repeat(16), deadline = Date.now() + 2000;
    assert.equal(harness.transact('controls.get', { session: harness.session, key: 'track.volume' }, id, deadline).ok, true);
    expectError(harness.transact('controls.get', { session: harness.session, key: 'track.volume' }, id, deadline), 'DUPLICATE_ID');
    assert.equal(harness.call('bridge.response', { requestId: id }).data.state, 'completed');
});
