# Session 34: Native Lifetime and Automatic Startup Recovery

Date: 2026-11-10.

## Request

Finish the outstanding fixes end to end. If startup stalls at license checking,
stop Cubase and the license helper together and restart through MCP without
manual intervention.

## Work

- Added one bounded startup recovery before native project admission. The
  observed license-check window, owned process lifetime and exact helper path
  are checked; other Steinberg hosts are preserved.
- Moved independent holder creation into the fixed MCP empty launcher so an
  external acceptance launcher is no longer needed for Job breakaway.
- Startup recovery is included in the tool receipt and retained on disk.
- Replaced incomplete Group/FX path identity with a `VST Multitrack` factory
  token and the canonical connection construction sequence.
- Added real instrument and folder tracks, HALion Sonic assignment validation,
  and send-destination routing using actual slot parameter 4099.
- Extended the existing real MCP acceptance to point value/move/insert/delete,
  assigned instrument, folder, send target and fresh-process persistence.

## Verification

- Native and TypeScript builds passed; **199/199 tests passed** and edited
  implementation files have no editor diagnostics.
- The actual PowerShell recovery function passed fixture tests for Cubase-then-
  helper stop order and rejection of ordinary prompts or native admission.
  No real license stall was induced during this run.
- The fixed Node-supervised MCP launcher started the host directly from the
  ordinary stdio client. Earlier direct WMI-to-PowerShell attempts exited
  before script entry; no project request was submitted in those attempts.
- The `native34-c` reopen exposed the remaining factory/path mismatch. With
  the complete factory token, `native34-d` passed the same check.
- `contracts33-native34-final-extended-reopen-result.json` passed in fresh
  PID 54364, from PID 49344: Group/FX and MIDI, real instrument with HALion
  Sonic, folder, output/send destinations, empty insert and six edited points.
- No newer crash dump appeared than the retained 18:40 session-33 dump.

## Remaining

The requested supported creation/unload/automation/audio-routing paths and
startup automation are implemented. Unrelated coverage, certified native undo,
MIDI routing and plug-in presets/state remain outside this increment. Recovery
was fixture-verified; live startups were normal. No user process, configuration,
activation file or original dump was changed. No commit or branch was created.

See [current contracts](../native-host-contracts-34.md) for the exact supported
surface, failed attempts and final evidence.