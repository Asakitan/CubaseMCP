# Session 10: Startup timeline and project routing

Date: 2026-11-10.

## Request

Continue the complete background-only Cubase MCP goal, including project creation, saving and editing, without alternate runtime execution or manual user steps. The goal remains active and incomplete.

## Work and Evidence

- Added `scripts/Trace-MidiStartup.ps1`, a version- and process-validated, bounded read-only sampler of project, root, listener and informer state. A prearmed launch mode compiles the reader before the new process and accepts only a matching launch ticket and isolated launch receipt. Polling and non-atomic snapshots are not event history.
- In a focused current-PID test of the earlier instance, PID 3720 had a root, the informer listener and an empty informer project tree; the current root key was absent. Evidence: `artifacts/ipc/midi-startup-timeline-3720-552e48f89323406d86396472e2bf2043.json`. The direct invalid-PID check produced an explicit error. This prior process does not certify any later process.
- Static and registry investigations recorded the local CPR shell command and generic dispatcher construction. Neither establishes the secondary-process forwarding route, a main-thread project dispatcher, or an unattended create/save contract. See `docs/project-open-routing.md` and `docs/project-lifecycle-dispatch.md`. The static inspector validates its fixed PE profile before disassembly.
- An approved restart backed up the owned project and receipt, but initially left the old transient startup marker. PID 40204 later had marker-decision/initialized bytes `1/1`, a Safe Start window and absent informer/root in the recorded samples. The first sampler ticket was delayed by the coordinator's inherited pipe, so the initial 34.85 seconds were not sampled. Evidence: `artifacts/ipc/startup-flags-40204-session10.json` and `artifacts/ipc/midi-startup-timeline-next-e6ffb0dbb46d41fa8f5b5a099f784b67.json`.
- With all Cubase processes stopped, the known transient `ApplicationStarted.txt` was copied into the new backup and then removed from the profile; `CrashNotification.txt` was absent. The corrected launcher started PID 53000, holder PID 69088, on the private desktop. Its before/after foreground handles matched; later private-window enumeration showed the owned project and score editor. The archived marker and project copy are under `artifacts/runtime/before-clean-startup-timeline-9eb33f175e2945eb8287dd8581724d42`.
- The new prearmed capture began 94 ms after process start. It observed the same root while the informer pointer was zero in 11 consecutive samples, followed 1.59 seconds after the first root observation by a registered informer. Its 566 readable informer samples, including the first, had an empty project tree. One earlier private-desktop enumeration sample failed, making overall status `error`; polling and that error limit any causal or event-history conclusion. Evidence: `artifacts/ipc/midi-startup-timeline-next-9eb33f175e2945eb8287dd8581724d42.json`.
- The current script console recorded controller 3.3 construction without activation. One no-write MCP verifier discovered 23 tools, then timed out on status with outcome `unknown` before writes (`artifacts/live-smoke/verification-coverage-3.3-53000.json`).
- Corrected the background launcher's inherited stdout/stderr pipe by redirecting the hidden holder to unique runtime log files. It still reports `starting`, not Cubase readiness. `tests/background-launch-pipe.ps1 -ExpectedProcessId 53000` passed with the existing-instance guard and left the current process and receipt unchanged; the test did not establish a new-Cubase success path.

## Verification and Remaining Work

PowerShell parser validation passed for the modified launcher, timeline and focused test, and the timestamp-checked static inspector ran against the installed PE. The session 08 70/70 Node suite and TypeScript build were not rerun because production TypeScript and controller code did not change. Project windows, file copies and static routes are not a handshake or a project create/save/edit result.

Establish a repeatable live mapping and real control handshake, then recover and implement actual project creation, saving and editing before completing the remaining requested feature families. Preserve the current-session guard and report uncertain write outcomes as uncertain.
