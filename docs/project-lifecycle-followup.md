# Project Lifecycle Follow-up: Native Save Destination

Target: installed Cubase AI 16.0.5, Windows x64. This is bounded static analysis of executable bytes; no process, interface or lifecycle method was called or modified. RVAs are build-specific and are not a supported ABI.

## File-system stream path

The arrangement-save routine `0x1d579d0` selects an `FPath`-family object into `RDI`. At `0x1d583aa`–`0x1d583c8` it reads the global interface pointer at RVA `0x5530450`, calls vtable byte offset `+0xc8` with `RDX=selected path`, `R8D=3`, and `R9=&32-bit status`, and keeps the returned object as the serialization stream. A null return takes an early failure path. The selected path can be a newly constructed or transformed object; this observation alone does not show that it equals the candidate project's original `.cpr` filename.

Static initializer `0x15bcb20` constructs a singleton at executable RVA `0x59a01b0`, installs primary vtable `0x48313f0`, and stores its pointer at `0x5530450`. The vtable's MSVC RTTI identifies `Steinberg::FNFileSystem`; its slot `+0xc8` points to `0x3b05e30`. That method converts/validates the supplied path, and its call sites at `0x3b05fec` and conditionally `0x3b0604b` invoke imported `CreateFileW`. Both set the fifth argument, creation disposition, to `2` (`CREATE_ALWAYS`). On final open failure it calls `GetLastError` at `0x3b06063` and, when supplied, stores that value through the fourth argument. The alternate second open is gated by internal state and flags. The concrete selected path, access/share flags, replacement logic and ownership/close semantics remain to be fully traced.

The method allocates `0xf8` bytes at `0x3b05e87` and constructs the returned stream with `0x3b21490`. Its static primary vtable `0x4834088` identifies `FFileStream`; its secondary vtable is `0x4834188`. Secondary slot `+0x10` targets `0x3b21fb0`, whose direct branch calls imported `WriteFile` at `0x3b22058` with the buffer and length supplied to the method. The handle is read at secondary `this+0xc8`, corresponding to complete object `+0xd8`, where `CreateFileW` stores it. Primary slot `+0xd0` is `0x3b21760`, which conditionally calls imported `FlushFileBuffers`; destructor `0x3b21560` conditionally calls imported `CloseHandle` at `0x3b215ce`. The caller later creates serialization structures and passes the document under `Project` or `Arrangement1` as documented in `project-lifecycle-contract.md`.

These observations establish the file stream's write, flush and close implementations, not that a particular save calls every one of those slots, that their failures propagate correctly, or that a resulting file is durable. They do not establish atomic replacement, a completion signal, or success of an actual save. `CREATE_ALWAYS` is a destructive file-creation disposition; do not call this method or infer a safe destination from a launch receipt.

## Existing-path and UI limits

The static `Save` dispatcher with a non-null current path bypasses its initial path-acquisition branch and enters application slot `+0x1c8`. It can still encounter lower-level state checks, error processing and an internal retry in `0x1d579d0`. The existing tests of state and error-helper calls have not established an exhaustive no-dialog route or a host-owned execution-thread contract. Neither a matching application vtable nor a candidate directory/basename snapshot proves that invoking the save from an arbitrary thread is safe.

## Smallest next discriminating work

Trace `0x3b05e30`'s returned stream object through the serialization writes, close/flush and any rename/replace operation, and recover how the caller selects the concrete output path. Separately inspect `0x1d562b0` for error UI and the actual host dispatch contract. A copied-project save experiment is not characterized as background-only or complete until those contracts are understood and disk persistence is independently verified. No project create, open, save or save-as operation was performed in this investigation.
