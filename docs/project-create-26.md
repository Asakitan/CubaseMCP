# Hub wrapper callbacks: session 26

This is a file-only static analysis of Cubase AI 16.0.5.174 x64, PE timestamp `0x6adf121b`; RVAs are specific to that build. No process, project, UI, host command, or code injection was used. `scripts/project-create-26-inspect.py` verifies the build, the actual RIP-relative LEA references and selected table entries before printing the relevant disassembly. Run with `E:\Py\python.exe scripts/project-create-26-inspect.py` (requires `pefile` and `capstone`).

## Verified wrapper dispatch

At `0x1ae03be`, `0x1ae03c8`, `0x1ae042f`, `0x1ae0439`, the decoded LEAs reference respectively `0x4271b70`, `0x4271b88`, `0x4271be8`, `0x4271c00`; the stack callable's LEA at `0x1ae0407` references `0x4271c60`. The first allocation stores its captured global receiver at object `+0x18`; the service receives its interface subobject at `+0x10` as `rdx`. The second allocation receives the callable at `+0x18` and passes its interface subobject at `+0x10` as `r8`. The service receiver is selected at runtime and its virtual `+0x18` slot is invoked at `0x1ae04f0`. Both local references are released through interface `+0x10` after the call; this alone does not establish whether the service retained either one.

The first interface table `0x4271b88` has slots `+0x18`→`0x1ae3890`, `+0x20`→`0x1ae3900`, `+0x28`→`0x1ae38e0`, `+0x30`→`0x1ae38b0`, and `+0x38`→`0x1ae38d0`. The latter forwards the captured receiver at interface `+8` to `0x36cd4e0`; `+0x28` forwards its second argument to `0x1d58f20`. The semantic roles of these methods and the returned objects remain unproven.

The second interface table `0x4271c00` has `+0x18`→`0x1ae0100`. That function receives a byte in `dl` and an object pointer in `r8`, queries the object through its first virtual slot, releases the queried interface through `+0x10`, conditionally calls the resulting object through `+0x38`, and invokes the captured callable's `+0x10` with addresses of the byte and resulting object pointer. This describes control and data flow only: the byte's meaning, object type, ownership after the release, and event timing are not established.

The callable table `0x4271c60` has clone-like slots `+0` and `+8`→`0x1adf610`, copying the captured receiver, and invocation `+0x10`→`0x1adf680`. The latter reads the byte and object pointer: byte values 1–4 call `0x1d3a770` with the captured receiver, byte, and pointer; value 5 requires a non-null pointer and calls the receiver's virtual `+0x178` with that pointer and zero. Other byte values return. If either route returns nonzero, it looks up `SmtgHubWindow` and, when found, tail-calls `0x35f02d0` on that object. Whether these values designate templates, files, creation results, or something else, and whether this is a completion callback, is unknown. A nonzero return and subsequent window operation do not independently establish project creation or persistence.

## Boundaries and next step

The concrete Hub service implementation, callback contract, selected template, directory, project name, document ownership, asynchronous retention, and prompt-free creation entry are not established. Static least-next step: trace `0x1d3a770` and the actual captured receiver implementation of `+0x178`, including the origin and type of the object filtered at `0x1ae0162`, and identify the service implementation that calls `0x4271c00 +0x18`. Prove their argument and ownership semantics before considering execution; do not replay prior unknown-outcome requests.

## Follow-up: byte cases and application receiver

The captured value at `0x1ae0359` is global RVA `0x5972e30`. Earlier constructor and static RTTI analysis identify it as the application global (`project-lifecycle-contract.md`); the inspector now checks that the two static primary tables `PCubaseApplication` `0x45d07a0` and `PSequencerApplication` `0x42eba20` both select `0x1d53bb0` at `+0x178`. A historical snapshot saw the first table, but this does not establish the current receiver's dynamic type. Case 5 passes the filtered object as `RDX` and zero as `R8` to that application slot. Prior independent static tracing associates that method with an `FPath`-based existing-project open path and conditional dialogs, not a proven new-project constructor (`project-lifecycle-contract.md`, `project-open-options-23.md`).

At `0x1d3a770`, the captured application arrives in `RCX`, case byte in `DL`, filtered pointer in `R8`; two global state bytes must both be zero to enter its body. The exact semantics of those state bytes are unknown. The dispatch has these verified paths, subject to intervening conditions:

| Case | Static data flow |
| --- | --- |
| 1 | Obtains an object via `0x1d38a80`; if absent, returns false. |
| 2 | Constructs a local value involving literal `Project Dir` at `0x42edcf8`; `0x280ade0` returns an object, and absence returns false. Subsequent calls use the same literal. This is a string reference and data flow, not proof of a destination path or template. |
| 1, 2 | With non-null filtered input, calls `0x1d469c0(application, input, obtained object, conditional byte, 1)`; with null input, calls `0x1d50920(application, obtained object, 1, conditional byte)`. The conditional byte is derived from two virtual calls on another global. `0x1d469c0` in turn calls existing-project routine `0x1d42430` with the input as its second argument and obtained object as its fourth. |
| 3 | Calls `0x1d42430(application, null, 0, 0, 1)`. |
| 4 | Requires non-null input and calls `0x1d42430(application, input, 0, 0, 1)`. |

The cases return whether the downstream returned pointer is non-null; the object obtained for cases 1 and 2 is released on the common return. The code does not establish a durable project, completion of disk save, or a caller-owned document reference. Case 3's null argument is not proof of a noninteractive new project, and case 4 reaches the existing-project routine with its known potential dialog paths.

The null-input case for 1/2 is a concrete construction lead, **not an established executable entry**: `0x1d50920` allocates `0x2d8`, calls `0x1cf3e30` with the obtained object, then passes the constructed object's `+0x108` to project selector `0x279e640` and later `0x279d660`; it returns the constructed pointer. It has further stateful calls. The caller-provided object's exact type and whether it carries a template, path or name are not demonstrated, nor are the target's thread, prerequisites, lifetime, UI effects, save behavior and completion. The absence of explicit directory/name in this call does not prove defaults are suitable. Earlier analysis of this selector is in `project-activation-route.md`.

Smallest remaining static discriminant: trace object production and virtual methods in `0x1d38a80` and `0x280ade0`, particularly the path from `Project Dir`, and the input handling inside `0x1cf3e30`; tie any destination or template fields to a supported host dispatch and an independent completion/ownership contract before execution. The inspector was rerun successfully after adding table assertions and these function ranges; this remains only file evidence.
