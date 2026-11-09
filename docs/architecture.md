# Architecture

```text
MCP client -> stdio SDK -> strict tool schema -> one MidiClient
  -> exact named Windows MIDI ports -> no-window virtualMIDI loopback host
  -> bounded SysEx frames
  -> Cubase ES5 MIDI Remote driver -> controller -> documented host API
```

The return path carries correlated replies. There is no adapter router, foreground process controller, network service, synthetic state provider or command replay queue in the Node server.

## Boundaries

- `src/server.ts`: named tools and explicit error results; no generic eval or arbitrary menu call.
- `src/config.ts`: literal background-only policy and exact port names.
- `src/bridge-contract.ts`: one required host version, bridge revision and active-session contract shared by server and doctor.
- `src/midi.ts`: native MIDI ownership, request IDs, timeout/cancellation uncertainty and fault latching.
- `remote/protocol.js`: shared ES5 codec, 7-bit ASCII JSON, bounded fragmented frames and checksum validation.
- `remote/controller.js`: host API operations, current mapping session, observed object/tag registry and command allowlist.
- `remote/CubaseAI_MCP.js`: top-level Cubase script entry. It constructs the controller without assuming the entry script has a CommonJS `module` object.
- `scripts/Install-Remote.ps1`: explicit file deployment only.
- `scripts/Install-Midi.ps1`: explicit, single-package prerequisite installation through WinGet.
- `native/MidiPortHost.cs` and `scripts/Start-MidiPorts.ps1`: same installed virtualMIDI driver, two loopback endpoints, no window or alternative transport. An explicit, correlated one-shot event snapshots client PIDs; it is diagnostic metadata, not a control path.
- `native/CubaseDesktop.cs` and `scripts/Start-CubaseBackground.ps1`: optional diagnostic launch on a separate desktop. The target is created suspended, assigned to a verified job limiting desktop creation/switching and bound to the job lifetime, then resumed only after checking the input desktop. An explicit existing CPR path is validated and recorded. A hidden holder is started without inheriting caller handles and writes explicit receipt/error logs to distinct runtime files; `starting` reports holder creation, not Cubase readiness. Input-desktop and foreground values are sampled, not continuous monitoring. No native project-creation claim; see `docs/background-desktop-job.md`.
- `native/CubaseDeviceRefresh.cs` and `scripts/Refresh-CubaseDevices.ps1`: isolated diagnostic for one fixed device-list notification. A worker thread binds to the private desktop, validates the target process/listener, restores its original desktop and reports delivery only. It is not an MCP backend or proof of a script reload.
- `scripts/verify-live.cjs`: real stdio MCP client, coverage-revision check, unique-ID and runtime-ID guarded test writes and feedback verification. A restore follows only an observed target value; uncertain writes or unobserved targets do not trigger another write. Each result uses a unique non-overwriting file.

## State and Outcomes

Host object IDs are not durable project identifiers. Discovery and mutation must use the same session and root. Mapping-page activation changes the session; removal callbacks revoke the affected observations. Runtime evidence is separate from protocol fixture evidence and static feature presence.

Every session-based operation checks the required bridge revision, host version, active mapping and session before dispatch, including the original discovery and mutation tools. An old controller returns `BRIDGE_UPGRADE_REQUIRED` before dispatch; a changed session returns `STALE_SESSION`. Status, capabilities and explicit connection reset report compatibility without performing host editing work. The doctor distinguishes MIDI/handshake availability from `readyForOperations`. This handshake does not reload a Cubase script.

Selected-track identity and runtime ID are read from the host before track control reads, feedback attribution and writes. A changed or unavailable identity clears cached track feedback; optional expected unique and runtime IDs reject writes to another observed selected-channel instance. Valid selected insert/strip plug-in-identity callbacks clear their own group's cached values. These checks are not atomic and callback provenance can remain uncertain. EQ, filter, send, instrument and five strip-slot bindings are obtained from the selected host channel. Send and cue-send counts come from the host with a bounded admission limit; unavailable branches are reported as errors. Meter controls are read-only. Control Room bindings use the declared root/main values and host-reported maxima for indexed groups, with a shared 16-channel admission budget; they are not evidence that the AI edition has those features.

The revision 3.8 source status is a compact handshake. Controls and control groups are independently paged with bounded page sizes, and descriptive metadata is bounded without shortening identifiers. `transport.get` reports available tempo/time setters along with observed callback values. Fixed selected-track and bank insert viewers expose read-only values and identity-guarded actions; eight mixer bank slots also bind basic controls, selection, filtering, EQ, sends, quick controls and instrument/strip values. Selected-instrument and bank instrument/strip parameter-bank writes and navigation require the exact single-control plug-in identity and current channel guards. Callback identity is not an atomic instance guarantee. Their live behavior is unverified. The controller emits a few lifecycle messages to Cubase's script console without request payloads or project contents; those messages are diagnostic, not a handshake.

An initial root discovery explicitly refreshes its DirectAccess snapshot. Parameter reads and child pagination do not rebuild it. Removal notifications revoke the removed object (or the root snapshot when its base is removed); ordinary change notifications preserve still-valid identities. Independent host-value callbacks supply control feedback. Native callback properties are written, never read back to copy a callback.

Parameter process/default values retain their native numeric range; reading them does not impose the normalized write range. Writes still validate their explicitly selected representation. The 3.8 edit-lock operation separately requires a discovered object/tag and matching `expectedLocked` before one DirectAccess setter call; its receipt is submission, not persistence or an atomic compare-and-set.

A mutation acknowledgement is not a transaction commit. The bridge reports host submission and available observations; timeout/cancellation after sending has an unknown outcome. A failed channel does not reopen itself. Explicit reset opens a fresh channel without replay.

Every request carries a required epoch deadline. The remote checks it immediately before dispatch on the mapping page's documented `mOnIdle(activeDevice, activeMapping)` callback. Expired work returns `REQUEST_EXPIRED` without entering a mutation. Protocol and runtime queues have fixed capacities. Request-ID tracking fails closed at 4096 entries per page session; page reactivation is required before starting another session. Connection reset does not bypass that registry.

Transport tempo and locator calls use `mTransport.mTimeDisplay.setTempoBPM` and the requested primary/secondary `MR_TransportTime.setTime` directly. They do not substitute commands or open transport windows. Numeric and display parameter setters similarly use only the explicitly selected representation.

Cubase owns the project, audio thread and plugin lifecycle. This server does not emulate application features absent from the public API. A legacy core chain was verified on AI16.0.5 in an earlier process; the current revision's mapping and live chain remain unverified.

## Initialization Boundary

The user explicitly approved one-time initialization in the isolated desktop. Those temporary controls live only under ignored `artifacts/setup`, are not callable through MCP, and are not a runtime fallback. Normal MCP requests remain MIDI-only. No logon autostart was added. The runtime state files identify the currently owned processes; an older exit record is relevant only when its process ID matches the current launch record.

## Native Interface Research

`scripts/inspect-cubase-ipc.cjs` is a separate read-only diagnostic, not an MCP backend. It collects endpoint/module metadata and parses selected installed PE files without loading them into Cubase or invoking their exports. It records candidate project-plugin and SKI dispatcher interfaces; no native editing ABI has been recovered or enabled. See `docs/native-interface-investigation.md` for evidence and the next discriminating checks. A future native path must be explicitly designed and verified; this research does not introduce automatic fallback.

`native/FactoryProbe.cs` and `scripts/Inspect-ProjectFactory.ps1` perform standard factory metadata queries in an independent process. The default mode creates no business object. The explicit `-ProbeProjectService` mode additionally validates an observed registered CID, acquires the observed project service interface through standard factory methods, records four method RVAs and releases it. That mode succeeded without changing the factory visibility gate. It does not attach to Cubase, provide host context or invoke a project request, and it is not part of the MCP execution path. See `docs/native-factory-recovery.md` and `docs/host-project-api.md` for the distinction between recovered static/native metadata and unverified live operations.

The additional `-ProbeEmptyRequest` mode invokes only the statically verified empty-input branch, with no output receiver or host context. It returned 1/status 4 in the independent process. There is no arbitrary request option and no live project result. The native module-loader-to-interface-container path and a live read-only registry snapshot are documented in `docs/host-registry-access.md`; they still do not constitute a verified project-editing backend.

The separately approved fixed native DLL diagnostic acquired the real host and submitted one fixed read-only request in an isolated process; the correlated outcome was an error callback, not project data. Its second, mutually exclusive fixed entry performed one path-class lookup and returned from releasing the temporary matching interface. A separately named fixed diagnostic image performed one synthetic Unicode path setter and direct object-field comparison. None is connected to MCP or establishes a project lifecycle operation. Loader, callback bounds, results and threading uncertainties are in `docs/native-probe.md` and `docs/native-probe-loader.md`.

`scripts/Read-MidiHostEnvironment.ps1`, `scripts/Read-MidiPortInformer.ps1`, `scripts/Read-MidiScannerState.ps1`, `scripts/Read-DawprojectHostContext.ps1` and `scripts/Read-DawprojectRootField.ps1` are separate version- and process-validated read-only diagnostics for the MIDI Remote model, informer, scanner and project host context, not control paths. Static DAWproject filter inspection and an independent factory metadata query likewise do not introduce a project backend; their scope and unresolved host/import contracts are in `docs/midi-host-environment.md`, `docs/midi-host-port-adapter.md`, `docs/midi-informer-source.md` and `docs/dawproject-host-filter.md`.

`scripts/Trace-MidiStartup.ps1` samples bounded project/listener/informer state, private window titles and input-desktop/caller-foreground observations in an explicitly identified isolated process. Its prearmed mode requires an explicit existing next CPR in the previous owned project directory and waits for a matching restricted-job launch receipt; it does not launch or control Cubase and is not connected to the MCP server. These sequential samples are not a continuous event history. `docs/project-open-routing.md` and `docs/project-lifecycle-dispatch.md` distinguish observed shell registration and a generic dispatcher from a verified unattended project-lifecycle API.

The separately named probe 20 is a fixed isolated research operation, not a second production transport. Its one-shot admission and observer-lifetime contract guarded one same-directory copied-project submission, which reached an activation prompt with an unknown outcome; it provides no general project call or completion guarantee (`docs/project-open-probe-20.md`).

`scripts/Read-ProjectWindowControllers20.ps1` provides a separately bounded, read-only inventory of window/controller-shaped fields for that exact process lifetime. Unknown window types are not dereferenced as controller interfaces. The unlocked inventory is not a lifecycle completion or active-document API.

`native/ActivationSnapshot21.cpp` is a fixed external process-snapshot diagnostic for one isolated process and thread. It records only that thread's captured control registers; the OS snapshot may affect scheduling and does not provide simultaneous stack bytes. It is neither an MCP transport nor proof of a dialog call chain.

`native/ActivationClone22.cpp` is a synthetic-only clone/unwind diagnostic. The separately built, fixed-identity `native/ActivationClone23Target.cpp` and its one-shot wrapper produced one truncated target walk; `scripts/project-activation-stack-23-inspect.py` independently checks static call predecessors for selected recorded RVAs. These research tools are not MCP control routes, do not prove a completed project operation, and their snapshot, module-identity and cleanup limits are recorded in `docs/project-activation-clone-23-target.md` and `docs/project-activation-stack-23.md`.

The file-only inspectors in `scripts/project-host-open-interface-inspect.py`, `scripts/project-instance-routing-inspect.py`, `scripts/project-save-preflight-inspect.py`, `scripts/template-startup-path-inspect.py` and `scripts/midi-project-queue-consumer-inspect.py` document fixed-build candidate paths, not execution paths. `scripts/Read-PluginContextStatic.ps1` separately checks the statically located host-context vtables, path-factory registration record and bounded CID-registry membership in the owned isolated process using read-only memory access. A shipped component's host-interface project-open call has been located; fixed path-service lookup and a single path-object setter succeeded, but component context delivery, project-call thread, prompt and completion contracts are unresolved. The candidate second-instance route also contains a state-dependent foreground call. The runtime remains the single MIDI Remote transport, and none of these observations constitutes project creation, saving or editing.

`scripts/Read-ProjectCandidates.ps1` and `scripts/project-candidate-provenance-inspect.py` separately observe bounded document candidates and verify their fixed-build root-field provenance. `scripts/project-open-16-snapshot.ps1` reads the thread-sensitive host-open predicate's backing state without invoking it; the corresponding disk-only inspectors examine open dispatch, save and MIDI scanner branches. These are diagnostics, not control paths or evidence of lifecycle completion. See `docs/project-candidate-observation.md`, `docs/project-open-16.md`, `docs/project-create-save-16.md` and `docs/midi-activation-16.md`.

A fixed session 19 diagnostic submitted one host-open call for an owned copied CPR. It is separately named, one-shot, PID/build/fixture/job checked and not connected to the MIDI-only MCP runtime. A private moved-project dialog appeared; no dialog action or completion was observed. The separate observer is polling-based and its coverage is limited. See `docs/project-open-probe-19.md`, `docs/project-open-observer-19.md` and `docs/project-moved-prompt-19.md`.
