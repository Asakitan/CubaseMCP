# MIDI Remote coverage audit

This audit compares the bridge to the installed Cubase 16.0.5 declaration file `midiremote_factory_scripts/.api/v1/midiremote_api_v1.d.ts`. A declaration establishes API shape, not availability in Cubase AI or proof of live behavior. Fixture results do not establish host support.

## Implemented declaration-backed paths

| Area | Bridge surface | Boundary |
| --- | --- | --- |
| Host access and DirectAccess | Four observed roots, object and parameter discovery, guarded parameter writes, plugin collection and slot assignment | Objects and tags must be observed in the active session; host methods and edition features can be unavailable. |
| Transport | Value bindings, tempo and primary/secondary locator callbacks and setters | Host submission is not playback or persistence evidence. |
| Selected track | Identity, previous/next actions, channel values, pre-filter, EQ, sends, cue sends, instrument and quick controls | Track feedback is invalidated on identity change; optional expected identity guards writes. Meter values are read-only. |
| Selected channel strip | On, bypass, automation, callback identity, eight parameter-bank values and previous/next/reset actions for the five declared strip slots | Missing branches report unavailable; identity callbacks are session/track scoped and edit-window controls are omitted. |
| Control Room | Root/main/indexed values, source selectors and momentary next-downmix control | Host maxima are limits, not configured channel counts. Indexed channels share a 16-channel budget and selectors share a 64-value budget; oversized groups fail without partial admission. |
| Mixer bank | Eight fixed bank positions with core channel controls and read-only aggregate meters; fixed previous/next/shift/reset actions | Writes require a previously observed and currently matching channel identity. Action submission does not prove a bank position. See `docs/midi-mixer-bank.md`. |
| Insert viewers | Fixed all, empty, occupied and host-count-bounded index filters; read-only values, identity callbacks and track-guarded viewer/bank actions | Index filtering and callback attribution remain unverified on a live host; plug-in parameter writes are intentionally withheld. See `docs/midi-insert-viewer.md`. |
| Focused quick controls | Eight bindings and focus lock | Actual availability comes from the host. |
| Commands | Fixed command bindings only | A performable binding and submission do not prove the desired project state or disk persistence. |

## Declared but not implemented

- `MR_MixerBankZone` filtering configuration and bank-channel EQ, sends and plugin slots are not bound; mixer DirectAccess discovery remains separate.
- Insert viewer on/bypass/automation and parameter writes are not exposed; `mEdit` and focus-following are deliberately omitted. DirectAccess support does not imply every viewer is reachable in a particular edition or project.
- `MR_MixerChannelValues.getVUChannelMeterByChannelIndex` and `getVUMeterMaxByChannelIndex` are not bound; aggregate meters are exposed read-only. The inspected declarations provide no corresponding selected-channel meter count, so arbitrary indices are not admitted.
- Mouse-cursor bindings and editor/plugin open controls are intentionally omitted from the background-only surface.

The declarations do not establish a general project creation, MIDI/audio event editing, arbitrary project saving, or parameterized export API. This audit does not claim complete Cubase coverage.

## Verification

Revision 3 adds fixture checks for selectors, fixed bank actions and strip parameter pages and identity invalidation. See `docs/midi-coverage-3.md` for bounds and remaining gaps. No installed driver or live project was changed by this slice.
