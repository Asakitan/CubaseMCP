# Host Contracts and Crash Evidence: Session 33

Historical snapshot. The repaired device-token contract, real fresh-reopen
acceptance and automatic startup recovery are in [session 34](native-host-contracts-34.md).

Target: Cubase AI 16.0.5.174, PE timestamp `0x6adf121b`. The server exposes 53
tools; controller `2026-11-10-coverage-3.14` is unchanged. Full coverage and the
new track-creation persistence contract are not complete.

## Implemented Surface

| Tool | Observed result | Remaining gate |
| --- | --- | --- |
| `cubase_track_create` | Named empty MIDI, Group and FX tracks appeared in the event tree and mixer | Group/FX connections failed fresh reopen; the latest connection-state correction is built but not live-certified |
| `cubase_plugin_unload` | MonoDelay loaded and then removed; the slot returned to zero children without a prompt | Persistence in a fully valid newly created-track project |
| `cubase_routes_list`, `cubase_routing_set` | Real audio-bus choices, guarded route write and independent MIDI feedback; output changed to an FX return and back | Successful semantic fresh reopen; send destinations remain unsupported |
| `cubase_automation_read`, `cubase_automation_edit` | Lane creation, normalized point read, insert, value change, move and delete observed in the host | Successful semantic fresh reopen; certified undo remains unsupported |

Native operations 9, 10, 11 and 12 implement these additions. The request remains
version 3, 2096 bytes. Sidecars are track creation 528 bytes, unload 24 bytes,
routing version 2 / 552 bytes, and automation version 2 / 96 bytes.

Automation uses `MAutomationNode` -> `MAutomationTrackEvent` -> `MParamTrack`
with `MParamEvent` points. Point mutations validate root, track/lane/point IDs,
parameter tag, point count and exact observed values. Moving a point uses the
same parent-track time context as reading it; copying the point's time base
instead was rejected before mutation and was corrected. Point results omit
the host's unbounded tail-duration sentinel. Creating a lane additionally
checks the actual parameter owner and its automatable/unlocked metadata.

## Crash Dumps

The original dumps in the user's `Documents/Steinberg/CrashDumps` directory
were read with the installed CDB debugger and were not changed or deleted.

| Dump timestamp, local | PID | Exception | Fault RVA |
| --- | --- | --- | --- |
| 2026-11-10 17:20:04.153 | 51676 | `0xC0000005`, invalid read | `Cubase 16.exe+0x2e1bdb0` |
| 2026-11-10 18:40:12.901 | 41588 | `0xC0000005`, invalid read | `Cubase 16.exe+0x2e1bdb0` |

Both exception contexts have `RAX=0x14418ecf0`; the failing instruction is
`call qword ptr [rax+0x3f0]`, which reads an invalid target from the base
`FObject` table. The latest dump retains the object at `0xb15ab430`, its
destroyed-state reference count `-1000`, and secondary `MEvent` and
`MTrackEvent` tables. This is evidence of a destroyed track object still being
visited, not evidence of a licensing failure. The exact faulty release site
has not yet been established.

The latest dump identifies the loaded test module as
`artifacts/project-create-c1eac85f6c0124cf0837eb3810b26c90/CubaseProjectCreate.dll`.
That request separately returned `0xC00000FD` (stack overflow) during a direct
device-binding attempt; the later dump is the access violation above, not the
same exception code. CDB's initial `WRONG_SYMBOLS` automatic report lacked OS
PDBs and is not used as the fault attribution; the conclusions come from the
exception stream, raw stack, image RVAs and local RTTI.

Debugger outputs:

- `artifacts/ipc/crash33-1720-analysis.txt`
- `artifacts/ipc/crash33-1840-analysis.txt`
- `artifacts/ipc/crash33-1840-object.txt`

## Persistence Failure and Correction

Prepared projects `verified-a/Contracts33.cpr` and `verified-b/Contracts33.cpr`
under `artifacts/managed-projects/session-33` are failed acceptance samples,
not release fixtures. The second was rebuilt from the unchanged session-32
source to exclude earlier failed objects. Both fresh opens reached the host's
"remove unconnectable tracks" prompt; no input was sent to it.

Read-only inspection of the second blocked host found valid device pointers
on MIDI and pre-existing tracks but null device pointers on newly added Group
and FX tracks. The host's canonical path explicitly binds the channel through
the connection object and brackets assembly with states 2 and 1. That sequence
is now in `attachMixerDevice`, including a channel-pointer postcondition.
It has compiled, but startup failures prevented a live check of this final
revision. Do not treat it as a completed crash or persistence fix.

## Runtime and Verification

- Native and TypeScript builds passed; 195/195 local tests passed. The later
  capability-description and indentation update also passed TypeScript build.
- `contracts33-{a,b}-reopen.jsonl` preserve failed fresh opens. The subsequent
  `c` binding attempt failed; `d` through `g` did not reach native open because
  empty-host readiness was not established.
- The user permitted restarting `SteinbergLicenseEngine`. It was restarted
  without changing activation data or settings. Client logs subsequently
  reported the AI feature license consumed successfully; that did not prove
  application readiness or repair the track failure.
- The final valid owned receipt refers to PID 71448, whose holder later
  disappeared. A separately launched user process was not adopted or ended.
  Requery ownership before any further live operation.
- `CrashNotification.txt` and the original dumps were not archived, edited or
  removed during this investigation.

Next work is a valid owned startup, verification of the explicit connection
sequence, and diagnosis of the destroyed track's release site. Only then
rerun the focused fresh-reopen acceptance; do not replay unknown requests.