# Session 11: Guarded bank controls and activation sources

Date: 2026-11-10.

## Request

Continue the full Cubase MCP goal, including project creation, saving and editing, without foreground operations, alternate runtime paths or manual user steps. The goal is active and incomplete.

## Evidence

The prior isolated startup samples showed a root before the informer was observed, followed by an empty informer project tree. Those polling observations did not establish callback history or cause. The installed declarations expose bank-channel fields but do not establish live host availability.

## Work

- Added declaration-backed bank-channel selection, pre-filter, EQ, send/cue-send, quick-control, instrument and strip values under the existing channel identity and session guards. Selection submission invalidates selected-track feedback. Nested bank groups now report the slot identity and missing-channel state. All eight positions can expose each send folder up to 32 slots without a shared budget starving later positions. Revision 3.4 is required by both source controller and server.
- Verified seven direct static callers of the project root selector and identified an `ActivateProject` command-shaped branch. A different-root branch notifies listeners of old-root removal and new-root insertion, while the same-root branch returns before that dispatch. These observations do not establish an externally callable background API, event delivery, thread or ownership contract.
- Reviewed [Steinberg's MIDI Remote detection documentation](https://steinbergmedia.github.io/midiremote_api_doc/api-details/detection-unit/) and the installed declaration file. The automatic detection-name API is documented; that does not explain the earlier empty informer tree or prove a running mapping.

## Verification

- The six focused Node tests for bank identity, added bindings, missing branches, later-channel send slots, group identity and ES5 parsing passed.
- The two static inspectors ran on the installed PE after machine/timestamp/image-base validation; artifacts are under `artifacts/research/session-11`. The coordinator independently decoded the seven call sites from their `.pdata` function beginnings. Their observations are static only.
- `npm run build` passed and the required `npm test` suite passed 74/74. Revision 3.4 was installed after preserving the prior four driver files in `artifacts/runtime/before-coverage-3.4-78143741a82a4c268770d1a5b7a8fb0a`.
- The owned project and launch receipt were backed up, the known transient startup marker was archived with Cubase stopped, and the isolated host was restarted through the detached launcher. PID 46868 and holder PID 4428 used the private desktop; launch foreground handles matched. A private window title identified the owned project, and the script console recorded `controller constructed 2026-11-10-coverage-3.4`. Evidence: `artifacts/runtime/coverage-3.4-restart.json`, `artifacts/ipc/project-window-46868.json` and `artifacts/ipc/midi-script-coverage-3.4-46868.json`.
- One no-write MCP verifier listed 23 tools but timed out on status with outcome `unknown` before any write (`artifacts/live-smoke/verification-coverage-3.4-46868.json`). No device/mapping activation message was observed before that verifier. Construction and a project window do not establish a working handshake or successful project operation.
- A process-identity-checked module snapshot observed `dawproject.dll` and `hostchannelaccess.dll` in PID 46868, but did not observe `projectplugin.dll` (`artifacts/ipc/project-modules-46868.json`). No project service request was made, and the reason for the missing module remains unproven.

## Remaining

Establish actual background MIDI mapping activation and a current handshake, recover and implement real project creation/save/edit/reopen and rendering contracts, and complete the remaining feature families. Do not infer completion from declared APIs, project-window presence, copied files, or fixture tests.
