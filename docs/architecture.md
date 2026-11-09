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
- `native/CubaseDesktop.cs` and `scripts/Start-CubaseBackground.ps1`: optional diagnostic launch on a separate desktop with a hidden console; hold native desktop/process handles until exit. An explicit existing CPR path is validated and recorded. No user preference rewriting or native project-creation claim.
- `native/CubaseDeviceRefresh.cs` and `scripts/Refresh-CubaseDevices.ps1`: isolated diagnostic for one fixed device-list notification. A worker thread binds to the private desktop, validates the target process/listener, restores its original desktop and reports delivery only. It is not an MCP backend or proof of a script reload.
- `scripts/verify-live.cjs`: real stdio MCP client, coverage-revision check, identity-guarded test writes and feedback verification. New results use a separate file from the previous live evidence.

## State and Outcomes

Host object IDs are not durable project identifiers. Discovery and mutation must use the same session and root. Mapping-page activation changes the session; removal callbacks revoke the affected observations. Runtime evidence is separate from protocol fixture evidence and static feature presence.

Every session-based operation checks the required bridge revision, host version, active mapping and session before dispatch, including the original discovery and mutation tools. An old controller returns `BRIDGE_UPGRADE_REQUIRED` before dispatch; a changed session returns `STALE_SESSION`. Status, capabilities and explicit connection reset report compatibility without performing host editing work. The doctor distinguishes MIDI/handshake availability from `readyForOperations`. This handshake does not reload a Cubase script.

Selected-track identity is read from the host before track control reads, feedback attribution and writes. A changed or unavailable identity clears cached track feedback; the optional expected identity rejects writes to another selected track. EQ, filter, send, instrument and five strip-slot bindings are obtained from the selected host channel. Send and cue-send counts come from the host with a bounded admission limit; unavailable branches are reported as errors. Meter controls are read-only. Control Room bindings use the declared root/main values and host-reported maxima for indexed groups, with a shared 16-channel admission budget; they are not evidence that the AI edition has those features.

The revision 3.3 source status is a compact handshake. Controls and control groups are independently paged with bounded page sizes, and descriptive metadata is bounded without shortening identifiers. `transport.get` reports available tempo/time setters along with observed callback values. Fixed insert viewers expose read-only values and identity-guarded actions; eight mixer bank slots bind basic controls with observed identity guards. Their live behavior is unverified. The controller emits a few lifecycle messages to Cubase's script console without request payloads or project contents; those messages are diagnostic, not a handshake.

An initial root discovery explicitly refreshes its DirectAccess snapshot. Parameter reads and child pagination do not rebuild it. Removal notifications revoke the removed object (or the root snapshot when its base is removed); ordinary change notifications preserve still-valid identities. Independent host-value callbacks supply control feedback. Native callback properties are written, never read back to copy a callback.

Parameter process/default values retain their native numeric range; reading them does not impose the normalized write range. Writes still validate their explicitly selected representation.

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

The separately approved fixed native DLL diagnostic acquired the real host and submitted one fixed read-only request in an isolated process; the correlated outcome was an error callback, not project data. Its loader, callback bounds, result and remaining threading uncertainties are in `docs/native-probe.md` and `docs/native-probe-loader.md`. It is not connected to MCP and does not change the single production transport.
