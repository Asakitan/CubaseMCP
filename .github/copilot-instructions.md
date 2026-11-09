# Project Rules

- Target Cubase AI 16 on Windows. The MIDI Remote API declarations shipped with the installed application are authoritative.
- Keep one MIDI backend. Never introduce fallback, mock runtime, foreground control, keyboard/mouse injection, arbitrary command execution or silent replay.
- ES5 CommonJS is mandatory under `remote/`. Test the real controller handlers with an API-shaped fixture; fixtures are not a selectable production backend.
- Use strict session/object/parameter admission and report submitted/unknown outcomes accurately.
- Missing APIs and unavailable editions return errors, not invented values or success.
- Standard output of the server is exclusively MCP JSON-RPC. Diagnostics use stderr or the separate doctor CLI.
- Preserve user configuration and existing installed scripts. Installation must never start Cubase.
- MCP SDK documentation: https://github.com/modelcontextprotocol/typescript-sdk and https://ts.sdk.modelcontextprotocol.io/v2/
- Build with `npm run build`; verify with `npm test`. Live verification is explicit: `npm run doctor -- --live`.
- Update STATUS.md, module inventory, session log and affected module documentation within the same task.

## Setup Checklist

- [x] Requirements and strict background constraints recorded.
- [x] Project scaffold and dependencies installed.
- [x] No editor extension installation required.
- [x] Expanded controller integration, build and verification complete (57 tests); coverage-2 strip/Control Room controls installed.
- [x] Native MIDI prerequisites and real Cubase AI16.0.5 core-chain verification complete.
- [x] Coverage upgrade status and handoff synchronized; active Cubase driver reload remains pending.
