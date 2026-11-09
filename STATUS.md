# Cubase AI 16 MCP

Version: 0.1.0. **The complete Cubase coverage goal remains incomplete.** The server exposes 25 tools through one background MIDI Remote connection. Current controller revision: **2026-11-10-coverage-3.13**, installed and observed in owned isolated PID 69368. General project creation/open/save-as, track/event editing and parameterized rendering remain open.

## Current increment: session 28

- **Real MCP persistence chain passed:** tempo 134 → **146.75**, one fixed Save input, CPR **93,085 → 93,730 bytes**, then a fresh process read **146.75** through MCP with matching saved bytes. This validates one owned fixture and one semantic edit, not arbitrary project persistence or full feature coverage. See [Save evidence](docs/project-save-chain-28.md).
- Save now uses a dedicated minimal mapping page, prepared session/token/deadline, one Note On, binding observation, one Note Off and return to the primary page. The result contains a **new session**; rediscover objects afterward. A timeout after input remains unknown and is never replayed.
- Revision 3.13 returns from an unarmed saved internal Save page on startup without Save input. Initial tempo callbacks are retained only for a matching device and mapping.
- All launches stayed on `winsta0\CubaseAI_MCP` in the restricted owned Job; no foreground input or dialog action was issued. The final reopen observer completed 356 samples without a sampled violation. The writer observer recorded 49 samples before reporting a desktop-inspection error when the lifetime ended; it is not a complete observer success.
- Current runtime receipt: `artifacts/runtime/cubase-launch.json`; target PID **69368** / creation FILETIME **134387330697650771**; holder **62876** / **134387330688889536**. Stored IDs are historical: verify the receipt before any future process action.
- Added `cubase_project_save`, the 25th tool: one MIDI Save plus changed/stable byte observation at a caller-confirmed existing CPR path, not path selection or semantic reopen. Its in-memory MCP contract check passed; its wrapper has not been separately live-certified. See [tool contract](docs/project-save-tool.md).
- C-drive cleanup archived **12 task-owned temporary/crash files / 3,937,635 bytes** to E and removed their C copies. `Use-WorkspaceTemp.ps1` directs new task helper/compile/owned-launch temporary files to `artifacts/scratch-temp`. Unrelated live-application files, installed dependencies and an installer without proven task provenance were preserved. Manifest: `artifacts/c-temp-cleanup-d91e4257c91242b19be1cd9f244676b3/manifest.json`.

## Implementation status

| Area | Status |
| --- | --- |
| MCP schema, revision/session gates, exact MIDI ports and fault latch | Implemented; 25 tools; no alternate runtime or replay |
| DirectAccess discovery and parameter/edit-lock writes | Individual real-host round trips observed in earlier sessions |
| Tempo edit and current-project Save/reopen | Real MCP chain observed in session 28, for the named owned CPR |
| Selected/bank mixer, EQ, sends, plug-in/insert banks and controls | Declaration-backed implementation; not blanket live certification; two earlier control-volume submissions remain unconfirmed |
| General project creation/open/close and named save-as | Incomplete; fixed first-open helper is diagnostic only |
| Track creation/deletion/reorder, note/audio event editing | Incomplete |
| Parameterized audio export/stems/offline render and remaining feature families | Incomplete |

## Validation

3.12 build and seven focused Save/MIDI/MCP checks passed. 3.13 build and three focused saved-page/tempo/command checks passed, followed by the successful real MCP read-only reopen. The final server build and two focused new-tool/session-gate checks also passed (`save-observer-build.log`, `save-observer-focused.log`). No unchanged full suite was repeated; **109/109** is the historical 3.9 result. Receipts report submission, not a universal save-completion callback.

## Next work and preserved uncertainty

1. Establish parameterized unattended creation and destination/save-as, without presenting a copied seed as a blank new project or promoting an unverified native entry to production.
2. Add actual track/event editing, then remaining Cubase feature families; use only the cheapest necessary validation and no subagents.
3. Keep existing unknown admissions, request records and backups. Earlier session-19/20 opens, session-24/25 control writes, session-26 status/notification and session-27 Save remain unknown/unconfirmed; the later distinct Save success does not resolve them.

Historical investigations and exact evidence remain under [session logs](docs/session-log/README.md). Recent history: [27](docs/session-log/session-27.md), [28](docs/session-log/session-28.md); [first-open boundary](docs/first-open-27.md), [coverage audit](docs/midi-coverage-audit.md).
