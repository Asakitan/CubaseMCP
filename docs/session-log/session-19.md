# Session 19: One-shot project open and working-directory prompt

Date: 2026-11-10.

## Request

Continue the complete background-only Cubase MCP goal, including project creation, saving and editing, without fallback, replay or manual user steps. The goal remains active and incomplete.

## Evidence

PID 50568 was the owned isolated Cubase process under the desktop-restricted job. Its controller 3.6 had constructed, but a prior no-write status request timed out. Host-open ABI, queue delivery, path ownership and completion were not established.

## Work

- Created a disposable byte-identical copy of the owned test CPR under `artifacts/project-open-probe`, without claiming this was a Cubase project creation.
- Built a fixed PID/build/path one-shot diagnostic with independent live job audit and a prearmed, bounded read-only observer. Submitted the host-open call once; the worker returned 0, which denotes only the observed immediate result.
- A new private `Cubase AI` window appeared. A read-only private-desktop capture showed the moved-project working-directory prompt; no dialog control or input was used. Before and after candidate snapshots showed the same original CPR candidate and sampled root. Open completion is `unknown` and the request was not replayed.
- Traced the fixed-build prompt, path comparison and application-open argument branches. Cleartext old-directory fields were observed in the fixture, but their full semantics and CPR format remain unproved.

## Verification

- The job audit observed one matching target job with UI flag `0x40` and limit flag `0x2000`. The observer recorded 546 samples, none with the target input desktop or target foreground PID, and 521 with the visible private dialog. Polling and cross-desktop foreground limitations prevent an exhaustive no-foreground claim.
- The diagnostic passed MSVC `/Zs` and `/W4 /WX` after the missing `user32.lib` link dependency was added; its AMD64 image exported only the fixed entry. C# compilation, fixed-lifetime rejection and stopped-observer rejection passed before the one-shot submission. The fixed-build moved-prompt static inspector passed.
- PowerShell parser checks and Python compilation passed; `npm run build` and the full `npm test` suite passed **84/84** without skips. These tests do not establish a successful live project open or persistence.
- Evidence and the exact one-shot boundaries are in `docs/project-open-probe-19.md`, `docs/project-open-observer-19.md` and `docs/project-moved-prompt-19.md`. No native project creation, save, edit or persistence was verified.

## Remaining

Establish a genuinely noninteractive project lifecycle route and independent completion/persistence evidence, resolve MIDI mapping activation, and complete the remaining Cubase features. Do not replay the current unknown open request or operate its dialog.
