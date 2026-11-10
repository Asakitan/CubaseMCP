# Cubase AI 16 MCP

Version: 0.1.0. The built server exposes **53 tools**. Session 34 fixed the Group/FX creation/persistence path and verified MIDI, instrument, folder, unload, automation points and audio output/send routing through real MCP and fresh reopen. License-startup recovery is built into MCP. **Full Cubase coverage remains incomplete.** Controller: `2026-11-10-coverage-3.14`.

## Current increment: session 34

- Group/FX recreation now uses the host `VST Multitrack` factory token with the actual device binding sequence. The previously failed save/reopen check passed; the final run produced no new crash dump.
- `cubase_track_create` supports empty MIDI, instrument, Group, FX and folder tracks. A real instrument track with HALion Sonic and a folder both survived fresh reopen.
- Automation lane creation and point read/insert/value/move/delete are available. The final real MCP test preserved six edited points, volume/mute lanes, empty insert slot, output destination and send destination after PID 49344 -> 54364.
- `field: send` routing resolves the actual slot and tag 4099, guards its identity and checks independent MIDI feedback.
- Create/open now start their own independent holder. One observed license-stage stall can automatically end the owned empty Cubase and exact license helper and restart before native admission; submitted work is not replayed. Recovery ordering passed fixture tests; live starts were normal in this run.
- Native/TypeScript builds and **199/199 tests passed**. Final saved fixture: `artifacts/managed-projects/session-34/verified-native34-final/Contracts34.cpr` (473712 bytes). See [current contracts and evidence](docs/native-host-contracts-34.md).

## Historical increment: session 33

- A fresh owned background host opened the preserved project successfully. The earlier `Checking licenses...` sample did not establish a persistent licensing failure. The user's manually launched instance is separate and untouched.
- `cubase_track_create` observed empty MIDI, Group and FX tracks in the event tree and mixer. This was insufficient: both mixed-history and clean rebuilt projects reached an unconnectable-track prompt on fresh reopen. The saved session-33 projects are failed acceptance samples, not release fixtures.
- `cubase_plugin_unload` removed a newly loaded MonoDelay insert and confirmed an empty slot without opening a prompt (`plugin-unload33-a.jsonl`).
- `cubase_routes_list` and `cubase_routing_set` expose host-enumerated destinations. Group output changed from Stereo Out to an FX return and back; the MCP restore was independently confirmed through the MIDI parameter (`native33-route-restore.jsonl`).
- `cubase_automation_read` and `cubase_automation_edit` implement lane creation and point read/insert/value/move/delete with identity and old-state guards. Actual host readback confirmed each operation; clean reconstruction produced six points without playback recording.
- Two original dumps, at 17:20 and 18:40 on November 10, share `0xC0000005` at `Cubase+0x2e1bdb0` while accessing a destroyed `MTrackEvent`. The latest dump belongs to this task's failed native binding attempt. The exact faulty release is not yet fixed.
- Read-only connection inspection isolated null Group/FX device pointers after reopen. An explicit connection assembly-state sequence is built but not yet live-certified. Subsequent owned startup did not complete; license client logs nevertheless report the AI license consumed successfully.
- Native/TypeScript builds and **195/195 local tests passed**. User-launched processes, original dumps and activation data were preserved. Details: [session-33 contracts and crash evidence](docs/native-host-contracts-33.md).

## Historical increment: session 32

- The first native empty-MIDI creation inserted a named `MMidiTrackEvent` into the project tree, but did not produce a confirmed mixer channel. Three host error windows were subsequently observed. This is a failed acceptance, not completed track creation.
- Static follow-up found additional owner, mixer-registration and post-insert notification requirements. A source-tested owner correction alone does not establish the full contract. The provisional MCP tool and native operation 9 were removed; the released native range remains 1..8.
- The failed in-memory state was discarded. Reopening the unchanged test copy stopped at empty-instance readiness: PID 47292 displayed `Checking licenses...`; the native project-open operation was not submitted. No licensing setting or check was changed.
- A routing display-value probe returned the original output ID 22 / `Stereo Out`; no route change was confirmed. Plug-in unload, automation data and complete track/routing contracts remain open. See [session-32 contracts](docs/native-host-contracts-32.md).
- TypeScript/native builds passed. The full suite passed 194/194 with the temporary prototype; after withdrawal, four affected tool-exposure checks and both PowerShell syntax checks passed. The unchanged session-31 baseline contains 193 tests.
- The license-blocked empty instance was explicitly stopped (`native32-blocked-host-stop.jsonl`); no owned project is running. Original and copied CPR files are preserved.

## Verified increment: session 31

- Parameterized **NonUI audio export is working through real MCP**: WAV 48 kHz/24-bit, AIFF 44.1 kHz/16-bit, FLAC 96 kHz/24-bit and WAV 48 kHz/32-bit float all matched their requested headers, filenames and directories. Each is 4 seconds; the WAV files contain sound. No export-window command is sent, earlier files are preserved, and post-export window samples had no unexpected window. Evidence: `artifacts/ipc/native31-export-{wav-b,aiff,flac,float}.jsonl`; [contract](docs/native-file-services-31.md).
- Final TypeScript/native builds and the complete **193/193 test suite passed**. The current saved owned fixture is `artifacts/managed-projects/session-31/native-a/Native31-Verified.cpr`; consult runtime status for its live identity.
- Audio import added one audio channel and retained its AIFF source. Event discovery returned host-converted seconds; one audio event was moved from 8 to 12 seconds and trimmed from 4 to 2 seconds, with host readback confirmation. Rendering the edited range produced a non-silent 2-second WAV. Evidence: `artifacts/ipc/native31-audio-import-b.jsonl`, `native31-event-{move,trim,edit-render}.jsonl`.
- **Individual MIDI notes can be read and edited in place.** Native snapshots return pitch, velocity, channel, timing and a temporary event ID. Real MCP confirmed one note changed from 60/96 to 62/80, start 0 to 0.5 seconds and duration 2 to 1.25 seconds. A stale request was rejected before the setter. Native save-as and a fresh-process reopen retained these changes and both untouched notes.
- Nonzero-part testing exposed a unit mismatch in the temporary context. Current code synchronizes working/start/end bases and checks inverse conversion before time setters. New explicit corrections confirmed project time 4 seconds / local 960 ticks and duration 1.5 seconds / 1440 ticks. The failed receipt is retained. The final corrected fixture was saved but not reopened again.

## Verified baseline: session 30

- **A song can be made end to end in the background.** `scripts/verify-song30.cjs` drove the real stdio MCP server through project creation, tempo and time signature, import of four MIDI tracks (192 notes), exact read-back, event edits, track and mixer edits, transport, two audio mixdowns, Save, and a fresh-process reopen with identical read-back: **28 of 28 checks**, evidence `artifacts/ipc/song30-live-e2e1.json`. Contracts: [song tools](docs/song-tools-30.md).
- **The two old unconfirmed binding writes are resolved.** The cause was script time inside host feedback callbacks during page activation; Cubase abandons a slow activation and the page's surface values stop reaching the host. Controller 3.14 has O(1) callbacks, a separate mixer page, activation counters and a stalled-page guard. Selected-track volume and bank-channel volume writes are confirmed by host feedback and an independent read. See [binding root cause](docs/binding-root-cause-30.md).
- **New tools (13):** `cubase_midi_import`, `cubase_midi_read`, `cubase_audio_export`, `cubase_channels_list`, `cubase_channel_set`, `cubase_track_edit`, `cubase_transport_state`, `cubase_transport_set`, `cubase_transport_action`, `cubase_pages_list`, `cubase_page_activate`, `cubase_command_get`, `cubase_runtime_windows`.
- **Plug-in loading verified.** `cubase_plugin_set` loaded and replaced an insert effect without a window, and its insert-viewer on, bypass and parameter writes were confirmed by host feedback (`scripts/verify-plugin30.cjs`). Unloading a plug-in is not offered: the host call for it opens a prompt that blocks the bridge.
- **Receipts report confirmation.** `cubase_control_set` waits for host feedback (`confirmation.state`), `cubase_command_execute` for the host binding event (`bindingObserved`). A dropped response frame is recovered by request ID without resending the operation.
- **Command allowlist: 181 commands, each executed once on the host.** 103 verified by read-back, 55 submitted without a visible change in the available read-backs, 23 not performable in the prepared context. Eleven commands that opened a window were removed, twelve that are only performable inside a MIDI editor were removed, and Save New Version was removed because it renames the document behind the managed-project record. See [command allowlist](docs/command-allowlist-30.md).
- **Binding controls swept one by one.** 2550 declared controls: 645 writes confirmed by host feedback (165 on the main page, 480 on the mixer page), 26 submitted without feedback, 1426 unavailable in this project (empty bank slot, no plug-in in the slot, or missing host branch), 28 read-only, 425 host actions not triggered. See [control sweep](docs/control-sweep-30.md).
- **Historical export path:** session 30 used host export-window commands and installation defaults. Session 31 replaced this tool path with the explicit NonUI operation above.
- Session 30 ended its owned instance; session 31 has a separate owned fixture. Query `cubase_runtime_status` for its current lifetime. The session-30 verification projects, exported audio and ledgers remain under `artifacts/managed-projects/session-30/` and `artifacts/ipc/`.

## Coverage and remaining work

| Family | Current state |
| --- | --- |
| Owned background lifecycle | Create/open/save-as/status/stop (session 29) and MIDI import observed through real MCP; overwrite, merge, collect and other formats not certified |
| Track structure | Native empty MIDI/instrument/Group/FX/folder creation and fresh-reopen persistence verified; existing channel/track edits retained |
| MIDI events | Import, native note read and single-note pitch/velocity/position/duration edits verified; native note insertion/deletion/undo remains open; every import still adds a HALion Sonic instance |
| Timeline and transport | Tempo, time signature, locators, cycle, metronome, precount, markers, play/stop/step verified; tempo-track events and recording not offered or not exercised |
| Mixer bindings and DirectAccess | 645 binding writes confirmed in session 30; native audio-bus and send enumeration/write with independent feedback; output/send persistence verified |
| Audio export | Native NonUI main-output export with explicit path, WAV/AIFF/FLAC, sample rate and integer/float bit depth verified in session 31; stems remain open |
| Audio events and audio import | Explicit-path import, bounded event-tree read and audio-event move/trim observed through real MCP; recording, fades and stretching remain open |
| Plug-ins | Insert load/replace/unload observed; empty-slot and HALion Sonic instrument assignment persistence verified; presets/state and instrument-slot unload acceptance remain open |
| Automation data | Lane creation and point read/insert/change/move/delete plus semantic fresh reopen verified; certified undo and broader automation modes remain open |
| Score/chord/arranger/media/video/sync | Not implemented beyond adding a chord or video track |

The [session-30 matrix](docs/feature-coverage-30.md) is the historical baseline; [session-31 contracts](docs/native-file-services-31.md) describe the additions and their evidence.

## Necessary validation

Session 34 native/TypeScript builds and **199/199 tests passed**. The final real MCP fresh-reopen check covers the repaired device contract, instrument, folder, routes and automation. Startup recovery has focused fixture coverage; a real license stall was not induced. Earlier failed requests and dumps remain unchanged.

## Next priorities

Unrelated remaining work includes certified undo, native note insertion/deletion, tempo-track events, MIDI routing, plug-in presets/state and stems. The startup launcher now supplies its own independent process context. Preserve failed evidence and user-owned applications; do not restart the next backlog item without a request.
