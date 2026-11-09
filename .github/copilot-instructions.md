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
- Keep core work with the main worker; the user permits GPT-6-luna for simple, bounded tasks only.
- Update STATUS.md, module inventory, session log and affected module documentation within the same task.

## Setup Checklist

- [x] Requirements and strict background constraints recorded.
- [x] Project scaffold and dependencies installed.
- [x] No editor extension installation required.
- [x] Controller 3.13 is installed and active; its focused checks and real MCP tempo edit/Save/fresh-reopen chain passed. The 109-test full-suite result belongs to 3.9.
- [x] Native MIDI prerequisites and earlier real Cubase AI16.0.5 core-chain verification recorded.
- [x] Observe a device/mapping activation and live MCP read/discovery without foreground input; one distinct DirectAccess parameter write and restore were observed.
- [x] Re-establish the mapping in a distinct isolated process without replaying the earlier timed-out status request.
- [x] Establish a concrete current-project Save and semantic persistence chain on a distinct owned fixture; session 28 read 146.75 after a fresh reopen. The earlier session 27 outcome remains unconfirmed.
- [ ] Resolve the separate selected-track and bank-channel volume binding writes whose requested values were not observed; validate additional controls individually.
- [x] Implement and observe owned background blank creation, existing CPR open, named save-as and explicit-discard stop through MCP.
- [ ] Implement and verify track/event editing, full routing/automation/plugin-state handling, rendering and remaining Cubase feature coverage.
