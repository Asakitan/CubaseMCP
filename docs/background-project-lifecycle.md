# Managed background project lifecycle

## Shipped MCP surface

The server now exposes **30 tools**. Five are explicit lifecycle operations:

| Tool | Contract |
| --- | --- |
| `cubase_runtime_status` | Inspect the exact owned process/holder lifetimes and restricted Job; no MIDI handshake or process start. |
| `cubase_project_create` | Create a real blank project at a new local CPR path, bind its document path, store it, and connect MIDI after mapping readiness. Not a template copy. |
| `cubase_project_open` | Open an existing local CPR as the first project of a fresh owned private-desktop instance; verify its live document path and connect. |
| `cubase_project_save_as` | Require the current MIDI session and managed source path, bind a new destination, save, and verify the document's resulting path. No destination overwrite. |
| `cubase_runtime_stop` | Explicitly discard unsaved changes and end only the exact owned process/holder. It is not a save operation. |

Create/open can replace a currently owned instance only when both `replaceCurrent: true` and `confirmDiscardChanges: true` are supplied. The default preserves a running instance. Stop requires `confirmDiscardChanges: true`. An unowned, ambiguous or lifetime-mismatched Cubase process is never adopted or ended. These confirmations are MCP arguments, not a request for interactive dialogs.

Paths must be absolute local drive paths, at most 500 characters, below a drive-root project folder. Alternate data streams, reserved device names and existing reparse-point ancestors are rejected. Create/save-as require an absent destination; open requires an existing CPR. Other import formats, overwrite, merge, collect/copy, project-version migration and recovery of arbitrary third-party projects are not certified.

## Architecture

`src/lifecycle.ts` starts the single fixed `Project-Runtime.ps1` helper with a JSON request file under E-drive artifacts. There is no shell command supplied by the caller, adapter selection or fallback route. The helper serializes lifecycle work, validates actual process/parent/Job identity, starts the existing restricted private-desktop launcher, and invokes the fixed-build native initializer. MIDI remains the one parameter/control transport; lifecycle methods are explicit native operations rather than attempts made after a MIDI failure.

`native/ProjectCreateLoader.cs` and `native/bridge/CubaseProjectCreate.cpp` target the inspected Cubase 16.0.5.174 build. They check the target/holder lifetime, executable, vtables, initial project state and event thread. A process-local one-shot message hook schedules the whitelisted operation on that event thread and is removed before execution. No host instruction patch, license change, foreground activation, keyboard/mouse input or dialog action is used. An operation image and its temporary path objects are retained until that owned process ends; no obsolete diagnostic driver is installed.

The create path constructs `PArrangement` directly, not by copying a CPR. Save/create bind the destination through the actual document path setter (`+0xd8`, build-specific target `0x1cfee50`) before the application save method (`+0x1c8`). The latter is then called with its current-path form. Passing only a third-argument path had written a file without binding the live document; that earlier prototype is not the final contract. Open uses the fixed host `IHostApplication2` path interface. Every successful operation must match the current root/document and requested path before reporting success.

A failure after path binding may leave a changed in-memory path or an incomplete file. The error is not an automatic rollback or permission to replay; the existing instance, result and admission records are retained. High-frequency native-operation image lifetime and arbitrary legacy/media-rich projects have not been load-tested.

The initializer returns before MIDI Remote necessarily activates. The helper therefore observes the installed controller's matching construction, activation and subsequent idle records before the server sends its **one** new-host handshake. It does not solve readiness by retrying MIDI messages. MIDI requests already in flight prevent a lifecycle transition; pending writes are not cancelled to make room.

`artifacts/runtime/cubase-launch.json` describes the original no-project launch, not the current project. `managed-project.json` records the correlated managed path and native result for that process lifetime. Both are local state, not a security boundary against a malicious same-user process. A result/metadata write or host interruption can leave an operation incomplete; consumed records, failed results and known file outcomes are retained. No automatic mutation replay or hidden rollback is performed.

## Build and limits

`npm run build:native` produces the fixed native DLL and loader in `artifacts/native-runtime`; `npm run build` builds the MCP server. These artifacts are already built on this host. MSVC and the .NET Framework compiler are build prerequisites, not alternate providers. Future task helpers and compilers inherit E-drive TEMP/TMP. Installation of the MIDI script itself still does not start Cubase.

This is a private-desktop GUI host, not a windowless Cubase engine. Job restrictions and code paths prohibit foreground operations; sampled foreground values are not a continuous global history. General project editing, routing, automation-node editing and exports remain separate unfinished work.

## Live evidence

`artifacts/ipc/lifecycle30-bound-path-live.json` records one successful **real stdio MCP** sequence:

1. Native blank create + bound initial store: `New.cpr`, **67,595 bytes**, PID 27772.
2. Native save-as: `Version.cpr`, **68,380 bytes**, same process, document path verified.
3. Owned replacement and open: same `Version.cpr`, fresh PID **9348** / creation **134387351968202198**, no Save submitted during open.
4. MCP mapping ready and live discovery returned only `Stereo In` and `Stereo Out`, with no copied Piano track.

The saved paths are under `artifacts/managed-projects/正式生命周期 30/`. Stop/status were also observed through MCP; `lifecycle29-live.json` retains those results and its later failed launch publication. Earlier failures and partial results are preserved in `project-create-29.md`. The previous tempo-146.75 Save/reopen chain was **not** repeated.

The native/TypeScript builds and focused lifecycle routing/admission tests passed. Historical 109-test totals are not a new full-suite claim. This acceptance covers the tested blank CPR lifecycle, not every existing project's content or edition feature.
