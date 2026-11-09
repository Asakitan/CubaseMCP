# MIDI Remote informer upstream sources

Date: 2026-11-10. This is static research against the installed Cubase 16.0.5 Windows x64 build and a bounded read-only private-process snapshot. The executable RVAs and layouts are build-specific, not a supported API. No process writes, GUI operations, configuration changes, MIDI messages or internal function calls were made.

## Source types and call relationships

The `MidiRemoteSystemInformer` complete-object class hierarchy at RVA `0x4bf6940` names secondary bases at `+0x10` `MidiDeviceScanner::Listener`, `+0x18` `IPortRegistryNotification`, `+0x20` `IProjectNotification`, `+0x28` `IProjectStorageNotification`, and `+0x30` `ISystemInformer`. This establishes interface relationships from RTTI, not the validity of directly calling them. The informer/adapter registration and empty-tree snapshot are documented in `docs/midi-host-port-adapter.md`.

The scanner-listener vtable `0x44528d0` has slot `+0x10` at `0x25af030`. It adjusts its `this` pointer to the complete informer, calls `0x25afff0` with the upstream argument, ensures the integer field `+0x54` is at least one, and, when byte `+0x50` is zero and the global at RVA `0x5973dd0` is non-null, sets the byte and passes the informer to `0x3673e30`. The name and full type of that global, callback timing and side effects remain unverified.

At `0x25b001d`, `0x25afff0` skips processing if executable global RVA `0x58f8d00` is null. Otherwise it traverses the two pointers provided as the sequence begin/end in 0x88-byte increments. The code at `0x25b0040–0x25b004c` subtracts each record's `+0x60` pointer from its `+0x68` pointer and skips that record when the difference is less than five. When this check passes it calls `0x22dc9e0` and `0x22dca80`; both contain a `PMidiInterface` type check and virtual calls. These establish necessary branches, not a complete interpretation of record detail bytes, device matching or callback causality.

The object stored at executable RVA `0x58f8d00` is constructed at `0x22be3b7` and its primary vtable `0x43efa28` has RTTI `MidiDeviceScanner@Device@Midi@Steinberg`. Its constructor initializes a three-pointer vector at `+0x358/+0x360/+0x368`. Informer method `0x25b0a40` accesses the global pointer at `0x25b15fe` and, if non-null, passes scanner `+0x358` to `0x25afff0`. The same method earlier references executable RVA `0x5512810`; the coordinator separately traced that object as `PPortRegistry` and inspected its array header. The scanner and registry are therefore associated with the same informer update path, but this does not establish the exact producer ordering, record-to-port relationship, or a path that can safely be invoked externally. Scanner method `0x22d4af0` compares counts of records with nonempty detail ranges between vectors at `+0x358` and `+0x370`; the semantics of that comparison and its invocation timing remain open.

## Snapshot of scanner records

On `2026-11-09T17:16:05.5776451Z`, the bounded read-only diagnostic `scripts/Read-MidiScannerState.ps1 -TargetProcessId 3720` found a live scanner `0x59948080` with the expected vtable and two 0x88-byte records in its `+0x358` vector. The snapshot verified the launch PID and process start time, executable/version/image base, 15 owned private-desktop windows, scanner/informer vtables, vector bounds, and stable double reads of headers, each record and each nonempty string buffer. The process remained alive. The exact output is transcribed to `artifacts/ipc/midi-scanner-state-3720.json`.

The coordinator independently reran the diagnostic at `17:17:47Z`; its unmodified output is `artifacts/ipc/midi-scanner-state-main-3720.json`. It again observed the two names and zero-length detail ranges with stable rereads. These are separate snapshots and do not establish event history.

Each record contained four `Steinberg::FString` objects, verified against vtable `0x4190c98`. Its slot `+0x08` implementation `0x15c5ba0` returns the low 30 bits at object `+0x10` as character length; `0x15c5e30` and `0x15c5dc0` distinguish the `0x40000000` wide-storage flag. The reader limits each string to 512 characters, uses strict UTF-16LE for wide storage and accepts only ASCII for unverified narrow encoding. It never invokes those functions in the target.

| Record | FString `+0x00` | `+0x18` | `+0x30` | `+0x48` | Detail `+0x60/+0x68/+0x70` |
| --- | --- | --- | --- | --- | --- |
| 0 | empty | empty | `Windows MIDI` | `CubaseAI MCP To Cubase` | all zero |
| 1 | empty | empty | `Windows MIDI` | `CubaseAI MCP From Cubase` | all zero |

At that instant both detail differences were zero. **If** these exact records were passed unchanged to `0x25afff0`, its `>=5` check would skip both. The two names are actually observed, but their roles and the meaning of the empty first two strings and detail data are not established. The snapshot does not prove that this function was called then, establish whether the records are MIDI input/output pairs, or prove why their details are empty. It does not explain the complete detection failure by itself.

Separately, coordinator evidence `artifacts/ipc/midi-port-registry-names-3720.json` reports the same private process's `PPortRegistry` count 19/capacity 20 while the informer tree count and another count-shaped gate were zero. A distinct vtable-checked read observed each expected MCP name in both MME socket classes. The shared names do not by themselves prove that the scanner records bind to those registry objects or that a detection callback ran. The informer `+0x50=1` and `+0x54=10` in the scanner snapshot are raw observed fields, not decoded enablement or timing state.

## Reproduction and remaining work

The read-only script accepts a PID but rejects mismatch with `artifacts/runtime/cubase-launch.json`, wrong executable/version/base, absent private-desktop ownership, invalid vtables, excess sizes and changing headers. It returns a nonzero exit on errors. It does not alter state or dereference arbitrary input addresses. Every observation must use fresh process identity and addresses.

The scanner reader also verifies the PE machine and timestamp and reports the `+0x308` receiver. When that receiver matches the fixed static object, it double-reads its two vtables and reports the profile match; a different receiver is reported without dereferencing it. The current-process observation and its limitations are in `midi-activation-15.md`.

Recover the source and lifecycle of each record's two empty strings and detail range, the circumstances under which the scanner publishes or refreshes this vector, and the exact registry-to-scanner mapping before proposing any repair. A current-state snapshot is not event history, and neither a copied project nor a forced mutation proves native project creation or a successful bridge.
