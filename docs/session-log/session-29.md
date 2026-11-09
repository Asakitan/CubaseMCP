# Session 29: native managed lifecycle

Date: 2026-11-10.

## Request

Continue the eleven remaining feature families, entirely in the background, without fallback or manual operation. Do not repeat the accepted Save chain. Use only necessary checks and E-drive temporary files. The user later permitted GPT-6-luna for simple work; one narrowly scoped read-only inventory task produced `docs/feature-coverage-29.md`, reviewed by the main worker. Core implementation and verification stayed with the main worker.

## Delivered increment

- Recovered the event-thread blank-project constructor, live document path setter and application save method without changing host instructions or licensing.
- Added five formal MCP lifecycle tools: owned status, real blank create, existing CPR open, named save-as and explicit-discard owned stop. Total MCP tools: **30**. Native lifecycle operations are explicit primary operations; parameter/control traffic remains one MIDI connection.
- Added process/holder/Job validation, per-operation admission, request/response artifacts, current managed path correlation, E-drive scratch and mapping-readiness observation before the single MIDI handshake.
- Discovered that a direct save with a path argument wrote a file while leaving the document path null. The final implementation follows the native dispatcher: bind the document path first, then save its current path. Postconditions compare root, document and path.
- Real MCP created a blank `New.cpr` (67,595 bytes), saved as `Version.cpr` (68,380 bytes), replaced the owned host and opened that file in PID 9348. The new mapping connected and showed only Stereo In/Out. Evidence: `artifacts/ipc/lifecycle30-bound-path-live.json`.
- Archived six one-off prototype source/scripts to `artifacts/research/session-29-prototype`. Previous test processes, their hooks and prototype modules ended with their owned holders; the active instance uses the production initializer and normal 3.13 MIDI script. No new matching Cubase temp/crash files were found in the two inspected C locations. Earlier C cleanup remains 12 files / 3,937,635 bytes; new scratch stayed on E.

## Necessary validation and corrections

Native and TypeScript builds passed. Two focused lifecycle/MIDI admission checks, the expanded lifecycle routing check, and direct real-MCP lifecycle acceptance were used; the unchanged full suite and original 146.75 Save chain were not rerun.

Corrections followed observed failures: an observer receipt filename mismatch occurred before module load; directory trailing-separator normalization rejected the first constructor attempt before a host create; PowerShell's null backup-path binding broke metadata publication after an empty launch; and an early MIDI handshake timed out before readiness was observed. The path-binding omission was then caught before Save-as submission. Their records were preserved, not converted to success or replayed silently. See `project-create-29.md` and `background-project-lifecycle.md`.

## Still incomplete

Track structure CRUD, MIDI/audio event CRUD, complete timeline/route automation, plugin/preset/state lifecycle, export/render and wider score/chord/arranger/media/video/sync coverage remain incomplete. The eleven-family matrix is a scoped coordination artifact, not certification of all Cubase functions. Current source and real-host evidence are explicitly separated.
