# Session 22: Edit locks and project-root candidates

Date: 2026-11-10.

## Request and boundary

Continue the full Cubase MCP goal with one MIDI transport, no foreground input, automatic replay or manual user steps. The two prior project-open submissions remain `unknown`; the private activation prompt was not operated.

## Work and evidence

- Added `cubase_parameter_edit_lock_set` using the declared DirectAccess getter and setter. It requires a current session, observed root/object/tag and matching Boolean `expectedLocked`; one setter call reports submission, not completion. Invalidated observations and an exception after setter entry have separate outcomes (`docs/midi-parameter-lock-3.8.md`).
- Built and installed revision 3.8 after backing up the previous four driver files. Only the controller file changed (`artifacts/runtime/deploy-coverage-3.8-618131d9668147e4a3361cfb83b38284.json`). Existing PID 24036 was not restarted and still logged only 3.6 construction (`artifacts/ipc/midi-script-after-deploy-3.8-24036.json`). No prior MIDI status was replayed.
- Traced a fixed-image consumer of the activation prompt key and its conditional branch. Post-prompt snapshots recorded application fields and a two-entry MProject list; a bounded root-to-document traversal correlated the non-global root with `Open SameDir Probe 20.cpr` and the global root with `Open SameDir 20.cpr`. These are unlocked candidate path observations, not completion, semantic-content or persistence proof (`docs/project-activation-static-22.md`, `docs/project-activation-predicates-22.md`, `docs/project-root-documents-22.md`).
- Independently checked a static cross-module trace from a DAWproject source getter through double-to-float conversion to an `MTempoTrackEvent` field. The source getter's meaning and units are still unknown; no actual BPM or project value is asserted (`docs/project-tempo-field-22.md`).
- Built and ran one synthetic-only PSS clone/unwind experiment. It exited 1 because the stack-progress check failed and clone-monitor wait timed out, despite successful snapshot-free return. A later name inventory found no synthetic process; the cause remains unresolved. No Cubase clone or UI action was performed (`docs/project-activation-clone-22.md`).

## Verification

PowerShell and ES5 syntax checks, TypeScript `--noEmit` and build passed. Two focused parameter-lock tests and the full **91/91** suite passed. The synthetic diagnostic passed MSVC `/Zs` and `/W4 /WX` build but its single synthetic execution failed as described above. Runtime candidate readers produced bounded, non-atomic post-prompt observations; they do not verify live 3.8 control or a completed project lifecycle.

## Remaining

Establish a noninteractive project-activation/open/save/edit/reopen contract with independent semantic and persistence evidence, activate and verify the current MIDI mapping, and implement remaining Cubase feature families without foreground input or replay.
