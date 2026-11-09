# MIDI Remote detection scheduler callers

Static-only analysis of Cubase AI 16.0.5 Windows x64, PE timestamp `0x6adf121b`; no process, UI or configuration was changed. Previous bounded coordinator evidence for PID 3720 is described in `docs/midi-detection-ports.md` and is not a new live observation here.

`0x2623970` constructs the callable whose RTTI identifies `SystemHostEnvironment::ensureUpdateDeviceDetection`, as established in `docs/midi-detection-ports.md`. Nine relative call sites occur in the current executable. Vtable pointer and MSVC RTTI inspection identify these caller entries:

| Caller entry | Call site | RTTI vtable and slot | Observation |
| --- | --- | --- | --- |
| `0x2622480` | `0x2622562` | `SystemServiceCommands`, `+0x38` | Passes two locally built reference pairs. |
| `0x26225f0` | `0x2622972` | `SystemServiceCommands`, `+0x48` | Passes locally built reference pairs, with weak-reference locking nearby. |
| `0x2635650` | `0x26358e7` | secondary `SystemRoot`, `+0x18` | Calls scheduler with two zero pairs only when `R15B` is nonzero, after a separate virtual callback. |
| `0x2635d80` | `0x2635dd6` | `SystemHostEnvironment`, `+0x00` | Subtracts `0xd0` from `this`, calls with two zero pairs near entry. |
| `0x2636950` | `0x2636991` | `SystemHostEnvironment`, `+0x08` | Same adjustment and zero-pair setup near entry. |
| `0x2637450` | `0x2637c59` | `SystemHostEnvironment`, `+0x10` | Calls after other reference handling with two zero pairs. |
| `0x263b7f0` | `0x263be31` | prepared activation execution chain | Calls after instance creation and its two port-collection operations. |

Two more sites, `0x25db1bd` in `0x25db150` and `0x25fde48` in `0x25fdd80`, pass values obtained through reference-handling helpers; the latter first requires `RBP == RDI`. No direct vtable pointer to either function entry was found in `.rdata`; that does not rule out thunks or other forms of dispatch.

The host-environment entries are virtual functions but their names, input semantics, upstream event source, executing thread, and whether any specific invocation enqueues or runs the detection callback are unresolved. The `SystemServiceCommands` virtual slots and their apparent parameter pairs are not proof of an externally supported API. The post-creation call establishes an additional refresh relationship but does not identify the path that created the command in the first place. No complete automatic detection-to-prepared-activation chain or independently verified standard background trigger is established.

For a future bounded observation, the prior verified SystemRoot transient field at `+0x130` is documented in `docs/midi-detection-ports.md`; a point-in-time null value cannot distinguish an unscheduled callback from a completed one. The next useful static slice is to identify the entry callers' receiver and event semantics, especially `SystemHostEnvironment` slots `+0`, `+8`, and `+0x10`, or to prove how the detection callback reaches prepared-command construction. `python scripts/midi-detection-ports.py --target schedule` and `--target detection_callback` reproduce the existing verified-build disassembly without process access.
