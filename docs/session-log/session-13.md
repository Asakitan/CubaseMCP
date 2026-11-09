# Session 13: Current handshake and host project-open research

Date: 2026-11-10.

## Request

Continue the complete Cubase MCP goal, including project creation, saving and editing, without foreground operations, an additional runtime backend or manual user steps. The goal remains active and incomplete.

## Evidence

Isolated PID 39068 had constructed controller 3.5 without an observed device or mapping activation; the prior 3.4 process had timed out at status. Session 12 passed the production build and 77/77 tests, but did not exercise the 3.5 handshake.

## Work

- Traced an installed `vstconnect.dll` caller to `IHostApplication2`, path-family objects and the host's project-open branches. Located a statically initialized `UPluginContext` image object with `IHostApplication2` and `IHostClasses` subobjects, and traced the matching path IID's registration record and `FNPath` factory callback. Added a read-only diagnostic for those fixed-build locations. A loaded-module snapshot and one unpinned zero-count component-constructor registry do not establish the component's actual context or a project operation. No host method was invoked.
- Traced a candidate second-instance forwarder containing a state-dependent `SetForegroundWindow` call, and did not launch a second instance. Traced a conditional save-preflight alert-service invocation before the file-open site, without invoking save or a dialog.
- Traced the posted-message consumer and distinguished its recorded remote-wheel receiver from the separate arranger controller. Compared the historical successful template verification with current startup and path-argument evidence, without assigning a cause.
- Added fixed-profile static inspectors and synchronized the current status, architecture, inventory and affected research documentation. No production runtime or controller code changed.

## Verification

- One no-write live verifier listed 23 tools and timed out with `MIDI_TIMEOUT` and outcome `unknown` before writes (`artifacts/live-smoke/verification-coverage-3.5-39068.json`). Five subsequent read-only samples observed the project root and registered informer with an empty project tree (`artifacts/ipc/midi-startup-timeline-39068-297db98ac5664dfa909277cac7222ea6.json`). These samples are not startup chronology.
- A bounded PID 39068 diagnostic double-read six initial context vtables, the host-classes subobject vtable and, separately, the matching path-IID registration record and factory pointer after process, private desktop and PE profile validation. It traversed the 20-bucket, 254-entry CID table and observed the target record once in calculated bucket 6, with one matching IID in that bucket (`artifacts/ipc/plugin-context-static-39068-369280693a8f403d810bd41e03dff202.json`). It made no interface query, factory or project call and does not establish actual lookup, thread, service or lifetime readiness.
- Each new static inspector completed against the fixed PE profile. The queue inspector independently checked eleven decoded direct callers; the host-open inspector checked both PE profiles, IID bytes, RTTI/vtables and the constructor registry reference. Outputs are under `artifacts/research/session-13/`. Production sources did not change, so the earlier build and 77/77 suite were not repeated.
- No Cubase project write, second process, host interface query, dialog input or foreground action was performed in this session.

## Remaining

Establish current MIDI Remote mapping activation and a successful handshake. Recover and verify host-owned context and thread contracts, path lifetime, prompt behavior and completion; then implement and verify actual project create/save/edit/reopen and rendering. Complete the remaining Cubase feature families against real host results rather than fixture declarations.
