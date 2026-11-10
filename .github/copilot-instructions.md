# Project Rules

- Target Cubase AI 16 on Windows. The MIDI Remote API declarations shipped with the installed application are authoritative.
- Keep one MIDI control backend and explicit, whitelisted native project-lifecycle operations. Never introduce fallback, mock runtime, foreground control, keyboard/mouse injection, arbitrary command execution or silent replay.
- ES5 CommonJS is mandatory for modules under `remote/`; the Cubase entry script executes at top level and must not use `module.exports`. Test the real controller handlers with an API-shaped fixture; fixtures are not a selectable production backend.
- Use strict session/object/parameter admission and report submitted/unknown outcomes accurately.
- Missing APIs and unavailable editions return errors, not invented values or success.
- Standard output of the server is exclusively MCP JSON-RPC. Diagnostics use stderr or the separate doctor CLI.
- Preserve user configuration and existing installed scripts. Installation must never start Cubase.
- MCP SDK documentation: https://github.com/modelcontextprotocol/typescript-sdk and https://ts.sdk.modelcontextprotocol.io/v2/
- Build with `npm run build`; verify with `npm test`. Live verification is explicit: `npm run doctor -- --live`.
- Run only checks necessary for the changed behavior or required by the project; do not repeat equivalent tests or rerun unchanged suites.
- Keep core work with the main worker; the user permits a small helper model (haiku subagents, earlier GPT-6-luna) for simple, bounded tasks only.
- A host prompt cannot be answered. A command that opens a window does not belong in the allowlist; the only window a tool opens on purpose is the host export window, which the host closes itself and which receives no input.
- Start live runs from a process whose Windows job allows breakaway; otherwise the owned launch fails and the previous instance is already stopped.
- Update STATUS.md, module inventory, session log and affected module documentation within the same task.

## Setup Checklist

- [x] Requirements and strict background constraints recorded.
- [x] Project scaffold and dependencies installed.
- [x] No editor extension installation required.
- [x] Controller 3.14 is installed and active; the full suite and the 28-check real MCP song acceptance passed in session 30. The earlier 3.13 Save chain and the 109-test result of 3.9 are historical.
- [x] Native MIDI prerequisites and earlier real Cubase AI16.0.5 core-chain verification recorded.
- [x] Observe a device/mapping activation and live MCP read/discovery without foreground input; one distinct DirectAccess parameter write and restore were observed.
- [x] Re-establish the mapping in a distinct isolated process without replaying the earlier timed-out status request.
- [x] Establish a concrete current-project Save and semantic persistence chain on a distinct owned fixture; session 28 read 146.75 after a fresh reopen. The earlier session 27 outcome remains unconfirmed.
- [x] Resolve the selected-track and bank-channel volume binding writes whose requested values were not observed: cause found (callback cost during page activation), fixed in 3.14, both writes confirmed on the host.
- [x] Write every writable binding control once on the host with feedback as confirmation (session 30: 645 confirmed, see `docs/control-sweep-30.md`).
- [ ] Controls that were unavailable in the sweep project: sends to FX channels, strip modules and bank slots without a matching channel or plug-in.
- [x] Implement and observe owned background blank creation, existing CPR open, named save-as and explicit-discard stop through MCP.
- [x] Implement and verify MIDI event creation and read-back, track editing, transport and timeline control, and background audio mixdown through real MCP (session 30).
- [ ] Audio import and audio event editing, dialog-free instrument/FX/group track creation and instrument selection, in-place note edits, tempo-track events, automation data, routing writes, plug-in state, export settings, and score/arranger/media/sync coverage.
