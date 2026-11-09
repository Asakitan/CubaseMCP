# DAWproject Root and Active-Project Investigation

Static analysis and a bounded read-only snapshot of isolated Cubase AI 16.0.5 PID `3720`; no target method was called, no process or UI was modified, and no import, save or project creation was performed. All RVAs are specific to this build.

## MProject to MRoot

The normal service-locator route and MProject/MRoot snapshot are recorded in `dawproject-host-context.md`. The filter retains the interface returned by `MProject` secondary slot `+0x28`, which corresponds to `MRoot` complete-object `+0x98` in the observed object. At filter RVA `0x1f839` the importer calls this interface's virtual `+0x80` with a null second argument. Cubase's `MRoot` secondary vtable `0x4472130` maps that slot to `0x27575b0`: the null branch subtracts `0x98` to obtain the root, calls `0x27577b0`, and returns the result's `+0xe0` subobject if non-null. `0x27577b0` performs state-dependent lookups, allocation/reference management, and multiple virtual calls; it is not an established fixed-field getter or proof of main-thread dispatch.

The same MRoot secondary vtable's slot `+0x68` is the leaf `0x2758c60`: it reads secondary `this+0x60`, i.e. complete `MRoot+0xf8`, and returns the pointed object's `+0x1a8` subobject if present. This field must not be assumed to be an arrangement.

## Bounded live field check

At `2026-11-09T17:24:30.1544335Z`, `scripts/Read-DawprojectRootField.ps1` checked PID/launch receipt, private-desktop ownership, executable/version/base and stable `MProject`/`MRoot` vtables before reading `MRoot+0xf8`. It recorded `MProject=0x482c9c50`, `MRoot=0x79142fa0`, and `MRoot+0xf8=0x59a670b0`; the latter's primary vtable RVA was `0x4475ca8`. Static MSVC RTTI identifies it as `MTempoTrackEvent`, with secondary vtable RVA `0x4476318` at complete-object `+0x1a8`. Only after this static class/offset evidence did the snapshot read and match that secondary vtable. Relevant fields and vtables were double-read, and process start was rechecked. Raw evidence: `artifacts/ipc/dawproject-root-field-3720.json`.

The value is a tempo-track event object, not an identified active arrangement, project creation result, or evidence that DAWproject import can run. The check is unpinned and cannot guarantee object lifetime or active-project identity. One initial script invocation stopped before the field read because an inherited PowerShell exit-status check treated an unset status as a failure; the check was corrected and the recorded snapshot succeeded.

The coordinator independently reran the validated diagnostic at `17:25:04Z`; its unmodified output is `artifacts/ipc/dawproject-root-field-main-3720.json`. The same primary and secondary vtables were observed with stable rereads. This remains a separate point-in-time observation, not a callable project-editing contract.

## Remaining work

The existing-window `PArrangement` candidate route in `project-lifecycle-contract.md` was observed in a different process and is not evidence for PID 3720. Recover a lock-consistent or independently verified relationship between an arrangement document and this `MRoot`, the real host-owned execution thread, and the native new-project constructor/lifecycle before attempting a copied-project import. Current findings establish object and tempo-interface shape only, not a complete CRUD contract.
