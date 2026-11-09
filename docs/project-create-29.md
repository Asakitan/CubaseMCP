# Project lifecycle recovery: session 29

## Native contract recovered

The installed 16.0.5.174 build (PE timestamp `0x6adf121b`) supplies these build-specific paths:

- `0x1d50920(application, directory-FNPath, 1, 0)` constructs a blank `PArrangement`; its primary table is `0x42d96c0` and `+0x108` leads to its root.
- Application `+0x1c0` obtains the current document; the current root/document back-reference is checked.
- Document `+0xe0` (`0x15f5de0`) reads its path at `+0x30`. Document `+0xd8` (`0x1cfee50`) calls the reference-retaining base setter `0x1dc42e0` and updates dependent model state.
- The native Save dispatcher at `0x36cc8b6` binds that path through `+0xd8`, then calls application `+0x1c8` (`0x1d57900`) with a null third argument. The production initializer follows this sequence.
- The host `IHostApplication2` path method is still the checked `0x3751d40`; the production first-open operation supplies the file and directory path interfaces on the event thread.

These are local reverse-engineered contracts, not a portable vendor SDK. The initializer validates the fixed build, vtables, owned lifetimes, restricted Job and current project state. No instructions, license state, foreground focus, keyboard/mouse or dialogs are modified. `background-project-lifecycle.md` defines the formal MCP surface and limits.

## Necessary experiments and preserved corrections

1. The first owned empty lifetime was PID 43820 / `134387343536752542`. The initial observer referenced an old launch-receipt filename and failed **before native module admission**. Its corrected observer was separately armed. The first native attempt then reported `operation/createStarted=false`, `saveStarted=false`; no project constructor was entered. Its directory-path check expected a trailing separator that the host removes before splitting FNPath.
2. The corrected fixed prototype in PID 63276 / `134387344693466610` returned from blank creation and initial storage; it generated a new **67,419-byte** CPR, not a copied template. A subsequent read-only MCP connection observed tempo 120, only Stereo In/Out and no selected user track. This was a prototype result, not yet the final bound-document contract.
3. The first formal MCP attempt created empty PID 23960 but failed atomic receipt publication because PowerShell bound a null backup path incorrectly. No native creation was submitted. The owned receipt was repaired from its matching unique launch record and the empty process was explicitly cleaned up; the result was not changed to success.
4. A later formal attempt in PID 69028 created and wrote a CPR, but its immediate MIDI handshake timed out. A read-only console observation subsequently found activation/idle; an explicit new connection request succeeded. The production coordinator now observes that readiness **before** its one handshake, not by replaying a timed-out request.
5. A formal create/connect result in PID 49248 generated **67,434 bytes**. A subsequent guarded save-as stopped before mutation because its expected document path did not match. A bounded read established that the document path was null. Thus writing a supplied path had produced a file without binding the current document; that intermediate result is not the final project identity contract.
6. After recovering and applying the native document path setter, the final real MCP sequence created a bound **67,595-byte** `New.cpr`, saved as **68,380-byte** `Version.cpr`, and opened it in a fresh process. All three tools succeeded, with the expected live path and mapping. This is the accepted lifecycle increment.

No old unknown submission was silently repeated. Pre-call rejections, the failed publication, the timed-out handshake and the intermediate unbound document remain separate records. The original tempo-146.75 Save/reopen chain was not rerun.

## Evidence and cleanup

Final acceptance: `artifacts/ipc/lifecycle30-bound-path-live.json`. Current open lifetime: PID 9348 / `134387351968202198`, holder 59332 / `134387351958862499`. The final path is `artifacts/managed-projects/正式生命周期 30/Version.cpr`.

Earlier records: `create29-entry-result.json`, `create29b-run.json`, `created29-mcp-read.json`, `lifecycle29-live.json`, `lifecycle29-live-fixed.json`, `lifecycle29-final-create.json`, `lifecycle29-open-saveas-live.json` under `artifacts/ipc`. Exact per-operation request, native result and readiness files remain in the corresponding `artifacts/project-create-*` directories.

Six one-off prototype source/scripts and their support header were archived under `artifacts/research/session-29-prototype`, with `archive.json`. They are not production tools or selectable runtime providers. Their old owned processes have ended; the production initializer uses the normal 3.13 MIDI controller.

## Still open

The accepted result covers a blank-project lifecycle and an existing CPR produced by it. It does not certify arbitrary legacy projects, media relocation, overwrite/merge/collect, track/event CRUD, all error branches, or every edition feature. The eleven requested families remain tracked separately in `feature-coverage-29.md`.
