# Project Host Request ABI: Observed Call Sites

Date: 2026-11-10. Target: installed Cubase AI 16.0.5 on Windows x64. This is an incomplete, build-specific observation, not a supported SDK or a verified live client. No host request or process modification was performed in this investigation.

## Host request entry

The request-bearing secondary subobject is complete-object offset `+0x10`; its vtable slot 3 is executable RVA `0x1dd0490`. Query-interface logic at `0x1dd03e0` compares raw IID bytes `f1 79 58 57 70 b2 bf 48 82 1d be 11 9c d3 83 5f`, returning this subobject with a reference. The RTTI-embedded decorated method name at RVA `0x5566260` encodes the source-level shape `int request(const char* const&, IProjectPluginRequestCallback*, uint64_t&)` on this compiler. On entry, `RCX`, `RDX`, `R8`, `R9` carry those four arguments respectively. The method copies the input from the referenced NUL-terminated pointer into owned string storage at `0x1dd0637`–`0x1dd065e`, before dispatch.

The method increments its request counter and stores the identifier through the output reference at `0x1dd061c`. It retains a non-null callback through vtable slot 1 at `0x1dd06ba`–`0x1dd06c0`, captures that reference, and either dispatches or invokes its work inline. The immediate return is zero at `0x1dd081f`; completion is communicated separately. Callbacks can therefore occur before the request call returns or later. There is no basis to treat that return as successful project access.

## Callback call sites

The work body at `0x1dcfb50` uses the captured callback. All calls below are Windows x64 virtual calls with the callback object in `RCX`; the observed code ignores the callback method's return register.

| Slot | Observed arguments | Evidence and limitation |
| --- | --- | --- |
| 1 | `RCX = callback` | Host retains via `[vtable+0x08]` at `0x1dd06ba`–`0x1dd06c0`; return type and lifetime policy beyond this reference are not established by that call. |
| 2 | `RCX = callback` | Captured reference is released via `[vtable+0x10]`; a concrete callback implementation's own allocation and destruction policy is not recovered. |
| 3 | `RDX = uint64 request ID` | Called through `[vtable+0x18]` at `0x1dcfc09`–`0x1dcfc14` when the cached service exists. This is a begin-like notification; its source-level name and return type are unknown. |
| 4 | `RDX = uint64 request ID`, `R8 = &responsePointer` | Called through `[vtable+0x20]` at `0x1dcfcc3`–`0x1dcfcf1` on a zero service return. `responsePointer` points to a NUL-terminated byte string, stored inline or on the heap in the work body's local string. The reference and string are borrowed, not transferred: the host resets/frees that local string immediately after callback return at `0x1dcfcfa`–`0x1dcfd46`. Copy synchronously if retaining data. The source-level return type is unknown. |
| 5 | `RDX = uint64 request ID` | Called through `[vtable+0x28]` at `0x1dcfcc3`–`0x1dcfcf9` on missing service or nonzero service return. No extra error value is set up by this call site; source-level return type and error taxonomy remain unknown. |

The host obtains the service through an independently observed IID and calls its slot 3; the intermediate service output object is distinct from the external request callback. A parser status is saved in host state, but is not passed as an argument to slot 5 at this call site. A request ID is not a project result.

The direct notification calls set no fifth or later stack argument: slot 3 sets `RCX` and `RDX`; slot 4 additionally sets `R8`; slot 5 uses `RCX` and `RDX`. Their return registers are ignored. The request path retains the callback at `0x1dd06ba`, the heap work-item copy constructor retains it again at `0x1dcef23`–`0x1dcef33`, and the stack capture releases it at `0x1dd07ca`–`0x1dd07d6`. Within these traced direct request/capture/notification paths the callback is not queried through slot 0. This bounded observation is not proof that no other host path ever queries it. A C-style thunk table matching the observed call registers can be used to describe the direct subset without claiming the original C++ declarations or notification return types; its `void` returns in the accompanying header express only that the host ignores those return registers. Slot 0 is intentionally opaque, not an asserted query-interface prototype.

The dispatch branch calls `0x16f41c0` at `0x1dd071c`, tests the returned holder's first pointer, and directly executes the work body at `0x1dd077b` only if that pointer is null. Otherwise it builds a heap work item and invokes the non-null holder object's vtable slot 1 at `0x1dd0776`, passing the value obtained from slot `0x90` and a pointer to the work item. The holder's runtime value, scheduler semantics, execution thread, and delivery guarantees remain unknown. A call from a worker is not evidence that work runs on a host thread.

The getter returns executable image base plus RVA `0x5890930`: both the initialized fast path at `0x16f41e7` and the initialization path at `0x16f4221` load that same address. The address lies in the `.data` virtual range with no file-backed initialized bytes at that RVA. Inspecting its first pointer for non-null before a request is only a snapshot, not an atomic guarantee that the later test inside `request` sees the same value; a concurrent change could still select inline execution. Non-null also establishes neither the dispatch destination nor its thread-safety.

## Incomplete declaration and execution boundary

`native/bridge/ProjectHostAbi.h` describes the observed direct-call subset and a borrowed result view, but not a complete callable callback interface: the callback's slot 0 IID/query behavior, concrete implementation's reference semantics, notification return types, cancellation and teardown, and callback threading requirements have not been proven. A source-level signature must not be invented from unused registers or an ignored return value. The later explicitly approved diagnostic submitted one fixed `GetMusicalTrack` request in PID 66528 and received a correlated error callback, not project data; see `docs/native-probe.md`. Its lifetime safeguards and dispatcher snapshot do not establish the complete production threading or teardown contract.
