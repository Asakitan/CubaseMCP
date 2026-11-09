# MIDI Remote coverage audit

This audit compares the bridge to the installed Cubase 16.0.5 declaration file `midiremote_factory_scripts/.api/v1/midiremote_api_v1.d.ts`. A declaration establishes API shape, not availability in Cubase AI or proof of live behavior. Fixture results do not establish host support.

## Implemented declaration-backed paths

| Area | Bridge surface | Boundary |
| --- | --- | --- |
| Host access and DirectAccess | Four observed roots, object and parameter discovery, guarded parameter writes, plugin collection and slot assignment | Objects and tags must be observed in the active session; host methods and edition features can be unavailable. |
| Transport | Value bindings, tempo and primary/secondary locator callbacks and setters | Host submission is not playback or persistence evidence. |
| Selected track | Identity, previous/next actions, channel values, pre-filter, EQ, sends, cue sends, instrument and quick controls | Track feedback is invalidated on identity change; optional expected identity guards writes. Meter values are read-only. |
| Selected channel strip | `track.strip.{gate,compressor,limiter,saturator,tools}.{on,bypass,automationRead,automationWrite}` | The five `MR_HostStripEffectSlot*` declarations expose these values under `mInsertAndStripEffects.mStripEffects`. Missing branches report unavailable; edit-window controls are deliberately omitted. |
| Control Room | Root values, main channel, and cue, phones, external input, talkback and monitor channel values | Indexed bindings use the corresponding `getMax*Channels` and `get*ChannelByIndex` methods. Maxima are API limits, not proof of configured channels. Across all five groups, at most 16 indexed channels are bound; a group exceeding the remaining budget reports `HOST_LIMIT_EXCEEDED` without partial admission. Missing branches or values report `API_UNAVAILABLE`. |
| Focused quick controls | Eight bindings and focus lock | Actual availability comes from the host. |
| Commands | Fixed command bindings only | A performable binding and submission do not prove the desired project state or disk persistence. |

## Declared but not implemented

- Control Room indexed source-selection values and the downmix-next action are not bound.
- `MR_MixerBankZone` configuration, navigation and bank channel bindings are not exposed; current mixer support is DirectAccess discovery and selected-channel controls.
- `MR_HostInsertEffectViewer`, its slot filters and parameter bank actions, and the strip slots' parameter banks and plugin identity callbacks are not directly exposed as named controls. DirectAccess support does not imply every such object is reachable in a particular edition or project.
- `MR_MixerChannelValues.getVUChannelMeterByChannelIndex` and `getVUMeterMaxByChannelIndex` are not bound; aggregate meters are exposed read-only. The inspected declarations provide no corresponding selected-channel meter count, so arbitrary indices are not admitted.
- Mouse-cursor bindings and editor/plugin open controls are intentionally omitted from the background-only surface.

The declarations do not establish a general project creation, MIDI/audio event editing, arbitrary project saving, or parameterized export API. This audit does not claim complete Cubase coverage.

## Verification

The fixture exercises all 20 strip control keys, an identity-guarded write, the omitted edit key, missing branches, Control Room host maxima, representative bindings, and the indexed-channel admission budget. `node --test tests/remote.test.cjs` passed 37/37. No installed driver or live project was changed by this slice.
