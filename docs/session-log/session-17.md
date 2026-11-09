# Session 17: Selected-channel identity and verifier uncertainty

Date: 2026-11-10.

## Request

Continue the complete Cubase MCP goal, including unattended project creation, saving and editing, without foreground operations, automatic fallback or user steps. The goal remains active and incomplete.

## Evidence

The previous isolated Cubase process had constructed controller 3.5 but a no-write status request timed out. A read-only path/root candidate did not prove project lifecycle completion. Research into normal background MIDI activation and DAWproject/CPR lifecycle did not establish a usable new route.

## Work

- Reproduced and fixed stale selected insert and strip group feedback after plug-in identity callbacks, stale selected-track feedback after a runtime-ID change with the same unique ID, and retained feedback after a temporary identity-read failure.
- Added optional runtime-ID checks to track controls and navigation, alongside the existing unique-ID checks. These are pre-submission checks, not atomic host transactions or plug-in identifiers.
- Changed the live volume verifier to restore only after observing the requested target, pass both track IDs, and create unique non-overwriting reports. Uncertain initial writes, missing target feedback and uncertain restores do not trigger another mutation.
- Backed up all four installed 3.5 driver files, then installed 3.6 without starting or restarting Cubase. A subsequent bounded read-only console snapshot still observed 3.5 construction in PID 39068; no 3.6 activation or live operation is claimed.

## Verification

- Four focused tests reproduced the old stale feedback and passed after the fix. Two verifier tests cover initial write uncertainty, absent target feedback, one confirmed restore and uncertain restore. MCP integration verifies runtime-guard forwarding and invalid input rejection.
- Syntax checks and TypeScript `--noEmit` passed; `npm run build` passed; `npm test` passed **84/84** without skips. The final controller was installed after the additional identity-unavailability fix. The installed files were read back by the installer; the earlier 3.5 files, intermediate 3.6 controller and receipts are under `artifacts/runtime/before-coverage-3.6-b4de74cbbf5e47f8ae3b598b97c2c11c`.
- The read-only current script-console observation is `artifacts/ipc/midi-script-after-deploy-3.6-39068.json`. The earlier timed-out status request was not replayed; fixture results do not prove current host activation or project operations.

## Remaining

Establish normal background mapping activation and a current 3.6 handshake. Establish and implement real noninteractive project open/create/save/edit/reopen and rendering with observable completion. Complete remaining Cubase feature families against live host behavior.
