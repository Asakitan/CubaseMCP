# Cubase AI 16 MCP

Version: 0.1.0. State: coverage-2 controller built and installed; active Cubase still has the earlier controller. The complete user goal is not achieved.

## Delivered

- 23 MCP tools over one native MIDI Remote SysEx connection; no foreground automation, alternate execution backend, automatic retry or replay.
- DirectAccess object/parameter discovery and writes, plugin slot assignment, transport, track identity/navigation, EQ/filter/sends, instrument/automation/quick controls and meters.
- Added 20 selected-channel strip bindings plus Control Room root/main/indexed bindings. Host maxima and availability govern admission; Control Room indexes share a 16-channel budget. See `docs/midi-coverage-audit.md` for known omissions.
- Every session-based host operation now requires the current bridge revision, Cubase 16, an active mapping and the current session. Old controllers remain accessible only through status/capability/reset diagnostics. The doctor reports operational readiness separately from a successful handshake.
- Expected revision: `2026-11-10-coverage-2`. The controller under `C:\Users\99325\Documents\Steinberg\Cubase\MIDI Remote\Driver Scripts\Local\CubaseAI\MCP` was replaced and readback-verified. Three companion files were unchanged. The prior installed controller is retained at `artifacts/runtime/controller-before-coverage-2-20261110.js`.

## Current evidence

- `node node_modules/typescript/bin/tsc -p tsconfig.json` passed; `node --test tests/*.test.cjs` passed **57/57**, with no skipped tests. The new all-operation regression first reproduced a legacy read bypass before the fix.
- Real Cubase AI 16.0.5 still runs on `winsta0/CubaseAI_MCP`, PID 11368 at the last observation. Its MIDI handshake succeeds but returns no bridge revision. A real legacy read was rejected as `BRIDGE_UPGRADE_REQUIRED`, `not_started`; evidence: `artifacts/live-smoke/guard-live-20261110.json`.
- The earlier `artifacts/live-smoke/verification.json` proves discovery, Piano parameters, live control feedback and a restored volume write on the old controller. It does not validate coverage-2 controls.
- An independent native probe successfully obtained the observed project service interface through standard `IPluginFactory.createInstance` with the recovered CID/IID, and released it. Public class count remained zero; service vtable matched the static trace. Evidence: `artifacts/ipc/service-probe-20261110.json`. No service request or live project query was made.
- Native static analysis recovered part of the project request/response path and an unexecuted `GetMusicalTrack` request candidate. Host context, live delivery, callback ownership and a complete editing contract remain unresolved. See `docs/host-project-api.md` and `docs/native-factory-recovery.md`.
- Standard process read/query access returned Windows error 5. The user approved loading R1 only for read-only Cubase diagnosis; R1 returned `LOAD_FAILED` because its service lacks `SeLoadDriverPrivilege`, with `loaded: false`. No R1 process-memory reads or writes occurred.

## Runtime and paths

- Executable: `C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe` (16.0.5). `D:\CubaseAI` contains installer downloads, not the running application.
- Virtual ports: `CubaseAI MCP To Cubase` / `CubaseAI MCP From Cubase`; no-window port host state: `artifacts/runtime/midi-ports.json`.
- Test project: `artifacts/live-smoke/MCP Smoke.cpr`, copied from an installed AI template. A template copy is not proof of native MCP project creation or saving.
- No preference changes, foreground window operations, Cubase restart, or new runtime backend were performed in session 06.

## Required work

1. Establish the native project host/context and request/result contract, then obtain a read-only response from the real isolated test project.
2. Implement and verify project creation and saving, event editing and parameterized rendering through that verified native contract. These are not implemented in the current MCP.
3. Activate coverage-2 automatically without a foreground/UI execution path and run focused live verification. The current process remains on the old controller.
4. Complete remaining declaration-backed MIDI families and track the edition-dependent gaps. Neither the 23-tool count nor fixture coverage proves all Cubase functionality.
