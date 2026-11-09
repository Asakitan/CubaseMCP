# Session 28: real MCP Save and semantic fresh reopen

Date: 2026-11-10.

## Request

Prioritize actual disk Save and retained contents after fresh reopen, then project creation/editing. Work directly without subagents, only necessary tests, no foreground/fallback/manual operations, and clean task-created C temporary files.

## Work and evidence

- Preserved all earlier unknown requests and admissions. Distinct short and held physical-input experiments on the large mapping did not establish a Save. A minimal fixed one-button controller subsequently saved tempo 137.5 and read it after a fresh reopen; this was diagnostic, not the production acceptance.
- Implemented the production prepared Save protocol in `src/midi.ts` and `remote/controller.js`, routed by the existing `cubase_command_execute` tool. It uses the same MIDI connection, a minimal internal page, deadline/token, one press, binding observation, one release and return with a new primary session. No automatic retry or alternate runtime was added.
- The distinct production 3.11 large-page experiment timed out after one press and remains unknown; it was not repeated. The 3.12 minimal-page production MCP experiment changed tempo 134 to 146.75, observed the edit, submitted Save once and observed the CPR change from 93,085 to 93,730 bytes.
- The first read-only fresh reopen loaded the page serialized during Save and returned `SAVE_PAGE_BUSY`, before any mutation. Revision 3.13 returns an unarmed saved internal page to the primary page without Save input. A separate read-only fresh reopen through real stdio MCP observed **146.75** and the saved bytes. Exact ledgers and limits: `docs/project-save-chain-28.md`.
- Added `cubase_project_save`, a 25th tool that preflights a caller-confirmed existing CPR before one MIDI Save and samples changed/stable bytes afterward. Its changed/unchanged/preflight-failure paths passed one focused in-memory MCP test; this wrapper was not separately live-certified and does not select a destination or verify semantic reopen.
- Final owned host: PID 69368 / creation `134387330697650771`; holder 62876 / `134387330688889536`; restricted private desktop. The final passive observer completed 356 samples without a sampled background violation. The writer observer's 49 samples ended with a desktop-inspection error when its lifetime ended; no full writer-observer success is claimed.
- Added E-drive process-scoped temporary-directory setup to owned-launch/diagnostic wrappers. Moved 12 identified task diagnostic/setup-log/crash files from C to E, **3,937,635 bytes**, retaining a manifest and leaving unrelated live-application files and installed dependencies intact: `artifacts/c-temp-cleanup-d91e4257c91242b19be1cd9f244676b3/manifest.json`.
- Inspected installed project templates and the candidate native constructor/provider flow without a creation call. No blank-project creation, template-derived MCP create API or general event-editing success is claimed.

## Necessary validation

3.12 build and seven focused Save/MIDI/MCP checks passed; 3.13 build and three focused saved-page/initial-tempo/command checks passed. The real MCP save/fresh-reopen chain then passed. The unchanged full suite was not repeated; the 109/109 suite remains a 3.9 historical result. The final server build and two focused new-tool/session-gate checks passed (`artifacts/ipc/save-observer-build.log`, `save-observer-focused.log`). No subagent was dispatched.

## Remaining

Parameterized background create/open/save-as and actual track/note/audio-event editing remain open, followed by rendering and other Cubase features. The proven persistence chain is one existing owned CPR and a tempo edit, not the whole original goal. Keep every unknown outcome/admission and verify current process lifetimes before later operations.
