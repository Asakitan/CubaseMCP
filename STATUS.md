# Cubase AI 16 MCP

Version: 0.1.0. **Full Cubase coverage is still incomplete.** The built server exposes **30 tools**. The normal MIDI controller is `2026-11-10-coverage-3.13`; fixed native lifecycle operations now support owned background create/open/save-as/stop. They are explicit operations, not a fallback.

## Current increment: session 29

- **Real MCP lifecycle passed:** created a native blank `New.cpr` (**67,595 bytes**), bound the document path, saved as `Version.cpr` (**68,380 bytes**), then replaced the owned process and opened that file through MCP. The new mapping connected and discovery showed only Stereo In/Out. No template was copied. Evidence: `artifacts/ipc/lifecycle30-bound-path-live.json` and [lifecycle contract](docs/background-project-lifecycle.md).
- Added `cubase_runtime_status`, `cubase_project_create`, `cubase_project_open`, `cubase_project_save_as` and `cubase_runtime_stop`. Replacement/stop require explicit discard confirmation. Other processes are not adopted or terminated.
- Native calls run on the verified event thread, with exact owned process/holder/Job checks and one-shot admission. The implementation binds the document's path before saving; a file-only prototype result is not treated as the final contract.
- Startup waits for observed controller activation and subsequent idle before sending one MIDI handshake. An earlier handshake timeout remains recorded, not replayed. All task temporary files and helpers use E-drive scratch.
- Current owned target: **9348 / 134387351968202198**, holder **59332 / 134387351958862499**, private desktop `winsta0\CubaseAI_MCP`. The managed project is `artifacts/managed-projects/正式生命周期 30/Version.cpr`. Read the actual receipt and managed manifest before later process actions.
- Six prototype source/scripts were archived to `artifacts/research/session-29-prototype`; old prototype processes ended. Normal 3.13 controller deployment was retained. The previous 12-file / 3,937,635-byte C cleanup remains recorded; no matching new Cubase temporary/crash files were found in the inspected C Temp and Steinberg CrashDumps locations.

## Coverage and remaining work

| Family | Current state |
| --- | --- |
| Owned background lifecycle | Basic create/open/save-as/status/explicit-discard stop observed through real MCP on a blank CPR; other project formats, overwrite/merge/collect and arbitrary error branches are not certified |
| Current-project Save/tempo persistence | Earlier separate real MIDI tempo 134→146.75, Save and fresh-reopen content chain passed; not repeated in session 29 |
| DirectAccess parameter/edit-lock operations | Earlier individual real-host round trips observed |
| Mixer/transport/plug-in control bindings | Implemented declaration-backed portions; not blanket host certification; earlier two control-volume writes still unconfirmed |
| Track structure CRUD | Still incomplete |
| MIDI and audio event CRUD | Still incomplete |
| Automation nodes/curves/ranges, full routing, plug-in presets/state | Still incomplete |
| Exports/render and score/chord/arranger/media/video/sync | Still incomplete |

The [eleven-family matrix](docs/feature-coverage-29.md) separates implementation from real-host evidence. Native lifecycle success does not certify those other feature families or all edition capabilities.

## Necessary validation

Native and TypeScript builds passed. Only the changed lifecycle/MIDI-admission contracts and new live operations were checked. No unchanged full suite or original Save chain was repeated; **109/109** remains a historical 3.9 result. Details and corrections are in [session 29](docs/session-log/session-29.md); [session 28](docs/session-log/session-28.md) retains the earlier Save evidence.

## Next priorities

Implement actual track structure and event editing using validated host contracts, then routing/automation/plugin-state/render families. Preserve all old unknown outcomes, admission records and project files; do not relabel stubs, templates or source-only handlers as complete functionality. Core work stays with the main worker; the user permits GPT-6-luna only for simple tasks. Keep new scratch on E and avoid redundant verification.
