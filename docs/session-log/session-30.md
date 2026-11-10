# Session 30: binding root cause, song tools, audio export

Date: 2026-11-10.

## Request

Finish the remaining TODOs of the project and add whatever was missing for the purpose of the server: an agent must be able to make a song and call the functions that should be callable. Simple tasks could go to haiku subagents. Background only, no fallback, no input to windows, necessary checks only, scratch on E.

The two recorded TODOs were: resolve the selected-track and bank-channel volume binding writes whose values were never observed, and implement and verify track/event editing, routing/automation/plug-in handling, rendering and remaining coverage.

## Delivered

- **Root cause of the dead binding writes** found by controlled live experiments and fixed in controller `2026-11-10-coverage-3.14`: table walks inside host feedback callbacks made a page activation take seconds, and Cubase then abandons the activation, leaving the surface values of that page without host propagation. Callbacks are now O(1) (epoch stamps), the mixer bank lives on its own mapping page, activation counters are reported and a stalled page refuses writes with `SURFACE_INACTIVE`. Details: [binding root cause](../binding-root-cause-30.md).
- **Both old unconfirmed writes are confirmed** on the host: selected-track volume (main page) and bank-channel volume (mixer page), each by host feedback inside the settle window and by an independent DirectAccess read.
- **Receipts that say what the host confirmed.** `cubase_control_set` reports `confirmation.state`, `cubase_command_execute` reports `bindingObserved`. Commands are pressed and released in separate idle callbacks. A response frame that Cubase drops (seen when the transport stops) is read again by request ID (`bridge.response`); the operation is never sent twice.
- **MIDI notes in, MIDI notes out.** Native lifecycle operation 4 imports a Standard MIDI File into the managed project the way the host does after a file was chosen; `cubase_midi_import` builds that file from a song in beats. `cubase_midi_read` lets Cubase write its own MIDI file and parses it. `src/smf.ts` is a dependency-free parser and builder.
- **Tracks, mixer, transport.** `cubase_channels_list`, `cubase_channel_set`, `cubase_track_edit`, `cubase_transport_state`, `cubase_transport_set`, `cubase_transport_action`, plus `cubase_pages_list`, `cubase_page_activate`, `cubase_command_get`, `cubase_runtime_windows`.
- **Plug-in loading on the host.** `cubase_plugin_set` loaded an insert effect into the instrument channel and replaced it with another, no window opened, and the insert-viewer on, bypass and two parameter writes were confirmed by host feedback and written back (`scripts/verify-plugin30.cjs`).
- **Audio mixdown in the background.** `cubase_audio_export` makes Cubase open its export window on the private desktop with one key command and starts the export with a second one; Cubase closes the window itself. The tool keeps the default file name free, waits for the file and reports format, length and level.
- **Command allowlist verified one command at a time.** 181 commands; 103 with an effect read back from the host, 55 submitted without a visible change in the available read-backs, 23 not performable in the prepared context. Commands that opened a window were removed (seven Add Track variants, both Add Track To Selected commands, Insert Tempo Event at Cursor, Export Audio Mixdown Simple), as were twelve commands that are only performable inside a MIDI editor (quantize grid, Auto Quantize, Repeat Loop); Save New Version was removed because it renames the host document behind the managed-project record. Results: [command allowlist](../command-allowlist-30.md).
- **Binding controls swept one by one** (`scripts/verify-controls30.cjs`): 2550 declared controls: 645 writes confirmed by host feedback (165 on the main page, 480 on the mixer page), 26 submitted without feedback, 1426 unavailable in this project (empty bank slot, no plug-in in the slot, or missing host branch), 28 read-only, 425 host actions not triggered. Results: [control sweep](../control-sweep-30.md).
- Total MCP tools: **43**.

## Evidence

- Acceptance run through the real stdio MCP server, **28 of 28 checks**: `artifacts/ipc/song30-live-e2e1.json` (script `scripts/verify-song30.cjs`). Create project, tempo 104, signature change and restore, import of four tracks with 192 notes, exact read-back, one track transposed an octave and made legato with the others unchanged, rename/volume/pan/mute, duplicate/move/remove/add track, both binding writes, marker, playback, two audio exports (18.462 s, 44.1 kHz stereo float, peak -12.9 dBFS), Save (67,616 → 331,094 bytes), reopen in a fresh process and identical read-back.
- Binding experiments: `artifacts/ipc/binding-scale30-*.jsonl`, `binding-variant30-*.jsonl`, `binding-counters30-*.jsonl`.
- Command verification: `artifacts/ipc/command-verify30-*.jsonl` and `command-verify30-summary.json`; earlier dialog probes `command-probe30-*.jsonl`.
- Control sweep: `artifacts/ipc/control-sweep30-*.jsonl` and `control-sweep30-summary.json`. The mixer page was swept twice on two fresh projects with the same counts.
- Plug-in check: `artifacts/ipc/plugin-insert30-live-p2.json` (4 of 4). `plugin-insert30-live-p1.json` is the first run, which passed three checks and stopped at the replacement because the script had not listed the plug-in UID again after re-listing the objects.
- Managed test projects: `artifacts/managed-projects/session-30/`.

## Verification

`npm run build` and `npm run build:native` passed. The full suite was run at the end because the controller, the client and the server changed together: **191/191 passed**. New test files: `tests/smf.test.cjs`, `tests/song.test.cjs`, `tests/wav.test.cjs`, `tests/song-tools.test.cjs`, `tests/binding-scale-30.test.cjs`; `tests/remote.test.cjs` and `tests/midi.test.cjs` gained the session-30 cases. `tests/song.test.cjs` and `tests/wav.test.cjs` were written by haiku subagents from a written brief and reviewed.

## Corrections made on the way

- Page size, surface creation order and dotted variable names were each tested as the cause of the dead writes and ruled out before the callback-cost experiment found it.
- A first command confirmation counted nothing because press and release in one callback are coalesced by the host; they are now separate idle callbacks.
- The first generated import file produced an extra empty MIDI track: Cubase turns a conductor track without events into a track. The file now always carries the project tempo and signature.
- A solo and mute sequence left a track muted, and Cubase silently left it out of the written MIDI file; `cubase_midi_read` now names muted MIDI channels.
- Removing a track with content opens a confirmation prompt. `cubase_track_edit` deletes the track's events first and the raw command is refused outside that tool.
- A second export with the same file name opens an overwrite prompt and writes nothing. `cubase_audio_export` renames earlier and new export files.
- The command verification run left the events of one track muted after an unmute test and then compared against the wrong content; the script now checks the content before every command and replaces the project on drift. The affected commands were probed again.
- A plug-in reset tool was added and removed again. The host call `resetSlotPlugin` opens a confirmation prompt that blocks the MIDI Remote script: the bridge stopped answering and the instance had to be replaced. Clearing the slot with an empty type UID is refused by the host. A loaded plug-in can be replaced or switched off, not unloaded.
- Stopping a background verification run did not end its node process at once; it replaced the instance of the next run and was itself cut off between launch and receipt. The orphaned Cubase process was matched to its own launch receipt (process and holder creation times), the receipt was published, and the normal verified lifecycle took over. Live runs now check for leftover run processes first.
- Starting the owned instance from a process whose Windows job forbids breakaway fails with error 5 and stops the previous instance; live runs must be started from a job that allows it.
- One line of static analysis toward supplying the export file through the host's file dialog service was stopped by a safety classifier and not pursued. The export uses the host's own key commands instead.

## Remaining

Audio file import and audio editing; instrument, FX, group and folder track creation without the Add Track dialog; removing or selecting instruments and presets; in-place editing of a single note; tempo-track events; automation data; routing writes; export settings and stems; score, arranger, media and sync. The matrix is in [feature coverage](../feature-coverage-30.md). Results hold for Cubase AI 16.0.5.174, this installation's preferences and the contexts that were prepared.
