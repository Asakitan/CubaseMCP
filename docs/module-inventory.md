# Module Inventory

| Source | Runtime target | Status |
| --- | --- | --- |
| `src/config.ts` | `dist/src/config.js` | Literal policy parser verified |
| `src/server.ts` | `dist/src/server.js` | 24 tools; current bridge gate, guarded parameter edit-lock setter and plug-in-bank identity schema |
| `src/bridge-contract.ts` | `dist/src/bridge-contract.js` | Shared host/revision/active-session gate; operational readiness is explicit |
| `src/doctor.ts` | `dist/src/doctor.js` | Reports operational readiness separately from handshake availability |
| `src/midi.ts` | `dist/src/midi.js` | 15 tests passed; exact ports, deadline and fault latch |
| `remote/protocol.js` | Driver folder and `dist/remote/protocol.js` | 2 protocol tests passed |
| `remote/controller.js` | Driver folder | Coverage 3.8 installed and current host mapping activated; DirectAccess parameter and edit-lock round trips observed, selected-track and bank volume binding writes unverified |
| `remote/CubaseAI_MCP.js` | Driver entry | Top-level CommonJS export removed; ES5 regression passed and current host logged controller construction |
| `remote/commands.js` | Driver command allowlist | 3 fixed bindings; ES5 verified and installed |
| `scripts/Install-Remote.ps1` | Local driver installation | Four files deployed; no Cubase launch |
| `.vscode/mcp.json` | VS Code stdio server | Configured against built entry |
| `.vscode/tasks.json` | Build/test/install/live-diagnostic tasks | Build and 93-test suite passed; current MCP reads succeeded and one DirectAccess parameter was written/restored |
| `scripts/Install-Midi.ps1` | Installed loopMIDI/virtualMIDI driver | Explicit installation completed |
| `native/MidiPortHost.cs` | Hidden PowerShell port process | Real SysEx loopbacks and client-PID query tested |
| `scripts/Start-MidiPorts.ps1` | Two exact-name virtual ports | Running with explicit stop and correlated one-shot client inspection |
| `native/CubaseDesktop.cs` | Isolated Windows desktop/process lifetime | Shared suspended-process desktop and restricted-Job core for explicit CPR and no-argument launch; synthetic checks and session 24 launch observed |
| `scripts/Start-CubaseBackground.ps1` | Explicit existing CPR or copied AI test project | Validated path, runtime receipt and no-inherited-handle holder; fresh detached launch observed in session 20 |
| `scripts/Start-CubaseEmptyBackground.ps1`, `tests/EmptyStartProbe.cs`, `tests/empty-start-job.ps1`, `tests/background-empty-existing-guard.ps1` | Separate no-CPR private launch diagnostic | Existing-instance guard and synthetic Job checks passed; PID 72128 launched with identity-bearing receipt; not an MCP create operation |
| `scripts/Read-FirstProjectState24.ps1`, `scripts/Prepare-FirstProjectOpen24Fixture.ps1`, `scripts/Observe-FirstProjectOpen24.ps1` | Fixed session 24 admission, copied fixture and passive observer | No-project state and Job sampled; 512 observer samples without a recorded desktop violation; polling is non-atomic |
| `native/FirstProjectJobAudit24.cs`, `native/FirstProjectOpen24Loader.cs`, `native/bridge/CubaseMcpFirstProjectOpen24.cpp`, `scripts/Build-FirstProjectOpen24.ps1`, `scripts/Invoke-FirstProjectOpen24.ps1` | Fixed one-shot diagnostic outside MCP runtime | Built; one fixture submission returned zero and subsequent project root/tree and 3.8 activation were observed; no lifecycle completion claimed |
| `docs/background-empty-start-24.md`, `docs/empty-start-static-24.md`, `docs/first-project-open-24.md` | Session 24 launch, static-branch and first-project evidence | Diagnostic scope, sampling limitations, mapping activation and individual live MCP observations recorded |
| `scripts/inspect-cpr-envelope.cjs`, `tests/cpr-envelope.test.cjs`, `docs/cpr-envelope-25.md` | Read-only CPR outer-envelope diagnostic | Synthetic malformed framing checks and one fixture inspection passed; no archive semantics or persistence claim |
| `scripts/Read-CurrentProjectPath25.ps1`, `scripts/save-25-path-static.py`, `docs/project-save-25.md` | Fixed read-only project path candidate and save-path static trace | One root/document/path candidate observed; actual save destination, dirty and completion unresolved |
| `scripts/project-create-25-inspect.py`, `docs/project-create-25.md`, `docs/control-binding-25.md` | File-only creation branch and live control-binding evidence | Conditional Hub service call traced; two distinct control submissions remained unconfirmed |
| `native/CubaseDeviceRefresh.cs` | Fixed isolated device notification diagnostic | Private worker-thread binding; delivery/reconnection unverified |
| `scripts/Refresh-CubaseDevices.ps1` | Explicit device refresh diagnostic | Structured errors; no arbitrary message or MCP route |
| `scripts/verify-live.cjs`, `tests/verify-live.test.cjs` | Actual stdio MCP verifier | Current 3.8 reads/discovery passed; Piano control write target was not observed and no restore was submitted |
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
| `docs/startup-recovery-investigation.md` | Historical startup evidence | Recovered score project opened privately after cache archival; that earlier process had no observed handshake |
| `native/bridge/CubaseMcpNativeProbe.cpp`, `native/bridge/ProjectHostAbi.h` | Fixed diagnostic DLL sources | Earlier host request returned an error callback; fixed path lookup and Unicode setter/field checks returned in the isolated process |
| `native/NativeProbeLoader.cs`, fixed `scripts/Invoke-*Probe.ps1` wrappers | Explicit isolated diagnostic loader | Two fixed module images and three hardcoded entry choices with one-shot guards; not an MCP backend |
| `scripts/Build-PathRoundTripProbe.ps1`, `scripts/Invoke-PathRoundTripProbe.ps1` | Fixed temporary path-object diagnostic | Synthetic Unicode setter and bounded object-field comparison succeeded; no project operation |
| `tests/probe-wrapper-policy.ps1` | Fixed diagnostic entry-result policy | Three wrappers' success, incomplete-entry and error guards checked without launching Cubase |
| `scripts/Read-MidiScriptErrors.ps1` | Isolated script-console reader | Bounded read-only script-path diagnostics verified for earlier/current test processes |
| `tests/entry.test.cjs`, `tests/midi-port-clients.ps1`, `tests/probe-wrapper-policy.ps1` | Entry/driver/diagnostic regressions | Top-level script, actual virtual-port client identity and probe exit-policy tests passed |
| `docs/midi-coverage-3.md`, `docs/midi-insert-viewer.md`, `docs/midi-mixer-bank.md`, `docs/midi-script-state.md` | Controller and live-script evidence | Pagination, guarded mixer/insert controls and observed activation gap documented |
| `docs/scoring-startup-failure.md`, `docs/service-admission.md`, `docs/project-command-catalog.md` | Native research evidence | Cache recovery, feature-record observation and command schemas distinguished from execution |
| `docs/midi-instance-experiment.md` | Isolated project-copy experiment | Same-length instance-block test opened, but activation and handshake were not observed |
| `docs/midi-detection-predicate.md`, `scripts/midi-detection-predicate.py` | Fixed detector-predicate investigation | Script-path lookup and rejection-set machinery identified; activation trigger unresolved |
| `docs/midi-activation-dispatch.md`, `docs/midi-detection-ports.md`, `scripts/midi-detection-ports.py` | MIDI activation investigation | Prepared-command and detector paths bounded; execution and port-pairing trigger remain unverified |
| `docs/project-lifecycle-followup.md` | Project lifecycle follow-up | Native save stream and error-path research; no project CRUD execution claimed |
| `scripts/Read-MidiHostEnvironment.ps1`, `docs/midi-host-environment.md` | Read-only isolated MIDI Remote model diagnostic | Session 24 snapshots found empty collections before first open and named ports afterward; controller console separately recorded activation |
| `scripts/Read-MidiPortInformer.ps1`, `docs/midi-host-port-adapter.md`, `docs/midi-informer-tree.md` | Read-only isolated informer and registry diagnostic | Adapter registration, empty informer trees and target-named MME registry sockets observed; propagation cause unresolved |
| `scripts/Read-MidiScannerState.ps1`, `docs/midi-informer-source.md`, `docs/midi-scanner-detail.md` | Read-only MIDI scanner investigation | Two target-named records had empty detail ranges; detail semantics and event history unresolved |
| `docs/midi-detection-correlation.md`, `docs/midi-project-gate.md`, `docs/midi-project-notifications.md`, `docs/midi-project-tree-meaning.md`, `scripts/midi-detection-correlation.py`, `scripts/midi-project-tree-meaning.py` | MIDI Remote project and scanner gate research | Distinct tree paths, project-notification insertion and a root-selection sender identified; live event ordering unresolved |
| `docs/midi-detection-scheduler.md`, `docs/midi-host-port-producer.md` | MIDI Remote model synchronization research | Detection scheduler and producer branches traced; event source and execution remain unverified |
| `scripts/dawproject-filter-inspect.py`, `docs/dawproject-host-filter.md` | Installed DAWproject filter investigation | Loaded in the isolated host; independent metadata query and static import chain do not prove a project operation |
| `scripts/dawproject-package-client-inspect.py`, `docs/dawproject-package-client.md` | DAWproject package and host context research | Package preparation can create directories; ownership and concrete `MProject` IID match remain static evidence |
| `scripts/Read-DawprojectHostContext.ps1`, `scripts/dawproject-host-context-inspect.py`, `docs/dawproject-host-context.md` | Read-only host context and listener investigation | MProject/MRoot vtables and informer listener membership observed; active-project and import semantics unverified |
| `scripts/Read-DawprojectRootField.ps1`, `scripts/project-tempo-source-23-inspect.py`, `docs/dawproject-active-project.md`, `docs/project-tempo-field-22.md`, `docs/project-tempo-source-23.md` | Read-only MRoot field investigation | Static `Transport/Tempo/value` import-to-float trace; units and lifecycle operation remain unverified |
| `docs/project-save-target.md` | Native save destination and cleanup investigation | Conditional file deletion and creation paths identified; exact targets and recovery semantics unresolved |
| `scripts/Trace-MidiStartup.ps1`, `docs/midi-startup-timeline.md` | Isolated read-only startup and transition snapshots | Explicit CPR or no-argument prearm and ready/stream transition mode; bounded listener/tree and desktop/title samples; diagnostic only |
| `tests/background-launch-pipe.ps1` | Focused background-launch contract check | Existing-instance guard returned through captured stdout with separate holder logs; a fresh launch was not tested by this check |
| `docs/project-open-routing.md`, `docs/project-lifecycle-dispatch.md`, `scripts/project-lifecycle-dispatch-inspect.py` | Lifecycle routing and dispatcher investigation | Static paths and file association observed; main-thread affinity and unattended lifecycle contract remain unverified |
| `docs/midi-coverage-3.4.md` | Bank-channel coverage and limits | Declaration-backed guarded controls; individual bank behavior and project operations remain unverified |
| `docs/midi-coverage-3.5.md` | Bank insert viewer coverage and limits | Read-only values and identity-guarded navigation fixture-tested; live operation remains unverified |
| `docs/midi-project-event-sources.md`, `docs/project-activation-route.md`, associated `scripts/*-inspect.py` | Project selector and event-source investigation | Seven static direct callers and old/new notifications verified; no public background activation contract established |
| `docs/project-activation-provenance.md`, `scripts/project-activation-provenance-inspect.py` | Project activation sender/receiver investigation | Arranger vtable and separate remote-wheel producer statically identified; relationship and dispatch remain unverified |
| `scripts/project-save-alert-inspect.py`, `docs/project-save-target.md` | Save error alert-service investigation | Fixed static path and read-only global snapshot; no save or dialog invoked |
| `scripts/project-host-open-interface-inspect.py`, `docs/project-host-open-interface.md` | Host project-open interface investigation | Shipped-component path traced statically; fixed path-class lookup succeeded, while no host-open or project action was invoked |
| `scripts/Read-PluginContextStatic.ps1` | Read-only static host-context and registration snapshot | PID, private desktop and PE profile checked; context vtables and path-factory record in its IID bucket observed without a host or factory call |
| `scripts/project-instance-routing-inspect.py`, `docs/project-instance-routing.md` | Candidate second-instance routing investigation | State-dependent foreground call identified; no second-instance experiment performed |
| `scripts/project-save-preflight-inspect.py`, `docs/project-save-preflight.md` | Save preflight investigation | Conditional alert-service call precedes file-open site; prompt and save results remain unverified |
| `scripts/template-startup-path-inspect.py`, `docs/template-startup-path.md` | Historical template and path-argument investigation | Early successful live verification and current action arguments compared without inferring cause |
| `scripts/midi-project-queue-consumer-inspect.py`, `docs/midi-project-queue-consumer.md` | Posted-message queue and receiver investigation | Conditional dispatch and eleven decoded direct callers identified; actual delivery remains unverified |
| `scripts/project-open-14-inspect.py`, `docs/project-open-14.md` | Host open and drag-path follow-up | Caller identified as drag-data enumeration; queued open return does not prove enqueue or completion |
| `scripts/project-save-preflight-state-inspect.py`, `docs/project-save-preflight.md` | Save preflight state provenance | Shared startup-state byte identified; meaning, prompt and save outcome remain unresolved |
| `scripts/midi-activation-14-inspect.py`, `docs/midi-activation-14.md` | MIDI scanner inquiry and rebuild follow-up | Static inquiry registration and receiver provenance identified without asserting name-detection causality |
| `scripts/project-path-roundtrip-inspect.py` | Fixed path setter and filesystem-root profile | RTTI, vtable slots and leaf/import targets validated before the temporary-object diagnostic |
| `scripts/project-dispatch-15-inspect.py`, `docs/project-dispatch-15.md` | Project-open application dispatch follow-up | Conditional app receiver and ignored result traced; thread and completion remain unverified |
| `scripts/project-lifecycle-15-inspect.py`, `docs/project-lifecycle-15.md` | Save pre-open decision follow-up | Second conditional alert and original-path attribute checks identified; no save invoked |
| `scripts/midi-activation-15-inspect.py`, `docs/midi-activation-15.md` | MIDI scanner receiver follow-up | Current receiver/vtables and empty detail records observed without MIDI transmission |
| `scripts/Read-ProjectCandidates.ps1`, `scripts/project-candidate-provenance-inspect.py`, `docs/project-candidate-observation.md` | Bounded candidate and root provenance | Current matching path/root candidate observed; active selection and lifecycle completion unverified |
| `scripts/project-open-16-snapshot.ps1`, `scripts/project-open-16-inspect.py`, `scripts/project-open-lifetime-16-inspect.py`, `docs/project-open-16.md` | Host-open thread and ownership | Calling-thread comparison and saved thread ID observed; conditional path copies and message fields traced; delivery, full lifetime and completion unresolved |
| `scripts/project-create-save-16-inspect.py`, `docs/project-create-save-16.md` | Additional save predicate | Local-volume branch narrowed; target, alerts and save completion unresolved |
| `scripts/midi-activation-16-inspect.py`, `docs/midi-activation-16.md` | Scanner request-path follow-up | Output-collection return and conditional request-object submission traced; transmission and mapping unverified |
| `docs/midi-coverage-3.6.md` | Selected-channel guards and verifier | Historical 3.6 fixture and host-construction evidence; current 3.8 mapping has activated |
| `docs/midi-plugin-banks-3.7.md` | Instrument and strip parameter-bank controls | 3.7 fixture and historical deployment evidence; 3.8 mapping has activated, individual plug-in banks remain unverified live |
| `native/ActivationSnapshot21.cpp`, `scripts/Build-ActivationSnapshot21.ps1`, `scripts/Read-ActivationCandidates21.ps1`, `docs/project-activation-stack-21.md` | Isolated process/thread context research | One fixed PSS context captured; separate stack reads are not synchronized and prompt decision remains unknown |
| `docs/midi-parameter-lock-3.8.md` | DirectAccess edit-lock setter | Guarded setter fixture-tested, installed, and observed on one live parameter with restoration |
| `scripts/Read-ActivationPredicates22.ps1`, `scripts/Read-ProjectList22.ps1`, `scripts/Read-ProjectRootDocuments22.ps1`, `docs/project-activation-static-22.md`, `docs/project-activation-predicates-22.md`, `docs/project-list-22.md`, `docs/project-root-documents-22.md` | Activation branch and post-prompt project candidates | Two distinct root/document/path candidates observed; no activation, completion or persistence claim |
| `native/ActivationClone22.cpp`, `scripts/Build-ActivationClone22.ps1`, `scripts/Observe-ActivationClone23.ps1`, `docs/project-activation-clone-22.md` | Synthetic-only PSS clone/stack walk | Named-frame walk passed both without and with a synthetic restricted Job; inventory absence does not prove full resource release |
| `docs/project-open-options-23.md` | Fixed-build open-call and activation branch analysis | Conditional prompt-skip path identified without a verified unattended call or completed open |
| `native/ActivationClone23Target.cpp`, `scripts/Build-ActivationClone23Target.ps1`, `scripts/Invoke-ActivationClone23Target.ps1`, `scripts/project-activation-stack-23-inspect.py`, `docs/project-activation-clone-23-target.md`, `docs/project-activation-stack-23.md` | One-shot fixed-target partial PSS walk | One capture emitted 30 frames before read failure; static predecessors support an OpenFile/prompt path, not completed open |
| `tests/DesktopJobProbe.cs`, `tests/desktop-job-boundary.ps1`, `docs/background-desktop-job.md` | Restricted desktop job diagnostic | Synthetic job/desktop denial and isolated Cubase starts observed, including detached holder; no continuous foreground proof |
| `tests/DetachedHolderProbe.ps1`, `tests/DetachedHolderStarter.ps1`, `tests/detached-holder-pipe.ps1` | Detached holder pipe check | Synthetic long-lived holder closes caller pipes; existing-instance guard also passed |
| `docs/project-save-command.md` | Fixed Save binding contract | Installed example confirmed; noninteractive and completed save unverified |
| `native/bridge/CubaseMcpProjectOpenProbe19.cpp`, `native/ProjectOpenProbe19Loader.cs`, `native/ProjectOpenJobAudit19.cs`, `scripts/*ProjectOpenProbe19.ps1` | Fixed isolated open diagnostic | One submission returned 0; moved-project dialog appeared, outcome unknown and no replay |
| `scripts/Observe-ProjectOpen19.ps1`, `docs/project-open-observer-19.md` | Bounded background observer | 546 polling samples, private dialog observed; transient events can be missed |
| `scripts/project-moved-prompt-19-inspect.py`, `docs/project-moved-prompt-19.md` | Moved-project prompt follow-up | Fixed-build path-comparison and parameter branches traced; no prompt-free lifecycle established |
| `native/bridge/CubaseMcpProjectOpenProbe20.cpp`, `native/ProjectOpenProbe20Loader.cs`, `native/ProjectOpenJobAudit20.cs`, `scripts/*ProjectOpenProbe20.ps1`, `scripts/Observe-ProjectOpen20.ps1`, `scripts/Prepare-ProjectOpen20Fixture.ps1`, `docs/project-open-probe-20.md` | Fixed same-directory isolated open diagnostic | One submission returned 0; private project-activation prompt appeared, outcome unknown and no replay |
| `scripts/Read-ProjectWindowControllers20.ps1`, `docs/project-window-controller-20.md`, `docs/project-activation-prompt-20.md` | Read-only window inventory and prompt research | Three unlocked list entries observed; prompt translation reference located, display branch unknown |

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
| 2026-11-10 | Added revision 3.5 bank insert viewers and traced save alert and activation provenance; real mapping and project lifecycle remain unverified. |
| 2026-11-10 | Measured the 3.5 no-write status timeout and current informer snapshot; traced host-open, second-instance, save-preflight and queue-consumer paths without invoking a project operation. |
| 2026-11-10 | Verified one isolated in-process path-class lookup and release; traced open enqueue, save preflight and MIDI scanner follow-ups without a project action. |
| 2026-11-10 | Verified a synthetic Unicode path-object setter and field split in the isolated host; checked current scanner receiver and traced open/save decision paths. |
| 2026-11-10 | Observed a bounded project candidate/root match and traced calling-thread dispatch, save and scanner branches; no lifecycle operation or MIDI transmission was performed. |
| 2026-11-10 | Added selected-channel runtime guards and plug-in feedback invalidation, corrected verifier write/restore sequencing, and installed 3.6; 84 tests passed, live activation unverified. |
| 2026-11-10 | Added restricted desktop job and detached holder, restarted owned Cubase with 3.6, and recorded a no-write status timeout; no project lifecycle completion claimed. |
| 2026-11-10 | Submitted one fixed isolated copied-project open and observed a private working-directory dialog; open remains unknown and was not replayed. |
| 2026-11-10 | Added explicit same-directory startup sampling, verified detached launch and empty MIDI model, and submitted one distinct same-directory open; activation prompt observed, outcome unknown. |
| 2026-11-10 | Added and installed guarded instrument/strip parameter banks, passed 89 tests, and captured one isolated thread context; live mapping and project lifecycle remain open. |
| 2026-11-10 | Added and installed guarded edit-lock setter, passed 91 tests, traced activation and a tempo-field import path, and observed two root/path candidates; synthetic clone validation failed. |
| 2026-11-10 | Linked DAWproject tempo parsing to the candidate host field, validated synthetic walks, and captured one truncated target stack consistent with OpenFile dispatch to the prompt. |
| 2026-11-10 | Observed empty startup and one fixed first-project submission; 3.8 mapping and MCP reads active, DirectAccess value and edit-lock round trips observed, separate track-volume binding write unverified. |
| 2026-11-10 | Added read-only CPR envelope and project-path diagnostics, traced New/Hub and save-path branches, and observed a second distinct unconfirmed bank-volume control submission. |
