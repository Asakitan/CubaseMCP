# Session 27: restore mapping and investigate Save

Date: 2026-11-10.

## Request

Continue the full background-only Cubase MCP goal. The user instructed that only necessary checks be run and that subsequent work be done without subagents.

## Work and evidence

- Added revision 3.9 identity-guarded selected-track and mixer-bank insert-viewer value and parameter writes. The 3.9 build and complete Node suite passed 109/109. Live viewer writes were not verified.
- Implemented a fixed owned-process restart and first-open diagnostic. The first fresh PID 63660 failed a read-only preflight while the informer was still initializing, before module load or host submission; its lifetime admission remains consumed. A subsequent distinct PID 28428 submitted one fixed first-open request, after which its root/tree and 3.9 mapping were observed; a real MCP handshake succeeded (`docs/first-open-27.md`).
- Added revision 3.10 fixed `project.save` to the existing MIDI command allowlist; the TypeScript build and three focused command/ES5 checks passed. It has no path or completion callback and may require input. A separate fresh PID 69032 opened the other fixed fixture and loaded 3.10.
- In PID 69032, one distinct Stereo Out DirectAccess parameter write was read back at 0.625. A single current-project Save command was submitted, but the fixture did not change in the following 12 seconds. An independent observer recorded 487 samples, 63 during the edit/save window, without an identified save prompt or sampled background violation; polling can miss brief events. Persistence and the command's host-side effect remain unverified (`docs/project-save-27.md`). Neither operation was replayed.
- Extended static creation tracing to a retained provider object; the template, path, thread and completion contract remains unresolved (`docs/project-create-27.md`).

## Remaining

Find why the fixed command did not yield observed persistence, verify the actual save target and semantic reopen, implement unattended project creation and editing, and complete remaining Cubase feature coverage. The user wants no front-end or manual operation and no fallback; preserve all consumed admissions and unknown outcomes.
