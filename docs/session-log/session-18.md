# Session 18: Restricted desktop job and current 3.6 launch

Date: 2026-11-10.

## Request

Continue the complete Cubase MCP goal, including real background project creation, saving and editing, with no foreground operation, fallback or manual user steps. The goal remains active and incomplete.

## Evidence

The previous isolated PID 39068 had constructed controller 3.5 and its status request timed out. Installed controller files were 3.6, but that process had not reloaded them. The public MIDI Remote declarations and earlier project traces had not established a completed unattended project lifecycle.

## Work

- Changed the diagnostic launcher to create its target suspended, assign it to a verified job with desktop creation/switch restrictions and kill-on-last-handle-close, and sample the input desktop before resume. A synthetic child confirmed membership, flag `0x40` and denied `CreateDesktopW`; no desktop switch was requested.
- Backed up the owned test directory, prior launch receipt and the matched transient startup marker. Following the user's previous approval, stopped only PID 39068 and its holder, then launched PID 50568 on the private desktop under the restriction. Its launch receipt sampled `Default` as the input desktop before, before resume and after resume. A project window and both MIDI port clients were observed; the script console recorded 3.6 construction.
- One new no-write 3.6 MCP status request timed out with execution `unknown`; no write or replay occurred. The informer timeline contained 345 observed samples with an empty project tree and absent root key, but began 37.59 seconds after process start because the earlier holder path held the coordinator's captured pipe.
- Replaced the holder-spawn path with a hidden process created without inherited handles. The synthetic long-lived holder test verified captured pipes closed while the holder was alive; the existing-instance guard test left PID 50568 and its receipt unchanged. The updated detached-holder path has not yet been exercised on a fresh Cubase launch.
- Verified the installed fixed `File`/`Save` command example and recorded the still-missing noninteractive completion/persistence contract. No save or other project operation was invoked.

## Verification

- `tests/desktop-job-boundary.ps1` passed with synthetic job membership, `CreateDesktopW` error 5 and sampled `Default` input desktop. `tests/detached-holder-pipe.ps1` and `tests/background-launch-pipe.ps1 -ExpectedProcessId 50568` passed. PowerShell parsing and C# compilation passed as part of these checks.
- `npm run build` passed and `npm test` passed **84/84** without skips. Fixture and point-in-time observations do not establish a live 3.6 handshake or completed project operation.
- Runtime evidence: `artifacts/runtime/cubase-launch.json`, `artifacts/ipc/midi-script-coverage-3.6-job-50568.json`, `artifacts/ipc/midi-clients-coverage-3.6-job-50568.json`, `artifacts/ipc/midi-startup-timeline-next-6b6c86ce8c924654951a918900dbfadc.json`, and `artifacts/live-smoke/verification-coverage-9ad5a1d9-85c1-4b80-8dcd-f960e1e9689a.json`.

## Remaining

Establish background MIDI mapping activation and a successful current handshake. Recover and implement a noninteractive, correlated project open/create/save/edit/reopen and rendering route, then complete and verify the remaining Cubase features.
