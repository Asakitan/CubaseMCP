# Managed background project lifecycle

## Shipped MCP surface

The server exposes **53 tools**. Five are explicit project-lifecycle operations; the current native editing and recovery contract is [session 34](native-host-contracts-34.md):

| Tool | Contract |
| --- | --- |
| `cubase_runtime_status` | Inspect the exact owned process/holder lifetimes and restricted Job; no MIDI handshake or process start. |
| `cubase_project_create` | Create a real blank project at a new local CPR path, bind its document path, store it, and connect MIDI after mapping readiness. Not a template copy. |
| `cubase_project_open` | Open an existing local CPR as the first project of a fresh owned private-desktop instance; verify its live document path and connect. |
| `cubase_project_save_as` | Require the current MIDI session and managed source path, bind a new destination, save, and verify the document's resulting path. No destination overwrite. |
| `cubase_runtime_stop` | Explicitly discard unsaved changes and end only the exact owned process/holder. It is not a save operation. |

Create/open can replace a currently owned instance only when both `replaceCurrent: true` and `confirmDiscardChanges: true` are supplied. The default preserves a running instance. Stop requires `confirmDiscardChanges: true`. An unowned, ambiguous or lifetime-mismatched Cubase process is never adopted or ended. These confirmations are MCP arguments, not a request for interactive dialogs.

Create/open also own their startup recovery. Before native admission, a sole observed license-check window can trigger one restart of the newly launched empty host and exact same-session license helper. The host is stopped first, then the helper; the fresh host starts its helper normally. A second failure or unrelated prompt is returned. Recovery is included in `startupRecovery` and its disk ledger. Existing user hosts and other Steinberg hosts are preserved; activation data is not changed. This is startup recovery, not replay of an open or edit operation.

Paths must be absolute local drive paths, at most 500 characters, below a drive-root project folder. Alternate data streams, reserved device names and existing reparse-point ancestors are rejected. Create/save-as require an absent destination; open requires an existing CPR. Other import formats, overwrite, merge, collect/copy, project-version migration and recovery of arbitrary third-party projects are not certified.

## Architecture

`src/lifecycle.ts` starts the single fixed `Project-Runtime.ps1` helper with a JSON request file under E-drive artifacts. There is no shell command supplied by the caller, adapter selection or fallback route. The helper serializes lifecycle work, validates actual process/parent/Job identity, starts the existing restricted private-desktop launcher, and invokes the fixed-build native initializer. MIDI remains the one parameter/control transport; lifecycle methods are explicit native operations rather than attempts made after a MIDI failure.

The empty launcher starts only `start-empty-holder.cjs` through local WMI. That fixed Node supervisor starts the fixed PowerShell holder with valid standard handles and captures startup errors. This supplies the independent process context inside MCP; an external diagnostic launcher is no longer required. The holder still verifies private-desktop and restricted-Job ownership before resuming Cubase.

`native/ProjectCreateLoader.cs` and `native/bridge/CubaseProjectCreate.cpp` target the inspected Cubase 16.0.5.174 build. They check the target/holder lifetime, executable, vtables, initial project state and event thread. A process-local one-shot message hook schedules the whitelisted operation on that event thread and is removed before execution. No host instruction patch, license change, foreground activation, keyboard/mouse input or dialog action is used. An operation image and its temporary path objects are retained until that owned process ends; no obsolete diagnostic driver is installed.

The create path constructs `PArrangement` directly, not by copying a CPR. Save/create bind the destination through the actual document path setter (`+0xd8`, build-specific target `0x1cfee50`) before the application save method (`+0x1c8`). The latter is then called with its current-path form. Passing only a third-argument path had written a file without binding the live document; that earlier prototype is not the final contract. Open uses the fixed host `IHostApplication2` path interface. Every successful operation must match the current root/document and requested path before reporting success.

A failure after path binding may leave a changed in-memory path or an incomplete file. The error is not an automatic rollback or permission to replay; the existing instance, result and admission records are retained. High-frequency native-operation image lifetime and arbitrary legacy/media-rich projects have not been load-tested.

The initializer returns before MIDI Remote necessarily activates. The helper therefore observes the installed controller's matching construction, activation and subsequent idle records before the server sends its **one** new-host handshake. It does not solve readiness by retrying MIDI messages. MIDI requests already in flight prevent a lifecycle transition; pending writes are not cancelled to make room.

`artifacts/runtime/cubase-launch.json` describes the original no-project launch, not the current project. `managed-project.json` records the correlated managed path and native result for that process lifetime. Both are local state, not a security boundary against a malicious same-user process. A result/metadata write or host interruption can leave an operation incomplete; consumed records, failed results and known file outcomes are retained. No automatic mutation replay or hidden rollback is performed.

## Build and limits

`npm run build:native` produces the fixed native DLL and loader in `artifacts/native-runtime`; `npm run build` builds the MCP server. These artifacts are already built on this host. MSVC and the .NET Framework compiler are build prerequisites, not alternate providers. Future task helpers and compilers inherit E-drive TEMP/TMP. Installation of the MIDI script itself still does not start Cubase.

This is a private-desktop GUI host, not a windowless Cubase engine. Job restrictions and code paths prohibit foreground operations; sampled foreground values are not a continuous global history. File/event/note, native MIDI/instrument/Group/FX/folder creation, plug-in unload, automation points and audio/send routing are implemented within their documented scope. Certified undo and other coverage families remain open.

## Live evidence

`artifacts/ipc/lifecycle30-bound-path-live.json` records one successful **real stdio MCP** sequence:

1. Native blank create + bound initial store: `New.cpr`, **67,595 bytes**, PID 27772.
2. Native save-as: `Version.cpr`, **68,380 bytes**, same process, document path verified.
3. Owned replacement and open: same `Version.cpr`, fresh PID **9348** / creation **134387351968202198**, no Save submitted during open.
4. MCP mapping ready and live discovery returned only `Stereo In` and `Stereo Out`, with no copied Piano track.

The saved paths are under `artifacts/managed-projects/正式生命周期 30/`. Stop/status were also observed through MCP; `lifecycle29-live.json` retains those results and its later failed launch publication. Earlier failures and partial results are preserved in `project-create-29.md`. The previous tempo-146.75 Save/reopen chain was **not** repeated.

The native/TypeScript builds and focused lifecycle routing/admission tests passed. Historical 109-test totals are not a new full-suite claim. This acceptance covers the tested blank CPR lifecycle, not every existing project's content or edition feature.

## Session 30: MIDI file import (operation 4)

The initializer gained one more whitelisted operation, used by `cubase_midi_import`. `Project-Runtime.ps1` action `import_midi` takes an existing local `.mid`/`.midi` file (22 bytes to 16 MiB, `MThd` header, no reparse point) and `confirmImport: true`, requires the owned managed project, and passes the file as the source path with the managed project path as the expected document.

On the event thread `importMidiFile` in `native/bridge/CubaseProjectCreate.cpp` repeats what the host does after a file was chosen in File > Import > MIDI File: it opens the file through the host file-system object, constructs the host MIDI file filter, sets the filter's merge flag so that the data is added to the open project, runs the filter against the active project root, releases the stream and the filter and lets the document refresh. Every object it calls is checked against the vtable addresses of the 16.0.5.174 image first; on a mismatch nothing is called. Success requires that the import returned true and that the document and its path are the ones that were current before. No file is selected by the host, no dialog is shown and no preference is changed, so the MIDI import preferences of the installation decide how tracks are created (see [song tools](song-tools-30.md)).

The operation does not touch `managed-project.json`, does not wait for a mapping activation and does not change the MIDI session. The result carries `importStage`, `openError`, `importStarted`, `importReturned` and `importValue` next to the existing native fields. A failure after the import started leaves whatever the host imported; it is reported, not rolled back and not repeated.

Live evidence: the import of a two-track file added `Synth: HSSE Main`, `MidiChannel: Piano` and `MidiChannel: Bass` without any new window, and the MIDI file that Cubase then wrote for the project contained exactly the imported notes, programs and controller event (`artifacts/managed-projects/session-30/midi-a`). The later acceptance run is recorded in `artifacts/ipc/song30-live-*.json`.

The owned launch needs a process context that permits `CREATE_BREAKAWAY_FROM_JOB`. Since session 34, the fixed WMI/Node supervisor supplies that context automatically. The final ordinary MCP client fresh reopen passed; the startup-recovery branch has isolated fixture coverage and was not fault-injected into a real license check during that run.
