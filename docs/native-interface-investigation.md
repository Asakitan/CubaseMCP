# Native Interface Investigation

Date: 2026-11-10, local time. Target: installed Cubase AI 16.0.5 on Windows.

## Scope

The user requested investigation of RPC and other native interfaces for project creation, MIDI/audio event editing and parameterized export without disturbing foreground work. MIDI Remote's limitations do not establish that these operations are impossible through Cubase's internal interfaces.

This investigation uses installed-binary analysis, process metadata and independent factory probes. It does not connect to candidate endpoints, load new modules into Cubase, suspend it, change its memory, operate windows, restart it or change preferences. The production MCP remains MIDI-only; no fallback was added.

## Evidence

Run `node scripts/inspect-cubase-ipc.cjs` for console output. `--output PATH` records a new JSON report and refuses to overwrite an existing file.

The completed report is `artifacts/ipc/inspection-20261110.json`, timestamp `2026-11-09T14:59:13.399Z` (November 10 locally). It contains ten parsed PE files, the live module list and endpoint metadata, with no reported collection or parse errors.

| Observation | Meaning and Limit |
| --- | --- |
| Cubase PID 11368 had no reported TCP listeners or UDP bindings | Snapshot only; does not exclude dynamically created endpoints, ALPC, pipes, shared memory or in-process interfaces. |
| Four pipe-name candidates contained Cubase and `.rt`/`.lic` | Ownership, protocol and purpose are not verified. Names alone are not evidence of an editing API; no requests were sent. |
| `hostchannelaccess.dll` was loaded; it and `projectplugin.dll` export `GetPluginFactory`, `InitDll`, `ExitDll` | Concrete component-factory entry points. Factory class IDs and supported interfaces are not recovered. `projectplugin.dll` was not in the captured loaded-module list. |
| Main executable contains `ProjectPluginHost::request` and `IProjectPluginRequestCallback` in RTTI-related text | Candidate request path, not a recovered callable function or wire format. String RVA `0x5566260`. |
| Main executable contains `ISkiDispatcher` and `ISkiDispatcher2` | Candidate host dispatch interfaces. String RVAs `0x55e3570` and `0x55e35c0`. |
| `projectplugin.dll` contains `IProjectPluginService`, `IActionHandler` and project/storage notification names | Candidate project service and lifecycle contracts; service string RVA `0x42d18`. |
| Main executable contains `IProjectObject`, `IProjectIterator`, `ITrack`, `ITrack2`, `ITrack3` | Evidence of native project model interfaces, not proof of available mutation methods. |
| `linkservice.dll` imports socket APIs; Cubase and the scanner contain `RemoteExeAnon` pipe-name text | Distinct communication surfaces; they may serve unrelated subsystems. |
| `Components/Filters/dawproject.dll` was loaded | An interchange component is present; its existence does not establish live editing or parameterized rendering. |

The inspector checks normal imports, named exports and selected initialized-data strings. It does not inspect delay imports, decode all RTTI/vtables, enumerate all handle owners or recover method bodies. The main executable reached the 80-string output limit, so the report is explicitly not exhaustive.

## External Context

Historical VST3 launch coverage from January 2008 mentions optional SKI host integration. The old vendor technology URL redirects, and the current page did not yield verifiable documentation in this investigation. No current SKI SDK or interface declarations were obtained. Historical claims are therefore leads only, not evidence of the current SDK's availability or Cubase AI 16 functionality.

The locally observed SKI dispatcher names are verified strings, not a recovered SDK. Do not equate them with the separate SKI Remote product or a universal RPC server.

## Next Discriminating Work

1. Trace `GetPluginFactory` class registrations and host `queryInterface` calls in the project component; recover interface IDs and vtable shapes without invoking unknown methods.
2. Resolve cross-references to `ProjectPluginHost::request`, its callback and the SKI dispatcher to identify request parsing, response handling and the required host thread.
3. Trace one read-only project enumeration end to end before implementing mutations. Require an actual result from a copied test project, not just a successful call status.
4. For writes, identify the native undo/edit transaction and project lifetime rules before attempting one reversible MIDI-note change, one audio-event edit and one parameterized export.
5. Validate foreground focus and input behavior separately from project correctness and resource contention. A background API is not a guarantee of zero performance impact.

No complete live native client ABI or operation implementation is delivered yet. The next stage is interface recovery, not endpoint guessing or GUI automation.

## Factory Follow-up

The independent factory probe completed on November 10, with evidence at `artifacts/ipc/project-factory-20261110.json` (UTC `2026-11-09T15:05:54.0225521Z`). `native/FactoryProbe.cs` uses the standard `IPluginFactory` ABI; its wrapper loads only the two selected modules in the probe process, not in the running Cubase instance. No business object is created.

| Module | Factory query | Public class count | `createInstance` RVA |
| --- | --- | --- | --- |
| `projectplugin.dll` | Succeeded; vendor Steinberg Media Technologies | 0 | `0x3ec0` |
| `hostchannelaccess.dll` | Succeeded; vendor Steinberg Media Technologies | 0 | `0x3480` |

A bounded static disassembly of those two creation methods shows the same registration-table pattern: class count at `this+0x1e0`, table pointer at `this+0x1d8`, record stride `0x488`, two 64-bit CID comparisons at record offsets `0x1b8/0x1c0`, and a constructor callback at `0x470`. These are observations about this installed build, not a supported external ABI. The check did not reveal fixed private class IDs bypassing the empty registration table.

The concrete blocker is obtaining the host registration/context contract and a usable project service interface. The reason for the empty table has not been established; it must not be presented as proof that the components lack functionality. No broader host-initialization recovery or guessed method calls were performed. Project creation, note/audio-event editing and parameterized export remain unimplemented in MCP.

Reproduce the metadata check with `powershell.exe -NoProfile -File scripts/Inspect-ProjectFactory.ps1`; add `-OutputPath PATH` to save a new report. Existing reports are never overwritten.

## Session 06 refinement

The zero public class counts are now explained by an observed visibility gate, not an empty registration table. Standard `getClassInfo(0)` and `createInstance` remain implemented independently of that gate. After validating the observed CID, the explicit `-ProbeProjectService` diagnostic successfully acquired and released the observed project service interface in its own process, with return value zero and the expected four-entry method table. It did not modify the gate, invent host context or invoke a service request. See `docs/native-factory-recovery.md` and `artifacts/ipc/service-probe-20261110.json`.

The host request method, its callback path, the component service method, part of the JSON parser and an unexecuted `GetMusicalTrack` request have also been traced. See `docs/host-project-api.md`. The decisive remaining boundary is a valid connection to the live project host, including request/result ownership and thread rules. An independently instantiated service is not a live Cubase project.

The user approved R1 only for read-only inspection of the isolated Cubase process. R1 reported that its service lacks `SeLoadDriverPrivilege`, so the driver was not loaded and no R1 process-memory observation was obtained. These permission results do not change the production backend or justify guessing pointers.
