# Session 20: Same-directory startup and MIDI model observation

Date: 2026-11-10.

## Request and boundary

Continue the complete Cubase MCP goal with one production MIDI transport, no foreground operations, replay or manual user steps. The user approved related isolated test operations and restart. Session 19's host-open submission remains `unknown`; it is not replayed.

## Work and evidence

- Preserved the owned `live-smoke` test directory, session 19 fixture and one-shot records before ending the previous isolated PID 50568 and holder. The moved-project dialog was not operated. The interrupted submission remains `unknown`.
- Copied a distinct 93,085-byte byte-identical fixture to `artifacts/live-smoke/Open SameDir 20.cpr`. This is a disk copy, not native project creation, a project edit or proof of persisted semantic content.
- Extended `scripts/Trace-MidiStartup.ps1` to require an explicit existing same-directory next CPR for prearmed mode, validate the previous launch and next receipt, and sample input-desktop, caller-foreground and visible private-window titles alongside bounded project/listener/tree state.
- Started new isolated PID 24036 through the no-inherited-handles detached holder PID 49588. The launch receipt reported both job flags and `Default` input desktop at its three samples. A private project window and an unlocked path/root candidate matched the distinct fixture (`artifacts/ipc/project-candidates-24036-edbb21fdb538471990fc85296ab46750.json`). They do not prove active selection or completion of a host-open or save.
- The prearmed 90-second timeline began 99.6 ms after process start and contained 388 samples: 29 pending and 359 observed, no sampled errors. First observed root preceded first observed informer by seven samples; all observed informer samples had a listener, zero project-tree count and absent root key. All input-desktop samples were `Default`, the caller-foreground PID was not the target, and no exact `Cubase AI` dialog title was sampled. The aggregate status is `pending` because of initial pending samples. Polling is not an exhaustive event history (`docs/midi-startup-timeline.md`).
- The current 3.6 script console logged construction, both OS ports listed PID 24036, but a later read-only registry/model snapshot found the two relevant informer counts and both HostEnvironment port collections empty despite four MCP-named MME socket entries (`docs/midi-host-environment.md`). These observations do not establish activation or its cause. No old status request was replayed.
- Prepared a separately named fixed one-shot diagnostic and copied another byte-identical CPR into the same directory. A query-only audit verified the current restricted holder job; a prearmed observer and admission contract preceded the sole host-open call. The worker returned 0 for submission only. A different private prompt then asked whether to activate a project; no choice was made, and the new open remains `unknown` (`docs/project-open-probe-20.md`). A later unlocked snapshot still found the startup candidate/root and empty informer counts. The pinned image and path remain in PID 24036; do not invoke the entry again.
- The 120-second observer recorded 548 samples, with the prompt title in 541 and no sampled target input desktop or target foreground PID. A bounded read-only window-controller inventory saw three entries, while fixed-image inspection located the prompt's translation-key reference but not its display or decision branch (`docs/project-window-controller-20.md`, `docs/project-activation-prompt-20.md`). None of these observations proves the new document's state.

## Verification and remaining work

PowerShell parser and C# compilation checks passed; a next-project path outside the prior project directory and a wrong fixed lifetime were rejected before admission. The real prearmed launch supplied a matching ticket and produced the bounded report above. MSVC `/Zs` and `/W4 /WX` diagnostic build, `npm run build` and `npm test` passed; the full suite contained **84/84** passing tests. The later read-only window-controller script separately passed its parser and one real snapshot. These checks do not establish a live handshake or completed project operation.

Project create/save/edit/reopen/render, current live MIDI handshake and complete Cubase coverage remain unimplemented or unverified. Future work must distinguish any new submission from the old unknown outcome and independently verify semantic content and durable persistence.
