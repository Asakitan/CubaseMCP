# Session 09: Host-port synchronization and DAWproject filter

Date: 2026-11-10.

## Request

Continue the complete background-only Cubase MCP goal, including project creation, saving and editing, without fallback execution or manual user steps. The goal remains active and incomplete.

## Evidence

- The current isolated Cubase PID 3720, private-desktop holder PID 6156 and virtualMIDI host PID 62944 remained alive at the current launch receipt. Earlier session 08 recorded revision 3.3 construction and an MCP status timeout before any write.
- Bounded, version- and vtable-checked reads found empty MIDI Remote host input and output collections in PID 3720, while earlier endpoint-client evidence separately identified that process on both Windows ports. No port objects or matching outcomes were observed in the empty collections.
- A second bounded read found the model adapter registered among four `MidiRemoteSystemInformer` observers; its associated tree count was zero. This is a point-in-time upstream observation, not proof of tree semantics, missed events or root cause.
- Static analysis found an Idle refresh path with a nonzero `informer+0x90` prerequisite. A subsequent bounded snapshot observed that count-shaped field as zero, plus two non-null global pointer values, without dereferencing the latter. This does not establish prior events or the reason for the gate state.
- The refresh source was identified as `PPortRegistry` with a bounded `CmArray`. A subsequent exact-vtable and stable-name snapshot found 19 registry entries, including each configured MCP port name in both MME socket classes, while two sampled informer tree counts remained zero. That is not proof of filter acceptance or detection execution.
- The scanner held two target-named records with empty detail ranges. Static code would skip such records at one listener branch, but the meaning of the detail bytes and event history are unresolved.
- Static analysis identified an `IProjectNotification` insertion into the distinct fourth informer tree and a conditional registration through the `MProject` IID. A bounded live listener-list read found the informer in the current `MProject` container, but does not prove notification delivery or explain the zero tree count.
- One `MProject` root-selection path stores its input at `+0xf8`, iterates that listener list and dispatches the input's `+0x98` subobject to listener slot `+0x18`. The ordering of that path relative to the current listener registration and any later removal remains unobserved.
- The linked-list registration method itself does not call the new listener, and the root-selection method returns before dispatch when its incoming root already equals the current root. These are static branch observations, not a demonstrated repair or startup chronology.
- The installed DAWproject filter was loaded in PID 3720. In a separate process, standard factory metadata reported class count zero and no business object was created. This does not determine host registration or edition behavior.

## Work

- Traced MIDI Remote detection scheduler, host-port producer and informer registration paths and added bounded read-only HostEnvironment and informer diagnostics.
- Traced the DAWproject selection, package and host-project import stages; inspected the format's published schema and Cubase compatibility without claiming an unattended import path.
- Traced additional save branches, including conditional file deletion and stream creation. No project operation was invoked.

## Verification

- `scripts/Read-MidiHostEnvironment.ps1 -TargetProcessId 3720` observed empty collections and stable repeated headers; direct coordinator output is `artifacts/ipc/midi-host-environment-main-3720.json`. The result is a point-in-time snapshot, not evidence of detection history or cause.
- `scripts/Read-MidiPortInformer.ps1 -TargetProcessId 3720` observed the adapter registration and zero count with stable headers; direct output is `artifacts/ipc/midi-port-informer-main-3720.json`. Each diagnostic returned `status=error` and exit 1 for a launch-PID mismatch. The DAWproject static inspector ran on the timestamp-validated installed binary.
- The expanded informer diagnostic produced `artifacts/ipc/midi-port-informer-gates-3720.json`; no unknown global pointee was read.
- A later, separately bounded registry read produced `artifacts/ipc/midi-port-registry-names-3720.json`, with offline vtable-to-RTTI evidence at `artifacts/research/session-09/port-registry-rtti.json`.
- A bounded scanner record read produced `artifacts/ipc/midi-scanner-state-main-3720.json`; string encodings, lengths, vtables and repeated bytes were checked before recording names.
- A bounded MProject/MRoot and notification-listener snapshot produced `artifacts/ipc/dawproject-host-context-main-3720.json`; the list contained the informer. All reads were unlocked, and no listener method was invoked.
- A further type-checked root-field snapshot found `MRoot+0xf8` points to an `MTempoTrackEvent`, not an identified arrangement (`artifacts/ipc/dawproject-root-field-main-3720.json`).
- The scanner, host-context and root-field diagnostics each returned `status=error` and exit 1 for a launch-PID mismatch. The timestamp-validated DAWproject, MIDI correlation and project-tree static inspectors completed on the installed files.
- A static range-alignment review found and corrected one DAWproject disassembly start inside an instruction; the corrected inspector produced the expected aligned instruction.
- `artifacts/ipc/dawproject-modules-3720.json` records the loaded component; `artifacts/ipc/dawproject-factory-independent-20261110.json` records the independent metadata query. Neither is a successful import or save.
- The prior revision 3.3 TypeScript build and 70/70 Node suite are session 08 evidence; no new controller revision or live control result is claimed here.

## Remaining

Recover port synchronization and a repeatable background mapping activation; establish real host project creation, saving and editing contracts; then implement and verify the remaining Cubase feature families. Do not call unverified file-mutating native paths or infer success from a loaded component.
