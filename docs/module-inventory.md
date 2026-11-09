# Module Inventory

| Source | Runtime target | Status |
| --- | --- | --- |
| `src/config.ts` | `dist/src/config.js` | Literal policy parser verified |
| `src/server.ts` | `dist/src/server.js` | 23 tools; every session operation requires the current bridge before dispatch |
| `src/bridge-contract.ts` | `dist/src/bridge-contract.js` | Shared host/revision/active-session gate; operational readiness is explicit |
| `src/doctor.ts` | `dist/src/doctor.js` | Reports operational readiness separately from handshake availability |
| `src/midi.ts` | `dist/src/midi.js` | 15 tests passed; exact ports, deadline and fault latch |
| `remote/protocol.js` | Driver folder and `dist/remote/protocol.js` | 2 protocol tests passed |
| `remote/controller.js` | Driver folder | 37 handler tests passed; coverage-2 strip/Control Room controller installed, active host reload pending |
| `remote/CubaseAI_MCP.js` | Driver entry | ES5 verified and installed |
| `remote/commands.js` | Driver command allowlist | 3 fixed bindings; ES5 verified and installed |
| `scripts/Install-Remote.ps1` | Local driver installation | Four files deployed; no Cubase launch |
| `.vscode/mcp.json` | VS Code stdio server | Configured against built entry |
| `.vscode/tasks.json` | Build/test/install/live-diagnostic tasks | Build and 57-test suite passed; old-version real host gate verified |
| `scripts/Install-Midi.ps1` | Installed loopMIDI/virtualMIDI driver | Explicit installation completed |
| `native/MidiPortHost.cs` | Hidden PowerShell port process | Compiled; both real SysEx loopbacks passed |
| `scripts/Start-MidiPorts.ps1` | Two exact-name virtual ports | Running; explicit stop supported |
| `native/CubaseDesktop.cs` | Isolated Windows desktop/process lifetime | Real Cubase launch verified without desktop switch |
| `scripts/Start-CubaseBackground.ps1` | Copied AI test project | Running; no preference rewriting |
| `scripts/verify-live.cjs` | Actual stdio MCP verifier | Previous version passed four live checks; updated verifier guards track identity and preserves previous evidence |
| `scripts/inspect-cubase-ipc.cjs` | Independent read-only diagnostic | Ten actual PE files and live endpoint metadata inspected successfully; no host mutation or RPC calls |
| `docs/native-interface-investigation.md` | Native integration evidence | Factory, project-request and SKI-dispatcher candidates recorded; callable ABI not recovered |
| `native/FactoryProbe.cs` | Independent diagnostic process | Default metadata probe plus explicit observed service-interface acquisition; service succeeded without host context or request execution |
| `scripts/Inspect-ProjectFactory.ps1` | Explicit factory diagnostic task | Default metadata mode unchanged; `-ProbeProjectService` acquires/releases observed interface in the probe only |
| `docs/native-factory-recovery.md` | Native factory evidence | Visibility gate distinguished from registration table; CID/IID and independent service result recorded |
| `scripts/host-project-inspect.py` | Static PE/RTTI inspection | Independent file analysis only; no live project access |
| `docs/host-project-api.md` | Native request research | Partial read-only request and host dispatch contract; live context unresolved |
| `docs/midi-coverage-audit.md` | Declaration-backed coverage inventory | Implemented bindings and known gaps distinguished from real-host verification |

## Update Log

| Date | Change |
| --- | --- |
| 2026-11-10 | Delivered strict-background implementation, 16 tools/31 controls, 35 passing tests and user-script deployment; live MIDI connection remains blocked by absent ports. |
| 2026-11-10 | Installed virtual MIDI prerequisites, isolated the real AI16.0.5 test host, fixed native callback/snapshot/value contracts; 40 tests and four live checks passed. |
| 2026-11-10 | Expanded controls and host queries to 23 tools; added track identity, feedback invalidation and bridge-version guards; 52 tests passed, installed controller awaits host reload. |
| 2026-11-10 | Investigated native IPC and project component interfaces read-only; captured ten-module report and host dispatcher leads, without changing the MIDI backend. |
| 2026-11-10 | Queried both component factories and bounded their creation dispatch; host registration/context remains unresolved, with no new production operation claimed. |
| 2026-11-10 | Added strip/Control Room controls and uniform bridge admission; 57 tests passed, coverage-2 deployed, real old-host rejection verified; recovered and independently acquired the native project service without invoking it. |
