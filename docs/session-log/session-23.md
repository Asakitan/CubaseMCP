# Session 23: Project options and synthetic stack validation

Date: 2026-11-10.

## Request and boundary

Continue the full Cubase MCP goal with one MIDI backend, no foreground input, automatic replay or manual user steps. Both earlier project-open submissions remain `unknown`; the private activation prompt was not operated.

## Work and evidence

- Traced eight direct calls to the fixed-build open routine and identified a conditional forwarded-byte path which can skip one activation-prompt consumer. The necessary entry, thread, full prompt behavior and completion are not established (`docs/project-open-options-23.md`).
- Traced the successful DAWproject `Transport/Tempo/value` parser-to-object-to-importer path and verified the fixed image's literals, vtables, leaf bytes and constants with `scripts/project-tempo-source-23-inspect.py`. Unit handling and live project values remain unverified (`docs/project-tempo-source-23.md`).
- Revised the synthetic-only PSS clone experiment for the observed initial-frame echo and added a separate single-run supervisor. One revised run recognized three known function frames in order, observed successful marker/snapshot free and monitor close, then observed the recorded clone PID absent in one post-worker inventory. This does not prove total resource reclamation or a Cubase stack (`docs/project-activation-clone-22.md`).
- A separate synthetic Job run used UI limit 64 and limit flag 8192; both its child and VA clone were observed in the Job. The named-frame walk and cleanup returned success, and a later single inventory missed the clone. Job closure can affect its members, so this is not proof of PSS-only destruction or of identical behavior in Cubase's full Job tree (`docs/project-activation-clone-22.md`).
- Built and executed one fixed-identity target PSS diagnostic. Capture returned status 0 in 48.587 ms, emitted 30 accepted module-relative frames and stopped at read failure; eight call predecessors were independently verified from the installed PE. The partial sequence supports the posted OpenFile-to-activation-consumer path, not its dynamic arguments, a prompt choice, completed open or persistence. Snapshot/marker and process/thread handle cleanup were reported (`docs/project-activation-stack-23.md`).
- The original wrapper reported a blank worker exit code yet exited zero, so the real worker's exit status remains unknown. The wrapper was corrected to retain a process handle and reject a missing exit code; an independent synthetic child returned 7 as expected, and a separate synthetic file-redirection test preserved output after launcher exit. No second target capture was made (`docs/project-activation-clone-23-target.md`).

## Verification

PowerShell parsing, TypeScript `--noEmit` and build, the full **91/91** Node suite, MSVC `/Zs` and `/W4 /WX` diagnostic builds, supervised synthetic runs, and fixed-profile DAWproject and stack-call static inspections passed. The target walk was partial and its old wrapper's exit status was lost. Fixture tests are not live 3.8 control or lifecycle proof. No Cubase project command or prompt input was sent in this session.

## Remaining

Establish and verify a noninteractive project lifecycle and active MIDI mapping, then implement and live-verify project editing, persistence, rendering and the remaining Cubase feature families.
