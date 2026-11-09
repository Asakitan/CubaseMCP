# Project Host Request Investigation

Date: 2026-11-10. Target: locally installed Cubase AI 16.0.5, Windows x64. This is static interoperability research, not a supported SDK or a usable client ABI. RVAs are specific to this installation.

## Request path

The `Cubase 16.exe` RTTI identifies `ProjectPluginHost` and the uniquely named lambda nested in its `request` method. Its secondary-subobject vtable is at RVA `0x4305018` (complete-object offset `0x10`), with slot 3 at `0x1dd0490`. That method constructs the matching lambda at `0x1dd0747`; its target executes at `0x1dcfb50`. This establishes the connection between the RTTI name and the method, rather than relying on a string alone.

At entry, Windows x64 registers carry the secondary host pointer in `RCX`, a pointer to a narrow-string pointer in `RDX`, a callback object in `R8`, and a pointer to a 64-bit output in `R9`. The method increments a counter, writes the resulting request ID through the output pointer, increments the callback's reference using vtable offset `0x08`, constructs a captured request, and dispatches it through another host object when present or executes it inline otherwise. It returns zero at `0x1dd081f`. A zero immediate return is therefore not evidence that the requested operation succeeded.

The lambda checks a cached service pointer at complete-object offset `0xf8`. If present, it calls callback vtable offset `0x18` with the request ID, then service vtable offset `0x18` with a string-reference argument and two output objects. Depending on the service return, it calls callback offset `0x20` with the ID and a response-string reference, or offset `0x28` with the ID. If the service pointer is absent it takes the latter callback branch. Exact method names, output types, lifetime, error meanings and threading rules are not established. The callback reference is released through vtable offset `0x10`.

The request method initializes the cached service via a global lookup at RVA `0x3aa5d80`, followed by an interface query using the 16 bytes at RVA `0x54eeee0`: `ba 81 0b e2 39 5d 49 49 9c 8e e9 69 38 72 de f6`. This is the byte representation observed in this build, not a claimed canonical GUID or proven service identity. The global lookup receives an address in zero-filled storage, so its runtime registration and ownership remain unresolved.

## Component evidence

`Components/projectplugin.dll` has RTTI names `IProjectPluginService`, `ProjectPluginRequest`, `GetMusicalTrackRequest`, `CreateTracksRequest`, `MixExportRequest`, `TransportRequest`, `LocatorsRequest`, and corresponding response types. The initialized strings at RVAs `0x33d68`–`0x33ee8` include `payload_version`, `command`, `tracks`, `clips`, `events`, `file_path`, `response_name`, `response_status`, `track`, and `response_action`, plus version-pattern text `^\\d{4}\\.\\d{2}\\.\\d{2}$`. These strings identify candidate fields, not a complete request or validated schema.

### Read-only request candidate

The request parser at `0x23730` compares `command` against `ExportMix`, `CreateTracks`, `Transport`, `Locators`, and `GetMusicalTrack`. The `GetMusicalTrack` branch calls `0x22d50`, which looks up a required `type` string and accepts exactly `Tempo`, `Key Signature`, `Chord`, or `Bar Signature`. If `range` is absent, it selects internal range mode 0. If present, `range.mode` must be `Locators` or `Seconds`; the latter reads `start_time` and `duration`, rejecting a duration that compares less than or equal to zero. Numeric helper behavior and all malformed inputs remain unverified.

The version validator `0x1f8f0` checks the date-pattern string and compares dot-separated numeric segments against a runtime global. Initializer `0x10b0` copies `2026.10.01` from RVA `0x31f50` into that global at `0x42070`; request versions below that value take the success branch and versions above take the failure branch. Runtime changes and full boundary behavior have not been tested. On this build, a **static, unexecuted candidate** is:

```json
{"payload_version":"2026.10.01","command":"GetMusicalTrack","type":"Tempo"}
```

This candidate is a hypothesis assembled from observed parser branches, not a live-certified request. There is no claim that it is sufficient to access a project in the running application.

The service entry at `0x11ef0` calls that parser and response serializer `0x1e2d0`. The latter references `payload_version`, `response_name`, `response_status`, and `track` in addition to fields for other commands. A nested track serializer at `0x26360` references `type`, `color`, and `events`; the exact response nesting and values are not established by these references. Empty input sets the integer output to 4 and returns 1; parser failure or an empty serialized response also returns 1. For a nonempty response it calls vtable offset `0x18` on the supplied output interface with a pointer/length pair and returns 0. No service invocation has been made by this investigation.

### Interface identity and registration

The request-bearing secondary host subobject's `queryInterface` thunk at `0x1dd0478` delegates to `0x1dd03e0`. The latter matches raw IID bytes `f1 79 58 57 70 b2 bf 48 82 1d be 11 9c d3 83 5f`, increments the reference and returns complete-object offset `0x10`; a second IID `11 5e 1b 0b fc db 29 40 bb c1 9c 06 2b 3f 99 cb` returns offset `0x18`. Nominal names remain inferred from RTTI rather than proven declarations.

The host constructor's static initializer `0x13785d0` constructs an object at executable RVA `0x58d1770`. Function `0x1dd0340` passes its request-bearing subobject at `0x58d1780` to `0x3aa3230`. That callee obtains an object via `0x3aa5890`, calls a virtual method on its subobject at offset `0x20`, passes the host pointer and object offset `0x08` to `0x3ad8100`, and calls another virtual method on the first subobject. This is a registration-like operation; its registry, calling context and accessibility from a normal VST3 `hostContext` have not been established.

The component's service entry `0x11ef0` is slot 3 of `ProjectPluginComponent`'s vtable at RVA `0x323a0`, corresponding to complete-object offset `0x30`. The host's requested service IID byte sequence also appears in the component at RVAs `0x34628` and `0x42518`. The component constructor at `0x67a0` performs field/vtable initialization without calls; this observation excludes the allocation helper, module initialization, and factory wrapper.

## Reproduction and next step

Run `python scripts/host-project-inspect.py --output PATH` with diagnostic Python dependencies `pefile` and `capstone` to recover RTTI/vtable references without opening a process; use a new writable output path. The companion `host-project-*` evidence files were initially generated under the workspace root because its existing artifact directory denied sandbox file creation, then archived under `artifacts/ipc`. The bounded disassembly excludes unrelated subsystems.

The smallest next static step is to trace executable RVA `0x3aa3230` and its registration consumers to establish whether the global host interface is reachable from a normal plugin host context, then recover callback and response-object ownership. Only after these are established should the candidate read-only request be attempted against a copied project. No native project query, project creation, saving or mutation was executed in this investigation.
