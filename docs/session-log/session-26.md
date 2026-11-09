# Session 26: Binding experiment preparation and port lifecycle

Date: 2026-11-10.

## Request

Continue the complete background-only Cubase MCP goal without replaying unknown requests or using a second production backend.

## Evidence

- Diagnostic port run `a0c1082f4aa5f6fde82241b4dbe0a7e0` became ready but held its caller's capture pipe until a separately invoked exact-run stop; no host request was sent. A revised no-inherited-handle run `f153fadfe2298de2065ccdd9e9f6a44d` returned in 0.885 seconds and observed both temporary ports before stopping them.
- Following the second run, one MCP status request timed out with `execution: unknown` and was not repeated. A read-only console snapshot recorded device deactivation; a later snapshot contained no new activation. The OS production names and PID client relationships remained observed, not proof of an active mapping (`docs/binding-test-ports-26.md`).
- The new no-Cubase port-start guard rejected an invocation while PID 72128 was live without creating diagnostic ports (`artifacts/ipc/binding26-ports-guard-8c7393af620387ea33f5ad0b64b0623e.json`). Its process check is not atomic with third-party starts.
- One fixed device-change notification reached the target listener; a subsequent console snapshot had no later activation. A prearmed passive observer recorded 259 samples with input desktop `Default` and a stable sampled foreground handle/PID; transient changes may be missed. Mapping restoration remains unverified and the notification and status request were not replayed (`docs/binding-test-ports-26.md`).
- Two disposable fixture copies were created and compared bytewise. A trace-arm smoke prepared a non-admitting default-mode plan with no launch ticket or new target (`docs/binding-fixtures-26.md`).
- Read-only process identity sampled the current target's exact no-project-argument command line and parent, and a separate Job audit found one matching restricted Job (`docs/first-open-26.md`). Neither is a fresh-run first-open admission.
- Static Hub wrapper analysis found byte-dependent callback branches but no established template, path, ownership or completion contract (`docs/project-create-26.md`).

## Work

- Prepared a separate fixed MIDI controller for default versus explicit Jump takeover experiments, with distinct target values, exact identity/tag checks, request deadlines and in-memory one-shot guards. It was not installed or run against Cubase (`docs/binding-ab-26.md`).
- Added a diagnostic port host using the existing virtualMIDI class and no-inherited-handle launcher. Its later guard defers port cleanup while a Cubase process is observed; the positive guarded lifecycle still needs verification in a separate no-Cubase window.
- Added fixed fixture and plan preparation, a guarded unbuildable first-open source draft, a non-admitting plan validator, and bounded Job and process-identity helpers. They do not load a diagnostic or call the host.

## Verification

- PowerShell parsing and Node/Python syntax checks passed across the new scope. The first-open template, plan rejection, Job rejection and process-identity tests passed under Windows PowerShell and PowerShell 7; the identity test included an independent hidden child. The static creation inspector ran successfully. `npm run build` and the complete `npm test` suite passed, **109/109**; the A/B controller and client contribute eight offline tests each. The port-holder's guarded positive lifecycle remains untested.

## Remaining

Restore the current production mapping using an explicitly reviewed owned-instance lifecycle, not by replaying the timed-out request. Implement and review a fresh-run first-project orchestrator and durable external experiment admission before executing A/B. Recover real project creation, safe save target, completion and persistence; full Cubase feature coverage remains incomplete.
