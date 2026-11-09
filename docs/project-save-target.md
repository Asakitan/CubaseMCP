# Project Save Target and Error Path

Target: installed Cubase AI 16.0.5, Windows x64. Static, read-only analysis; no target function, write operation, UI, process modification or settings change was performed. RVAs refer only to this build.

## Working path object

In the `PArrangement` save implementation `0x1d579d0`, `R12` retains the incoming path object and `R14` retains the document. At `0x1d57fa5`–`0x1d57fc8`, the code allocates `0xe8` bytes and calls `0x3b0c790` with that path. That constructor initializes an `FNPath`-derived object from the supplied object and copies the `+0x18` text, fields `+0xc0/+0xc2`, `+0x30` component data and `+0xc8` text. The save method then calls its virtual slots `+0xf0`, `+0xf8`, and `+0xe8` with state-dependent inputs before selecting it into `RDI` at `0x1d581a9`–`0x1d581ba`. The filesystem call at `0x1d583c2` receives `RDI`, not necessarily the original `R12` pointer.

The concrete `FNPath` slot `+0xf0` is `0x3b183c0`, which passes its `+0x30` subobject to `0x3b15660`; its slot `+0xf8` is `0x3b0fa50`, a nontrivial path operation. Therefore an input directory and basename snapshot alone does not identify the file actually opened. In particular the path may be transformed; the available static trace does not yet establish whether this is a temporary file, a direct replacement or another destination, nor the conditions for any later rename. Do not infer target identity from input pointer equality.

## File-open and error path

As detailed in `project-lifecycle-followup.md`, `0x1d583c2` calls the `FNFileSystem` slot that can reach `CreateFileW` with `CREATE_ALWAYS`, returning an `FFileStream` with `WriteFile`, conditional `FlushFileBuffers`, and `CloseHandle` implementations. These are actual potentially destructive file operations, but their presence is not proof of a completed write or atomic replacement.

The same static `FNFileSystem` vtable's slot `+0xe0` targets `0x3b0b820`, which calls imported `DeleteFileW` at `0x3b0b879` and `0x3b0b8b9`. The save routine invokes that slot with its current path variable `RSI` at `0x1d58a1c` and, on a different conditional path, with original argument `R12` at `0x1d58a34`. The triggering state and complete recovery/replace behavior remain unresolved. This is evidence of possible deletion, not proof that either call executes during a particular save.

The save routine's failure branch at `0x1d58d50` calls `0x1d562b0` with a status and the document/path context. At `0x1d5671f`–`0x1d56732`, that helper obtains an object and makes an indirect call with result storage; at `0x1d56736`–`0x1d5674b`, it branches on the resulting integer. For status `-0x60` one result causes a document flag update at `0x1d56751`; the caller may then recursively re-enter the save routine. Another result follows a file/context path that references the string `More Information` at `0x1d5680c`. This is a concrete user-interaction-like decision path, but the callee's precise UI behavior and all error meanings are not established. A fixed existing path does not prove the operation stays windowless.

## Remaining discriminators

1. Reconstruct the path-component transformations and subsequent filesystem rename/replace branches, including the exact selected path before `CreateFileW`.
2. Identify the indirect error-helper callee and show, branch by branch, whether it can require user interaction or internally retry.
3. Establish a host-owned main-thread dispatch mechanism and lifetime of the selected arrangement; the read-only candidate-document chain does not guarantee either.
4. Find a concrete native new-project construction path separately; string names and the generic no-op application slots do not establish one.

Until those points are proven, no existing-project save or new-project CRUD capability is claimed. The next execution test, if later justified, must use a disposable copy and independently validate destination, project content and reopen behavior.
