# Session 31: native editing and file-service integration

Date: 2026-11-10.

## Request

Complete the outstanding audio import/event editing, dialog-free track creation, individual MIDI edits, plug-in removal, parameterized export, automation, routing, tempo-track and arranger/score capabilities as usable MCP operations. Investigate the host file-dialog service rather than using keyboard commands. Preserve the background-only host and existing user work.

## Evidence

- The starting implementation is controller `2026-11-10-coverage-3.14` and 43 MCP tools. Session 30 records 191 passing tests and a 28-check real-MCP song workflow; those are historical results, not validation of this increment.
- The working tree already contains the session-30 implementation and documentation changes. They are retained.
- The installed fixed-build native target is Cubase AI 16.0.5.174. Existing native operations run on the owned process's event thread with process, desktop, job and document admission.
- The repository memory was still a session-05 snapshot and does not describe the current implementation.

## Work

- Implementation in progress. The main worker owns native changes, integration and live verification. Four bounded read-only research slices cover integration contracts, track/plug-in internals, event/timeline internals and declared routing APIs.
- Added fixed native operation 5 and parameterized `cubase_audio_export` source using `PAudioExportControllerNonUI`, with format metadata read-back and no export-window commands. Existing export contract tests now assert the native route and preservation of earlier files. Details: [native file services](../native-file-services-31.md).
- Added native operation 6 and `cubase_audio_import`, preserving the source file and using the post-selection pool/arranger path; a real AIFF import added an audible audio channel.
- Added operations 7/8 and `cubase_events_list`/`cubase_event_edit`. One audio event was moved and trimmed in place, independently read back and rendered.
- Extended native discovery into MIDI parts and added `cubase_midi_note_edit`: exact note ID, original pitch/velocity/channel/timing, parent-lock checks and one field per call. The server exposes 47 tools; controller 3.14 is unchanged.
- Nonzero-part acceptance found a real inverse-conversion defect after working-base-only correction. The host context also stores start/end bases. All three now inherit the parent base, and time setters require a successful native/seconds round trip. The wrong-position receipt remains unchanged; new correction requests used the observed post-state and different requested values, not a replay.

## Verification

- TypeScript/native builds and 3 focused export-contract tests passed.
- Four distinct real-MCP export cases passed: WAV48k24, AIFF44k16, FLAC96k24 and WAV48k32-float; each 4 seconds, with explicit path and no unexpected post-call window. Evidence and the first preflight-only failure are in [native file services](../native-file-services-31.md).
- Real audio import, event timing, audio position 8 to 12 seconds, duration 4 to 2 seconds and a non-silent 2-second post-edit render passed.
- One note's pitch, velocity, position and duration were each edited and read back. A stale original-value request was rejected before mutation. `Native31-Edited.cpr` was saved and opened in a fresh process: the note changes, two untouched notes and audio edits persisted.
- Corrected nonzero-part tests passed: project start 4 seconds maps to part-local 960 ticks; duration 1.5 seconds maps to 1440 ticks. Final `Native31-Verified.cpr` was saved at 287504 bytes; this final file was not reopened again.
- Final TypeScript/native builds, PowerShell parsing, strict C++ syntax and **193/193 full-suite tests passed**. Evidence paths and the preserved failed case are listed in [native file services](../native-file-services-31.md). No unchanged suite or export acceptance was repeated after this pass.

## Remaining

Track factories, plug-in unloading, native note insertion/deletion/undo, automation nodes, routing writes, tempo-track events, stems and arranger/score remain open. FX/group constructors and the detached MIDI-track factory do not yet establish complete attachment/edition/transaction contracts. The public plug-in reset has no discard-suppression parameter and its live prompt remains a blocker. These paths are not exposed as stubs. Host prompts are not answered, and keyboard/mouse input is not a backend.