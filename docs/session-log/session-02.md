# Session 02: Live MIDI Setup

Date: 2026-11-10 (local clock).

## Request

Complete the real Cubase connection and install missing prerequisites. Keep background-only operation and no fallback.

## Evidence

- Existing implementation passed 35 tests; the live diagnostic was blocked by missing MIDI ports.
- The local shell is elevated. Cubase and loopMIDI were not running at session start.
- WinGet identifies TobiasErichsen.loopMIDI 1.0.16.27, whose package URL is on the author's official website.
- The author's documentation states that loopMIDI ports exist only while the port-hosting application runs.

## Work

- Installed loopMIDI1.0.16.27 and verified the signed local executable. The installed virtualMIDI driver reports1.3.0.43.
- Consulted the official SDK locally; authored a small loopback host against the installed System32 library. No SDK binary was copied into the project delivery.
- Created both exact-name ports in a no-window process and verified real SysEx transfer on each.
- Started a copied AI template in the isolated `winsta0/CubaseAI_MCP` desktop; retained desktop/process handles for its lifetime.
- The user explicitly approved one-time isolated initialization. Safe-start and project-directory prompts were handled without switching the input desktop; the temporary initialization helpers are ignored artifacts, not MCP tools.
- Removed an ineffective default-location preference experiment and restored its original value0. The startup script no longer parses or changes preference XML.
- Fixed actual-host issues: callback properties may be write-only; DirectAccess snapshot refresh must not run before every read; removal notifications must not wipe unrelated objects or independent host-value feedback; native numeric values are not uniformly normalized.
- Added explicit setup/start/stop/live-verification commands and recorded all live results.

## Verification

- Final build passed. Final unit suite:40 passed,0 failed,0 skipped (real stdio1, native-client15, codec2, controller22).
- Both physical virtual-port SysEx loopback checks passed.
- `npm run verify:live -- --write`: four checks passed against Cubase AI16.0.5. Discovered the real mixer and Piano channel (50 parameters,8 sampled); read live feedback; observed volume change0.7890625 ->0.25 and restoration to0.7890625.
- Evidence: `artifacts/live-smoke/verification.json` (2026-11-09T14:25:19.263Z, November10 locally), `launch.json`, and `artifacts/runtime/midi-ports.json`.
- The current port host and Cubase test instance remain running. No user desktop switch, logon autostart registration or runtime UI fallback was introduced.

## Remaining

No blocker remains for the verified core connection. Plugin replacement, every command/type and audio playback are not individually live-certified. Full DAW feature coverage remains outside the public-API implementation.