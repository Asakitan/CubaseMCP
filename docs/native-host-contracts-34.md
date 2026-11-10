# Host Contracts: Session 34

Target: Cubase AI 16.0.5.174, PE timestamp `0x6adf121b`. The built MCP exposes
53 tools with controller `2026-11-10-coverage-3.14`. Native and TypeScript
builds, 199 tests, and the final real-host fresh-reopen acceptance passed.

## Track Construction and Persistence

The Group/FX defect was an incomplete device contract: a full mixer-object
path was used where persistent recreation requires a factory token. Merely
changing the connection type from 0 to 1 avoided the prompt but restored no
mix-console channel. The failed `native34-c` reopen caught that distinction.

Current construction follows the fixed host paths:

| Kind | Construction |
| --- | --- |
| MIDI | Factory `0x225f780`, root/name binding, native insertion `0x2776ba0` |
| Group / FX | Wrapper `0x2c4a540` supplies host notification suppression; factory token `0x2991610` names `VST Multitrack` with type 4 / 5; a device track binds the actual channel while connection type is 2, then returns to type 1 after insertion |
| Instrument | Factory `0x1ae6140` constructs a real `MInstrumentTrackEvent`, including its instrument factory token and MIDI branch; not a rack-channel substitute |
| Folder | Constructor `0x27c04b0` creates `MFolderTrack` with the current root, time base and insertion transaction; it has no mixer channel |

The earlier direct binding attempt recursively entered host connection work
and left a destroyed track being visited. Current code uses the complete
factory-token/binding sequence, not an extra reference-count increment or a
memory-leak workaround. The same construction/save/reopen workflow now passes
and no new crash dump was observed. This is evidence for the repaired path,
not a claim about unrelated Cubase crashes.

`cubase_track_create` accepts `midi`, `instrument`, `group`, `fx` and `folder`.
Instrument/folder confirmation additionally checks the exact native track
class. An instrument starts with an empty slot; `cubase_plugins_list` and
`cubase_plugin_set` assign a host-offered instrument. HALion Sonic assignment
was observed and retained through a fresh reopen.

## Automation, Unload and Routing

`cubase_automation_edit` supports `createLane`, `insert`, `setValue`, `move`
and `delete`; `cubase_automation_read` supplies lifetime-bound identities and
observed values. The final MCP acceptance changed a point value, moved it by
0.125 seconds, inserted and deleted a temporary point, then reopened with six
matching positions and normalized values and both volume/mute lanes.

Insert load/unload was verified in `plugin-unload33-native34-c.jsonl`. The
final saved project also retained an empty Group insert slot. Instrument
assignment is separately verified; instrument-slot unload was not exercised.

`cubase_routes_list` / `cubase_routing_set` accept audio `input`, `output`
and `send`. A send requires zero-based `sendIndex`; a write additionally needs
`expectedSlotUniqueId` from the list result. The actual send destination is
tag 4099, a host `VSTBusValue`, not the send level or its editor parameter.
Destination IDs/names come from the host menu and writes retain expected-old
value checks plus independent MIDI feedback. Output and send destinations
were retained on reopen. Numeric bus IDs are not durable across projects.

## Automatic Startup Recovery

`cubase_project_create` and `cubase_project_open` contain the complete launch
path. A fixed Node supervisor is created with `Win32_Process.Create`; it
starts the fixed PowerShell holder with normal standard handles. The holder
creates the private-desktop Cubase and verifies its restricted Job. No external
test launcher or foreground input is needed. Direct WMI-to-PowerShell exited
before script entry on this machine; that failed path is not a runtime fallback.

Before any native project request is admitted, the coordinator waits for empty
host readiness. If the sole blocking application window is the observed
English/Chinese license-check window, it performs one recovery:

1. Validate the current owned launch, lifetime, empty mode and absent native request.
2. End the owned Cubase through its holder and wait for both to exit.
3. End the exact same-session `SteinbergLicenseEngine.exe` if it remains alive.
4. Launch a fresh owned host, which starts its license helper normally, and recheck readiness.

The recovery is recorded in `startup-recovery.json` and the MCP result's
`startupRecovery`. On success it includes the new PID/creation and
`ready_after_restart`. An unknown or submitted native operation is never
replayed. A second startup failure or an unrelated prompt remains an error.
User-owned Cubase and other Steinberg applications are not terminated to restart
a shared helper. No activation files, user preferences or original dumps change.

The recovery function's stop order, state checks and rejection paths passed
isolated fixture tests. Normal live starts through the new built-in launcher
passed repeatedly during acceptance. This run did not induce a real license
stall, so it does not claim a live fault-injected license-recovery measurement.

## Final Evidence

- `artifacts/ipc/contracts33-native34-d-reopen-result.json`: Group/FX device
  recreation, routing and six automation points passed the original failed check.
- `artifacts/ipc/native34-instrument-create.jsonl` and
  `native34-folder-create.jsonl`: native track and mixer postconditions.
- `artifacts/ipc/native34-instrument-set.jsonl`: HALion Sonic assignment.
- `artifacts/ipc/native34-send-set.jsonl`: actual send destination and independent feedback.
- `artifacts/ipc/contracts33-native34-final-extended-reopen-result.json`:
  PID 49344 -> 54364; instrument, folder, Group/FX, output/send routing, empty
  insert and six edited automation points all match the saved semantic snapshot.
- Final project:
  `artifacts/managed-projects/session-34/verified-native34-final/Contracts34.cpr`,
  473712 bytes. Original source and failed samples remain intact.

Certified undo, tempo-track data, instrument presets/state, MIDI routing and
the other unrelated coverage families remain outside this increment. Full
Cubase coverage stays false; the requested creation/unload/automation/audio
routing paths above have their exact supported scope and evidence.