# Session 15: Temporary Unicode path object and dispatch research

Date: 2026-11-10.

## Request

Continue the complete Cubase MCP goal, including project creation, saving and editing, without foreground operations, fallback or manual user steps. The goal remains active and incomplete.

## Evidence

The session 14 isolated path-class lookup returned a matching interface and its release call returned. Controller 3.5 had constructed, but the previous no-write MIDI status request timed out. Host-open dispatch and save completion were not established.

## Work

- Added a separately named fixed diagnostic image and entry which obtains a temporary `FNPath`, validates the fixed host, filesystem and object vtables, calls its setter once on a synthetic Unicode absolute path with mode `0`, directly compares bounded directory and filename fields, and releases the object. No project method, public path getter, UI action or project-file write is requested. The loader accepts only the two fixed images and three fixed entry choices; each image has a one-shot guard.
- Traced the conditional posted `OpenFile` application receiver and its ignored result. Identified a separate save-before-file-open alert decision based on original-path attributes. Neither trace establishes thread, prompt-free operation or completion.
- Extended the existing read-only MIDI scanner diagnostic with PE profile and receiver-vtable observations, and traced its receiver slots. The name-only path remains separate from the inquiry/detail investigation.

## Verification

- The PowerShell wrappers parsed, the fixed C# loader compiled and the three wrapper exit policies passed. The path diagnostic passed MSVC `/Zs` and built once with `/W4 /WX`. Its static inspector verified the fixed RTTI, vtable slots, singleton and root helper.
- In private PID 39068, worker thread 38096 reported lookup and setter returns 0, matching wide directory and filename fields and a returned release without exception (`artifacts/native-path-roundtrip/roundtrip-result-39068.json`). The synthetic CPR path was absent before and after; Cubase was responsive immediately afterward. This is a temporary-object field comparison, not a project operation.
- One bounded scanner read directly captured the expected receiver vtables and two MCP-named records with empty detail ranges (`artifacts/ipc/midi-scanner-receiver-39068-ffc4f125c0514c3a9fffeb2261f5c2c7.json`). The project dispatch, save decision and scanner inspectors passed their fixed-profile checks; outputs are under `artifacts/research/session-15/`.
- `npm run build` passed and the full `npm test` suite passed **77/77**. These checks do not establish current MIDI activation or any project lifecycle operation.

## Remaining

Establish MIDI Remote mapping activation and current handshake. Establish host-owned dispatch, noninteractive project open/create/save/edit/reopen, exact error and completion contracts and durable verification. Complete remaining Cubase feature families against actual host behavior.
