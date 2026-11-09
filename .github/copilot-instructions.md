# Project Rules

- Target Cubase AI 16 on Windows. The MIDI Remote API declarations shipped with the installed application are authoritative.
- Keep one MIDI backend. Never introduce fallback, mock runtime, foreground control, keyboard/mouse injection, arbitrary command execution or silent replay.
- ES5 CommonJS is mandatory for modules under `remote/`; the Cubase entry script executes at top level and must not use `module.exports`. Test the real controller handlers with an API-shaped fixture; fixtures are not a selectable production backend.
- Use strict session/object/parameter admission and report submitted/unknown outcomes accurately.
- Missing APIs and unavailable editions return errors, not invented values or success.
- Standard output of the server is exclusively MCP JSON-RPC. Diagnostics use stderr or the separate doctor CLI.
- Preserve user configuration and existing installed scripts. Installation must never start Cubase.
- MCP SDK documentation: https://github.com/modelcontextprotocol/typescript-sdk and https://ts.sdk.modelcontextprotocol.io/v2/
- Build with `npm run build`; verify with `npm test`. Live verification is explicit: `npm run doctor -- --live`.
- Run only checks necessary for the changed behavior or required by the project; do not repeat equivalent tests or rerun unchanged suites.
- Update STATUS.md, module inventory, session log and affected module documentation within the same task.

## Setup Checklist

- [x] Requirements and strict background constraints recorded.
- [x] Project scaffold and dependencies installed.
- [x] No editor extension installation required.
- [x] Expanded controller integration and build complete (109 tests); coverage-3.8 is installed and previously activated in the isolated host.
- [x] Native MIDI prerequisites and earlier real Cubase AI16.0.5 core-chain verification recorded.
- [x] Observe a device/mapping activation and live MCP read/discovery without foreground input; one distinct DirectAccess parameter write and restore were observed.
- [ ] Re-establish the current mapping after temporary port changes and a device-deactivation observation, without replaying the timed-out status request.
- [ ] Resolve the separate selected-track and bank-channel volume binding writes whose requested values were not observed; validate additional controls individually.
- [ ] Implement and verify project creation, saving, event editing, rendering and remaining Cubase feature coverage.
