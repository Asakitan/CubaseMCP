# MIDI Remote coverage audit

This audit compares the bridge to the installed Cubase 16.0.5 declaration file `midiremote_factory_scripts/.api/v1/midiremote_api_v1.d.ts`. A declaration establishes API shape, not availability in Cubase AI or proof of live behavior. Fixture results do not establish host support.

## Implemented declaration-backed paths

| Area | Bridge surface | Boundary |
| --- | --- | --- |
| Host access and DirectAccess | Four observed roots, object and parameter discovery, guarded parameter writes and edit-lock changes, plugin collection and slot assignment | Objects and tags must be observed in the active session; host methods and edition features can be unavailable. |
| Transport | Value bindings, tempo and primary/secondary locator callbacks and setters | Host submission is not playback or persistence evidence. |
| Selected track | Identity, previous/next actions, channel values, pre-filter, EQ, sends, cue sends, instrument parameter bank and quick controls | Track feedback is invalidated on identity change; new instrument-bank writes require observed track and plug-in identity. Meter values are read-only. |
| Selected channel strip | On, bypass, automation, callback identity, eight parameter-bank values and previous/next/reset actions for the five declared strip slots | Missing branches report unavailable; identity callbacks are session/track scoped and edit-window controls are omitted. |
| Control Room | Root/main/indexed values, source selectors and momentary next-downmix control | Host maxima are limits, not configured channel counts. Indexed channels share a 16-channel budget and selectors share a 64-value budget; oversized groups fail without partial admission. |
| Mixer bank | Eight fixed bank positions with core/selection, pre-filter, EQ, sends, cue sends, quick controls, instrument and strip values and parameter banks, plus read-only aggregate meters; fixed previous/next/shift/reset actions | Writes require a previously observed and currently matching channel identity; new plug-in banks also require the exact observed identity. Action submission does not prove a bank position. See `docs/midi-mixer-bank.md`. |
| Insert viewers | Selected-channel and bank-channel all, empty, occupied and bounded index filters; read-only values, identity callbacks and channel-guarded viewer/bank actions | Index filtering and callback attribution remain unverified on a live host; plug-in parameter writes are intentionally withheld. See `docs/midi-insert-viewer.md`. |
| Focused quick controls | Eight bindings and focus lock | Actual availability comes from the host. |
| Commands | Fixed command bindings only | A performable binding and submission do not prove the desired project state or disk persistence. |

## Declared but not implemented

- `MR_MixerBankZone` filtering configuration and bank-channel insert-viewer plug-in parameter writes are not bound; mixer DirectAccess discovery remains separate.
- Insert viewer on/bypass/automation and parameter writes are not exposed; `mEdit` and focus-following are deliberately omitted. DirectAccess support does not imply every viewer is reachable in a particular edition or project.
- `MR_MixerChannelValues.getVUChannelMeterByChannelIndex` and `getVUMeterMaxByChannelIndex` are not bound; aggregate meters are exposed read-only. The inspected declarations provide no corresponding selected-channel meter count, so arbitrary indices are not admitted.
- Mouse-cursor bindings and editor/plugin open controls are intentionally omitted from the background-only surface.

The declarations do not establish a general project creation, MIDI/audio event editing, arbitrary project saving, or parameterized export API. This audit does not claim complete Cubase coverage.

## Verification

Revision 3.5 adds bank insert viewer and navigation fixtures, including later-channel indexed slots, identity invalidation and missing branches. Revision 3.4 added bank-channel checks for filters, EQ, sends, quick controls, selection and instrument/strip values. See `docs/midi-mixer-bank.md` and `docs/midi-insert-viewer.md` for bounds. These fixtures do not establish host availability or live operation.

Revision 3.6 adds optional selected-channel runtime-ID guards and clears selected insert/strip feedback on valid plug-in-identity callbacks. Its fixture and deployment boundaries are in `docs/midi-coverage-3.6.md`; it does not add a project lifecycle API.

Revision 3.7 adds selected-instrument and bank-channel instrument/strip parameter pages and guarded navigation. Five focused tests and the 89-test suite passed; installation was verified, but current mapping activation and the new controls are not yet verified in the live host (`docs/midi-plugin-banks-3.7.md`).

Revision 3.8 adds a guarded DirectAccess edit-lock setter; the 91-test suite passed and installation was verified. In session 24 its mapping activated and a Stereo Out DirectAccess volume parameter was written and restored; its edit lock was separately changed and restored with readback. A separate selected-track volume control write was not observed at its target; see `docs/first-project-open-24.md` and `docs/midi-parameter-lock-3.8.md`.
