# Native path-service caller: drag-data evidence

## Scope and fixed profile

This is read-only static research on the installed `Cubase 16.exe` x64 image, PE timestamp `0x6adf121b`, preferred image base `0x140000000`; RVAs below are specific to that image. No interface query, host call, process write, UI interaction or project operation was performed. The caller does not establish a usable unattended project-open route.

## Findings

The runtime function beginning at `0x3933f10` proceeds only when its receiver field `+0x18` is non-null and the vector-shaped range at `+0x28..+0x30` is empty. Following a successful indirect call on that field, it obtains a pointer from `0x39206c0`, calls its receiver's slot `+0x40`, and passes that result to `0x3541930`. The latter calls slot 0 with raw IID `5b428884480e7c405f52409d31467af2` and retains the returned pointer on the success branch. This establishes a query-shaped operation but not the identity or lifetime of a live receiver.

The path-service IID `a18ef30af240144b965bf97ca4ff94d1` is passed to the resulting receiver's slot `+0x18` at `0x39340b5`, once per item in a loop. The same loop invokes the imported `SHELL32!DragQueryFileW` first for the item count and then for each filename, invokes `KERNEL32!GetFileAttributesW`, and checks an extension using `SHLWAPI!StrRChrW` and `StrCmpIW`. After an optional separate branch for an extension, the selected filename buffer and an attribute-derived flag are passed to the path object's slot `+0x20` at `0x39341d9`. A non-null path object is retained into the receiver's vector and the temporary reference is released. These observations identify a native drag-data path-building caller, not an open request or a project-completion event. They neither prove that this caller executes in the isolated instance nor identify the controlling thread.

The `FNPath` secondary slot `+0x20` target `0x3b0f4b0` forwards to `0x3b183d0`; on zero return, a negative third argument, and a non-null global, it additionally sets a field and calls `0x3b0c710`. This is evidence that the third argument affects more than simple filename copying on that branch; its complete semantics, encoding and ownership remain unproven. The flag observed at the drag caller is derived from file attributes and must not be generalized to other callers.

## Reproduction

Run `E:\Py\python.exe scripts/project-open-14-inspect.py`. The inspector verifies the fixed machine, timestamp, preferred base, IID and four import names, requires PE runtime-function beginnings, and disassembles those full functions from their starts. The output exposes instruction addresses and import identities; it does not validate runtime state or invoke Cubase. The focused inspector completed successfully in this session.

## Remaining contract

A host-owned, background-compatible dispatch route; path encoding and lifetime; prompt/error behavior; project selection and completed-open signal all remain unresolved. Do not substitute this drag-data caller for a project-open implementation or infer success from static construction.

## Host-open submission branch

The runtime function at `0x3751d40` first converts the required path and, if present, the second path. A null required conversion leads to return `1`. After conversion, it invokes slot `+0x88` on a global-derived object. If the resulting byte is nonzero, it directly calls a separate global-derived receiver's slot `+0x178` with the converted objects and returns the logical inverse of that call's low-byte result. The meaning of the predicate and receiver are not established, and the immediate result is not independently confirmed as project completion.

On the predicate-zero branch, the method constructs the `OpenFile` action and supplies the path fields as previously described. It passes `r9 = 0` and a zero fifth argument to thunk `0x3a8d370`, which jumps to `0x3a8c770`. The latter's conditional scan at `0x3a8c79d..0x3a8c83c` is skipped for this call because `r9` is zero. It allocates a `0x28`-byte object whose final vtable is `0x4825768`, with RTTI `Steinberg::FPostedMessage`; the action and receiver are stored at offsets `+0x10` and `+0x18`, and the fifth argument at `+0x20`. The submission calls thunk `0x3ab9330`, which jumps to `0x3a88620`: on non-null arguments and successful node allocation, it appends a node containing the message to a linked structure, invokes `0x3a87fd0`, increments the count at `+0x10`, and returns true. The open method ignores that return and itself returns zero after the submission call, including the allocation-failure paths visible in the enqueue helper. This is stronger evidence of queue submission, not proof of delivery, success, project identity, or durable completion.

Neither branch here identifies its execution thread or establishes absence of prompts. The predicate's meaning, the queued message consumer's concrete receiver, actual project-open completion signal and error/prompt conditions remain to be traced. No unverified interface calls or project writes were made. The fixed-profile inspector now checks both thunk targets, the posted-message RTTI and these three complete runtime functions; its focused run succeeded.
