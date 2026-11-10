# Session 33: Resume host contracts

Date: 2026-11-10.

## Request

Continue implementing the missing host contracts and resolve failures instead
of treating the prior startup wait as a permanent licensing blocker.

## Evidence

- The user demonstrated a normally started Cubase Hub. The prior license-check
  sample did not prove an enduring activation problem.
- `native33-base-open-a.jsonl`: owned background PID 3824 opened the preserved
  test project and returned an active MIDI handshake. Manual PID 53132 remained
  separate and untouched.
- Fixed-image inspection identifies mixer factory kind 3 as Synth, not MIDI.
  Kinds 2 and 6 are Group and FX; their name setters were verified in the image.

## Work

- Added empty MIDI, Group and FX creation and exposed `cubase_track_create`; subsequent reopen acceptance found incomplete Group/FX connections.
- Added `cubase_plugin_unload` using the native slot method and empty-slot readback.
- Added real routing choices and expected-state-guarded writes through `cubase_routes_list` and `cubase_routing_set`.
- Added operation 12 for bounded automation reads, lane creation and point insert/value/move/delete. The volume lane uses `MAutomationTrackEvent` and `MParamTrack` with `MParamEvent` values.
- Added two-stage real MCP save/reopen validation and read-only connection inspection.

## Verification

- Native and TypeScript builds passed for track, plug-in and routing changes.
- MIDI, Group and FX creation each returned confirmed tree and channel additions.
- `plugin-unload33-a.jsonl`: MonoDelay loaded into a fresh insert and unloaded; slot children returned to zero and no window appeared.
- `native33-route-restore.jsonl`: output route 33 returned to Stereo Out 22; independent MIDI feedback confirmed value 22 and display `Stereo Out`.
- `automation33-a.jsonl`: direct channel writes created the volume lane but no points. `automation33-b.jsonl` used value binding and produced five points. Native edits confirmed value 0.25 -> 0.4, a 0.1-second move, insertion and deletion. MCP lane creation and point insertion also passed.
- `contracts33-{a,b}-prepare.jsonl`: saved mixed-history and clean rebuilt samples with six automation points, an empty insert and non-default FX routing. Both fresh opens failed at the host's unconnectable-track prompt, which was not operated.
- Read-only inspection found new Group/FX device pointers null after reopen. Added the canonical explicit binding sequence with assembly states 2 -> 1 and a pointer postcondition. It compiled; final live validation remains blocked by startup readiness.
- The user identified the crash-dump directory. CDB read both original dumps: PID51676 at 17:20 and PID41588 at 18:40 both fault at `Cubase+0x2e1bdb0`, `0xC0000005`. A destroyed `MTrackEvent` remains in the traversal. The later dump loads this task's native module. Do not confuse it with the separately recorded `0xC00000FD` native binding exception.
- With permission, restarted the existing license helper without changing activation files. Logs show the AI license consumed successfully. The later user-launched Cubase was not adopted or ended. Original dumps and the crash-notification file remain unchanged.
- Native and TypeScript builds, editor diagnostics and **195/195 tests passed**. See [contract and crash analysis](../native-host-contracts-33.md).

## Remaining

Resolve native track lifetime, re-establish an owned ready host, then verify the
built connection correction and fresh-process persistence. Instrument/folder
creation, send destinations and certified native undo remain outside the
implemented surface. No commit or branch was created.