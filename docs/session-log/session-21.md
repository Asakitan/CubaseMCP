# Session 21: Plug-in parameter banks and activation context

Date: 2026-11-10.

## Request and boundary

Continue the full Cubase MCP objective with one MIDI transport, no foreground operations, automatic replay or manual user steps. The prior two project-open submissions remain `unknown`; the private activation prompt was not operated.

## Work and evidence

- Added selected-channel instrument and eight mixer-bank channels' instrument and five strip-effect parameter banks, each with eight values and fixed previous/next/reset actions. New writes require the current session, relevant observed channel identity and the exact untruncated single-control plug-in identity. Navigation and identity changes invalidate relevant observations; callbacks are not atomic instance proofs (`docs/midi-plugin-banks-3.7.md`).
- Updated the MCP schema and strict revision gate to `2026-11-10-coverage-3.7`. The previous four installed scripts were backed up before deploying the new controller; only `controller.js` changed. A later malformed-callback invalidation fix was tested, the intermediate files were backed up and the final controller deployed (`artifacts/runtime/deploy-coverage-3.7-final-a484ea472be94129bfa9e13008838945.json`). The existing process was not restarted; its final console snapshot still contained only 3.6 construction (`artifacts/ipc/midi-script-after-final-3.7-24036.json`). No status request was replayed.
- An external fixed Windows PSS diagnostic checked PID, thread creation time, executable profile and private-window baseline, then captured one thread context. The selected thread's RIP mapped to the `win32u.dll` `NtUserGetMessage` stub. A later bounded read produced two candidate return addresses, but the earlier context and later stack reads were not synchronized and the full-buffer stability result was lost to output truncation. Neither establishes an activation-dialog call chain, and the API does not promise zero transient scheduling impact (`docs/project-activation-stack-21.md`).

## Verification

ES5 parsing, PowerShell parsing and TypeScript `--noEmit` passed. Five focused plug-in-bank tests passed. The TypeScript build passed; the first full test run exposed one obsolete fixed control-count assertion, which was updated from 124 to 135. After the malformed-callback invalidation edit, the full suite again passed **89/89** with no skips. The fixed PSS diagnostic passed MSVC `/Zs` and `/W4 /WX` build and returned a captured context in the isolated process. Fixture and context evidence do not establish a live 3.7 mapping or project lifecycle completion.

## Remaining

Establish a background project-activation/open/save/edit/reopen contract with independent semantic and persistence evidence, activate and verify the current MIDI mapping, and implement the remaining Cubase feature families without foreground input or replay.
