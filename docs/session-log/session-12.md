# Session 12: Bank insert viewers and project alert provenance

Date: 2026-11-10.

## Request

Continue the full Cubase MCP goal, including project creation, saving and editing, without foreground operations, alternate runtime paths or manual user steps. The goal remains active and incomplete.

## Evidence

The isolated PID 46868 had constructed revision 3.4, while a no-write MCP status request had timed out. Earlier startup timing observed a root before the informer and an empty sampled informer tree; it did not establish event history or cause.

## Work

- Added read-only insert-effect viewers for each bank channel, with indexed viewers up to the host's bounded 16-slot maximum and channel/session-guarded navigation. Plugin identity and feedback are invalidated on relevant changes and navigation; slot/plugin-specific writes remain unimplemented.
- Traced the project save error helper to a provider whose default factory looks up `Alert::IDialog`. A bounded current-process snapshot observed null provider and cache globals and a non-null manager; no service or save call was made. Future error behavior and the working save destination remain unverified.
- Traced a separate root-removal notification producer, an arranger receiver vtable and a remote-wheel producer using the same `ActivateProject` literal. Their external entry, mutual relationship, thread and completion remain unverified.

## Verification

- Four focused tests passed for insert viewer values, guards, invalidation, missing branches, the final bank position at 16 slots, and ES5 parsing. The project-save alert and activation inspectors ran against the validated installed PE.
- `npm run build` passed and the required `npm test` suite passed 77/77. After adding assertions for a missing channel confirmation and foreign-device/mapping identity callbacks, the affected viewer test passed again. Revision 3.5 was installed after preserving the previous four driver files in `artifacts/runtime/before-coverage-3.5-2c508e1ae87b440f9dfed4c1fc011b1f`.
- After backing up the owned project and receipt, the private host was restarted to load 3.5. PID 39068 and holder PID 43344 used the private desktop; launch foreground handles matched. A private window title identified the test project, and the script console recorded controller 3.5 construction without an activation message. Evidence: `artifacts/runtime/coverage-3.5-restart.json`, `artifacts/ipc/project-window-39068.json` and `artifacts/ipc/midi-script-coverage-3.5-39068.json`. At the end of session 12 a live 3.5 handshake and control operation had not been tested; the subsequent no-write status timeout is recorded in session 13.

## Remaining

Establish actual MIDI Remote mapping activation and current handshake, recover and implement real project creation/save/edit/reopen and rendering contracts, and complete the remaining Cubase feature families. Static paths, a project window and fixture tests do not prove an operation completed.
