# Session 16: Project candidate and calling-thread evidence

Date: 2026-11-10.

## Request

Continue the complete background-only Cubase MCP goal, including project creation, saving and editing, without automatic replay or manual user operations. The goal remains active and incomplete.

## Evidence

The isolated test host had constructed controller 3.5, but its previous no-write status request timed out. A prior temporary path-object setter succeeded; it did not open, create or save a project. Host-open delivery, prompt behavior and completion remained unknown.

## Work

- Added a process-identity-checked, bounded read-only project-candidate observer and a disk-only fixed-profile inspector of candidate RTTI and root-constructor provenance. In isolated PID 39068 one candidate's path fields matched the test CPR and its root field equalled the sampled global root. The unlocked candidate is not proof of active selection, a completed open or persistence.
- Traced the host-open branch predicate to a calling-thread-ID comparison and sampled the event-handler backing ID. Also traced conditional path cloning, action properties and posted-message receiver storage. Static application and queue paths still do not establish complete ownership, actual delivery, consumer thread, prompt behavior or correlated completion.
- Traced a scanner filter's nonempty-output return and a conditional request-object submission route; neither proves MIDI transmission or mapping activation. Further narrowed a save path's volume predicate without establishing a prompt-free save.
- No host project method, MIDI transmission, foreground action or user input was requested in this session. Foreground was not continuously monitored.

## Verification

- The candidate observer successfully sampled PID 39068 once with a stable bounded reread; its report is `artifacts/ipc/project-candidates-39068-bcacc724f9bf4310a814225be27f046d.json`. A separate missing-receipt check created an error report in a fresh ignored directory and exited with an error. The constructor provenance, open-thread and ownership, save-predicate and five scanner inspection selections passed fixed-profile focused checks under `artifacts/research/session-16/`. Both PowerShell observers passed parser checks, and their embedded C# compiled separately without calling the host.
- The thread snapshot and private-window record are `artifacts/ipc/project-open-16-snapshot-39068.json` and `artifacts/ipc/project-open-16-window-39068.json`; they are separate unlocked observations.
- `npm run build` passed and `npm test` passed **77/77**, with no skipped tests. Fixture results do not prove current host activation or lifecycle operations.

## Remaining

Establish MIDI Remote mapping activation and current handshake. Establish host-owned dispatch and object lifetimes, noninteractive project open/create/save/edit/reopen, exact error and completion contracts and durable verification. Complete remaining Cubase feature families against actual host behavior.
