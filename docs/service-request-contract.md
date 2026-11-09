# Project Service Request Contract: Static Evidence

Date: 2026-11-10. This note describes the installed Cubase AI 16.0.5 `projectplugin.dll` only. It records build-specific evidence, not a vendor-supported ABI. The prior independent acquisition of the service interface is recorded in `native-factory-recovery.md`.

## Request entry and output lifetime

The independently obtained service interface has slot 3 at RVA `0x11ef0`. Under the Windows x64 calling convention its observed register usage is:

| Register | Observed use |
| --- | --- |
| `rcx` | Service interface pointer; `[rcx+8]` is forwarded as context to recognized request handlers. |
| `rdx` | Pointer to an input structure whose first field is a pointer to a NUL-terminated byte string. The entry dereferences this field and computes its length; it does not read an explicit input length before copying the string. |
| `r8` | Output receiver object. On a nonempty serialized response, the routine calls its vtable slot 3 with a pointer to a two-word `{data pointer, length}` span. |
| `r9` | Pointer used as a 32-bit status output. The empty-input branch stores `4` there and returns `1`; other status semantics remain to be established. |

At `0x12167`–`0x1218c`, the response data pointer and length are put into a stack-local pair and passed to the receiver. The backing serialized string is destroyed immediately after the callback returns (`0x12192`–`0x121d2`); a receiver that needs the content afterward must copy it synchronously. The routine does not use the receiver callback's return value in this path. Successful nonempty serialization returns `0`; parse failure or absent serialized content can return `1`. This does not establish a complete error-code taxonomy, input structure beyond its first field, callback interface identity, or validity of any particular JSON request.

Empty input takes the branch at `0x11f3f`–`0x11f50` before the parser or response callback. Nonempty input enters the parser at `0x23730` and recognized commands use the forwarded context. The callback contract, complete request semantics, and independent object lifetime and initialization requirements remain incomplete.

## Independent empty-input probe

The explicit `-ProbeEmptyRequest` mode creates the observed service in a separate process and submits exactly one empty NUL-terminated input through slot 3. It checks the observed slot RVA before calling, passes a null output receiver only for this statically identified early-return branch, and supplies a writable 32-bit status. It accepts no request text, supplies no host context or synthetic interface, and does not attach to Cubase.

One execution at `2026-11-09T15:30:09.0363152Z`, PID `34316`, returned `1` with status `4`, matching that branch. The service creation returned `0`. Evidence is in `artifacts/ipc/empty-request-probe-20261110.json`. This verifies only the empty-input branch in the diagnostic process, not parsing, response callbacks, live project access or native editing. The initial invocation without a process execution-policy override was rejected before the script ran; the successful invocation used `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Inspect-ProjectFactory.ps1 -ProbeEmptyRequest`.

## Context pointer observations

The service interface is at backing object offset `+0x30`; its `+8` field is therefore backing object offset `+0x38`. Constructor RVA `0x67a0` initializes this field to null. The backing object also exposes an interface at offset `+0x20`:

* Query-interface logic at `0x11ce1` recognizes raw IID bytes `8e c2 43 7a c2 ba d1 48 b7 2d 1a a2 20 fe bf 10` at RVA `0x42488` and returns object `+0x20`.
* The path at `0x11d63` also returns object `+0x20` for raw IID bytes `c5 9a f6 98 8d 57 22 4a b8 e0 27 81 c0 6c ff 25` at RVA `0x42470`.
* This interface's slot 3, RVA `0x11a80`, stores its second argument at interface `+0x18`, i.e. backing object `+0x38`. Slot 4, RVA `0x11ac0`, clears that field only when it equals its second argument. Neither leaf method itself retains or releases the pointer.

These observations establish a raw pointer path into request handlers, not the identity, ownership, thread affinity, or validity of the required host object. The interface names and their lifecycle contract are not established. Supplying a fabricated pointer or invoking the setters would not establish a real live project context, and was not performed.

## Remaining work

Trace host-side creation and registration of the object passed to this interface, including its identity, lifetime and threading. Recover receiver interface identity and the entire request and status contracts from independent call sites before any nonempty request. A service object created in a separate diagnostic process is not itself connected to the existing Cubase project. Project enumeration, mutation, project creation and rendering have not been demonstrated.
