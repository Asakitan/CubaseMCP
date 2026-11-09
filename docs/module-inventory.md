# Module Inventory

| Source | Runtime target | Status |
| --- | --- | --- |
| `src/config.ts` | `dist/src/config.js` | Literal policy parser verified |
| `src/server.ts` | `dist/src/server.js` | 23 tools; every session operation requires the current bridge before dispatch |
| `src/bridge-contract.ts` | `dist/src/bridge-contract.js` | Shared host/revision/active-session gate; operational readiness is explicit |
| `src/doctor.ts` | `dist/src/doctor.js` | Reports operational readiness separately from handshake availability |
| `src/midi.ts` | `dist/src/midi.js` | 15 tests passed; exact ports, deadline and fault latch |
| `remote/protocol.js` | Driver folder and `dist/remote/protocol.js` | 2 protocol tests passed |
| `remote/controller.js` | Driver folder | Coverage 3.4 installed and constructed; guarded bank controls fixture-tested, device activation unverified |
| `remote/CubaseAI_MCP.js` | Driver entry | Top-level CommonJS export removed; ES5 regression passed and current host logged controller construction |
| `remote/commands.js` | Driver command allowlist | 3 fixed bindings; ES5 verified and installed |
| `scripts/Install-Remote.ps1` | Local driver installation | Four files deployed; no Cubase launch |
| `.vscode/mcp.json` | VS Code stdio server | Configured against built entry |
| `.vscode/tasks.json` | Build/test/install/live-diagnostic tasks | Build and 74-test suite passed; current real-host handshake remains unverified |
| `scripts/Install-Midi.ps1` | Installed loopMIDI/virtualMIDI driver | Explicit installation completed |
| `native/MidiPortHost.cs` | Hidden PowerShell port process | Real SysEx loopbacks and client-PID query tested |
| `scripts/Start-MidiPorts.ps1` | Two exact-name virtual ports | Running with explicit stop and correlated one-shot client inspection |
| `native/CubaseDesktop.cs` | Isolated Windows desktop/process lifetime | Private recovered project opened; no input desktop switch |
| `scripts/Start-CubaseBackground.ps1` | Explicit existing CPR or copied AI test project | Validated path, runtime receipt, detached holder output; existing-instance guard test passed, no native project-creation claim |
| `native/CubaseDeviceRefresh.cs` | Fixed isolated device notification diagnostic | Private worker-thread binding; delivery/reconnection unverified |
| `scripts/Refresh-CubaseDevices.ps1` | Explicit device refresh diagnostic | Structured errors; no arbitrary message or MCP route |
| `scripts/verify-live.cjs` | Actual stdio MCP verifier | Uses single-control queries and track guards; latest live handshake timed out |
| `scripts/inspect-cubase-ipc.cjs` | Independent read-only diagnostic | Ten actual PE files and live endpoint metadata inspected successfully; no host mutation or RPC calls |
| `docs/native-interface-investigation.md` | Native integration evidence | Factory, project-request and SKI-dispatcher candidates recorded; callable ABI not recovered |
| `native/FactoryProbe.cs` | Independent diagnostic process | Default metadata, observed service class/interface, and fixed empty-request probe; empty branch returned 1/status 4 without host context |
| `scripts/Inspect-ProjectFactory.ps1` | Explicit factory diagnostic task | Default metadata mode unchanged; `-ProbeProjectService` acquires/releases observed interface in the probe only |
| `docs/native-factory-recovery.md` | Native factory evidence | Visibility gate distinguished from registration table; CID/IID and independent service result recorded |
| `scripts/host-project-inspect.py` | Static PE/RTTI inspection | Independent file analysis only; no live project access |
| `docs/host-project-api.md` | Native request research | Partial read-only request and host dispatch contract; live context unresolved |
| `docs/midi-coverage-audit.md` | Declaration-backed coverage inventory | Implemented bindings and known gaps distinguished from real-host verification |
| `scripts/host-registry-disasm.py` | Fixed native registry ranges | Read-only disassembly and module factory context route |
| `scripts/project-lifecycle-inspect.py` | Fixed lifecycle/marker candidates | Read-only evidence, no project operation |
| `docs/host-registry-access.md` | Static and live native registry evidence | Host registry membership recorded; later fixed request returned an error callback |
| `docs/service-request-contract.md` | Service ABI investigation | Empty-input return validated independently; complete live request contract pending |
| `docs/project-lifecycle-contract.md` | Native lifecycle research | Marker/listener paths bounded; no complete project CRUD contract |
| `docs/startup-recovery-investigation.md` | Current startup evidence | Recovered score project opened privately after cache archival; current handshake absent |
| `native/bridge/CubaseMcpNativeProbe.cpp`, `native/bridge/ProjectHostAbi.h` | Fixed diagnostic DLL | Approved in-process host query and one correlated error callback; no project data |
| `native/NativeProbeLoader.cs`, `scripts/Invoke-NativeProbe.ps1` | Explicit isolated diagnostic loader | Fixed module and build profile only; not an MCP backend |
| `scripts/Read-MidiScriptErrors.ps1` | Isolated script-console reader | Bounded read-only script-path diagnostics verified for earlier/current test processes |
| `tests/entry.test.cjs`, `tests/midi-port-clients.ps1`, `tests/probe-wrapper-policy.ps1` | Entry/driver/diagnostic regressions | Top-level script, actual virtual-port client identity and probe exit-policy tests passed |
| `docs/midi-coverage-3.md`, `docs/midi-insert-viewer.md`, `docs/midi-mixer-bank.md`, `docs/midi-script-state.md` | Controller and live-script evidence | Pagination, guarded mixer/insert controls and observed activation gap documented |
| `docs/scoring-startup-failure.md`, `docs/service-admission.md`, `docs/project-command-catalog.md` | Native research evidence | Cache recovery, feature-record observation and command schemas distinguished from execution |
| `docs/midi-instance-experiment.md` | Isolated project-copy experiment | Same-length instance-block test opened, but activation and handshake were not observed |
| `docs/midi-detection-predicate.md`, `scripts/midi-detection-predicate.py` | Fixed detector-predicate investigation | Script-path lookup and rejection-set machinery identified; activation trigger unresolved |
| `docs/midi-activation-dispatch.md`, `docs/midi-detection-ports.md`, `scripts/midi-detection-ports.py` | MIDI activation investigation | Prepared-command and detector paths bounded; execution and port-pairing trigger remain unverified |
| `docs/project-lifecycle-followup.md` | Project lifecycle follow-up | Native save stream and error-path research; no project CRUD execution claimed |
| `scripts/Read-MidiHostEnvironment.ps1`, `docs/midi-host-environment.md` | Read-only isolated MIDI Remote model diagnostic | Current bounded snapshot found empty input/output collections; no activation claim |
| `scripts/Read-MidiPortInformer.ps1`, `docs/midi-host-port-adapter.md`, `docs/midi-informer-tree.md` | Read-only isolated informer and registry diagnostic | Adapter registration, empty informer trees and target-named MME registry sockets observed; propagation cause unresolved |
| `scripts/Read-MidiScannerState.ps1`, `docs/midi-informer-source.md`, `docs/midi-scanner-detail.md` | Read-only MIDI scanner investigation | Two target-named records had empty detail ranges; detail semantics and event history unresolved |
| `docs/midi-detection-correlation.md`, `docs/midi-project-gate.md`, `docs/midi-project-notifications.md`, `docs/midi-project-tree-meaning.md`, `scripts/midi-detection-correlation.py`, `scripts/midi-project-tree-meaning.py` | MIDI Remote project and scanner gate research | Distinct tree paths, project-notification insertion and a root-selection sender identified; live event ordering unresolved |
| `docs/midi-detection-scheduler.md`, `docs/midi-host-port-producer.md` | MIDI Remote model synchronization research | Detection scheduler and producer branches traced; event source and execution remain unverified |
| `scripts/dawproject-filter-inspect.py`, `docs/dawproject-host-filter.md` | Installed DAWproject filter investigation | Loaded in the isolated host; independent metadata query and static import chain do not prove a project operation |
| `scripts/dawproject-package-client-inspect.py`, `docs/dawproject-package-client.md` | DAWproject package and host context research | Package preparation can create directories; ownership and concrete `MProject` IID match remain static evidence |
| `scripts/Read-DawprojectHostContext.ps1`, `scripts/dawproject-host-context-inspect.py`, `docs/dawproject-host-context.md` | Read-only host context and listener investigation | MProject/MRoot vtables and informer listener membership observed; active-project and import semantics unverified |
| `scripts/Read-DawprojectRootField.ps1`, `docs/dawproject-active-project.md` | Read-only MRoot field investigation | A tempo-track event and its interface were observed; no arrangement or lifecycle operation claimed |
| `docs/project-save-target.md` | Native save destination and cleanup investigation | Conditional file deletion and creation paths identified; exact targets and recovery semantics unresolved |
| `scripts/Trace-MidiStartup.ps1`, `docs/midi-startup-timeline.md` | Isolated read-only startup snapshots | Version-validated, bounded listener and project-tree sampling; prearmed launch mode is diagnostic only |
| `tests/background-launch-pipe.ps1` | Focused background-launch contract check | Existing-instance guard returned through captured stdout with separate holder logs; a fresh launch was not tested by this check |
| `docs/project-open-routing.md`, `docs/project-lifecycle-dispatch.md`, `scripts/project-lifecycle-dispatch-inspect.py` | Lifecycle routing and dispatcher investigation | Static paths and file association observed; main-thread affinity and unattended lifecycle contract remain unverified |
| `docs/midi-coverage-3.4.md` | Bank-channel coverage and limits | Declaration-backed guarded controls; current live mapping and project operations remain unverified |
| `docs/midi-project-event-sources.md`, `docs/project-activation-route.md`, associated `scripts/*-inspect.py` | Project selector and event-source investigation | Seven static direct callers and old/new notifications verified; no public background activation contract established |

## Update Log

| Date | Change |
| --- | --- |
| 2026-11-10 | Delivered strict-background implementation, 16 tools/31 controls, 35 passing tests and user-script deployment; live MIDI connection remains blocked by absent ports. |
| 2026-11-10 | Installed virtual MIDI prerequisites, isolated the real AI16.0.5 test host, fixed native callback/snapshot/value contracts; 40 tests and four live checks passed. |
| 2026-11-10 | Expanded controls and host queries to 23 tools; added track identity, feedback invalidation and bridge-version guards; 52 tests passed, installed controller awaits host reload. |
| 2026-11-10 | Investigated native IPC and project component interfaces read-only; captured ten-module report and host dispatcher leads, without changing the MIDI backend. |
| 2026-11-10 | Queried both component factories and bounded their creation dispatch; host registration/context remains unresolved, with no new production operation claimed. |
| 2026-11-10 | Added strip/Control Room controls and uniform bridge admission; 57 tests passed, coverage-2 deployed, real old-host rejection verified; recovered and independently acquired the native project service without invoking it. |
| 2026-11-10 | Validated the independent empty-input service branch and live registry membership; added explicit-path isolated launch and fixed device diagnostic. Restarted the owned test host with approval; startup and MIDI activation remain incomplete. |
| 2026-11-10 | Recovered the score project, repaired the script entry, added bounded paging, insert-viewer and mixer-bank fixtures, and port-client diagnostics; 70 tests passed, while current mapping activation and native project CRUD remain open. |
| 2026-11-10 | Deployed coverage 3.3 to the private host and traced activation and project-save internals; a real status request still timed out before any write. |
| 2026-11-10 | Observed empty MIDI Remote host-port collections despite open OS ports and traced an installed DAWproject filter; project and activation contracts remain unverified. |
| 2026-11-10 | Added prearmed startup sampling, documented project routing, and detached background-holder output; observed root-before-informer samples and an empty notification tree, while the current MCP handshake timed out. |
| 2026-11-10 | Expanded identity-guarded bank controls in revision 3.4 and traced additional static project-selector callers; real mapping and lifecycle verification remain open. |
