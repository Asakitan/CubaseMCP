# Session 03: Coverage Upgrade

Date: 2026-11-10 (local clock).

## Request

Extend Cubase AI 16 coverage while preserving the single background MIDI Remote backend and no-fallback policy.

## Work

- Expanded the server to 23 tools with single-parameter and control queries, selected-track identity and navigation, mixer-channel location, transport feedback and host capability limits.
- Added selected-track EQ, pre-filter, send, cue-send, instrument, automation and read-only meter bindings. Slot counts come from the host; unavailable branches report errors.
- Bound track feedback to the current identity, invalidated prior-track observations on a change and added an optional expected identity for writes.
- Added an active-controller revision and session check before expanded operations and guarded writes. Old controllers return `BRIDGE_UPGRADE_REQUIRED` before dispatch.
- Backed up the previously installed controller at `artifacts/runtime/controller-before-coverage-20261110.js` and installed the updated project controller. The other three driver files were unchanged.
- Updated the live verifier to require the new revision, guard both test writes by track identity and write a separate coverage report.

## Verification

- `npm run build` passed; `npm test` passed 52/52, including 33 production-controller fixture tests and the real stdio server test.
- `node --check scripts/verify-live.cjs` passed; the updated live verifier has not yet run against the new controller.
- A real MCP connection to the existing Cubase AI 16.0.5 instance returned no coverage revision. A guarded volume write was rejected with `BRIDGE_UPGRADE_REQUIRED` and `not_started`; no value was submitted.
- The earlier `artifacts/live-smoke/verification.json` records the previous controller's four real-host checks and restored volume. It does not certify the new controls.
- The running Cubase instance still has the previous controller loaded. It and the MIDI port host were left running; user preferences were not read or modified in this upgrade.

## Remaining

Reload the installed driver or restart the isolated instance with approval, then verify the new revision and selected operations against the real host. Public MIDI Remote does not provide complete project, note/audio-event or export/render automation, so full Cubase feature coverage remains outside this backend.