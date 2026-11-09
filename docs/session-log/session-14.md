# Session 14: Isolated path-service lookup

Date: 2026-11-10.

## Request

Continue the complete Cubase MCP goal, including project creation, saving and editing, without foreground operations, fallback or manual user steps. The goal remains active and incomplete.

## Evidence

The current isolated PID 39068 had constructed controller 3.5; its no-write MIDI status request timed out in session 13. A bounded read-only snapshot found a matching path factory registration in its expected class-registry bucket, but no lookup had been executed.

## Work

- Added a second fixed, mutually exclusive entry to the existing approved diagnostic DLL. It validates the Cubase build, observed host-class vtable, fixed path IID, registration record and factory pointer; calls that lookup once on its worker thread; checks the returned `FNPath` vtable; and calls the fixed release slot only on a match. It never calls a path setter or project operation. The explicit loader accepts only the two fixed entries and prevents replay.
- Traced the separate `0x3933f10` caller to drag-data filename enumeration, and traced the host-open submission branches far enough to distinguish an immediate return from enqueue or completion. Traced the save-preflight predicate to a byte also used in startup-marker handling. Traced MIDI scanner inquiry registration and rebuild receiver provenance without asserting a cause for the current activation failure.
- Preserved the previous built diagnostic module before building the new one; no production MIDI controller or MCP server code changed.

## Verification

- PowerShell wrapper parsing and C# loader compilation passed. The native source passed `/Zs` and the DLL built once with the existing `/W4 /WX` configuration.
- The fixed entry ran once in private PID 39068. Loader `path-loader-39068.json` reports entry return 0; `path-result-39068.json` records worker thread 39876, lookup return 0, a non-null expected-vtable object and a returned release call without exception. Cubase was responsive immediately afterward. No path setter, project open/save/edit, foreground action or dialog input was performed. Earlier artifacts were backed up at `artifacts/runtime/before-path-service-probe-5512a180349d4b27b4655fa91d72fbba`.
- The open, save-preflight and MIDI scanner inspectors were independently run against the fixed PE profile; their outputs are under `artifacts/research/session-14/`.
- The focused fixed-entry wrapper-policy check passed. `npm run build` and the full `npm test` suite passed **77/77**; these tests do not establish live project functionality or current MIDI mapping activation.

## Remaining

Establish current MIDI Remote mapping activation and handshake, path setter and lifetime semantics, host-owned project dispatch and completion, and prompt/error behavior. Implement and verify actual project create/save/edit/reopen and rendering, then cover remaining Cubase feature families against real host results.
