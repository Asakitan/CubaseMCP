# Native Factory Registration Recovery

Date: 2026-11-10. Scope: read-only static inspection of the installed Cubase AI 16.0.5 `projectplugin.dll` and `hostchannelaccess.dll`, together with the existing independent standard-factory probe documented in `native-interface-investigation.md`. RVAs refer to this installed build, not a stable external ABI. No native business-object creation, host-context call, gate modification, process injection, or licensing check was performed for this analysis.

## Registration and visibility

Both `GetPluginFactory` implementations allocate a `0x208`-byte factory and initialize byte `+0x200` to zero. The singleton pointer is at RVA `0x43760` in `projectplugin.dll` and `0x18a68` in `hostchannelaccess.dll`. The project factory's primary vtable is at RVA `0x34470`; the channel factory's is at `0x11f30`.

| Zero-based primary vtable slot | Project RVA | Channel RVA | Observed behavior |
| --- | --- | --- | --- |
| 4 | `0x27660` | `0x9d30` | `countClasses` checks byte `this+0x200`; it returns zero when the byte is zero, otherwise delegates to the underlying count. |
| 5 | `0x42b0` | `0x3870` | `getClassInfo` tests the requested index against the internal count at `this+0x1e0`; the observed method does not directly check `+0x200`. |
| 6 | `0x3ec0` | `0x3480` | `createInstance` searches the internal table by CID, invokes the matching record's constructor, then queries the resulting object's requested interface and releases it; neither complete method directly checks `+0x200`. |
| 9 | `0x276b0` | `0x9d40` | Context-related method described below; its exact interface and semantic name remain unresolved. |

The creation methods inspect the internal count at `+0x1e0`, table pointer at `+0x1d8`, record stride `0x488`, CID at record `+0x1b8`, and constructor callback at record `+0x470`. A failed lookup, construction, or interface query returns `0x80004002` and clears the output pointer. A zero public class count therefore does **not** establish an empty internal registration table. Nor does the absence of a direct gate check establish that construction or subsequent interface behavior succeeds: constructor-internal prerequisites and side effects remain unverified.

The registered CID bytes are copied into the registration description before its registration call:

| Component | CID bytes in memory order | Constant RVA | Registration evidence |
| --- | --- | --- | --- |
| Project | `81 18 fa 7c 4d e5 50 4e 8a 01 de 63 b1 64 f7 42` | `0x34540` | `0x27951` loads the constant and `0x27959` stores it at registration-description RVA `0x437e0`; `0x27843` calls the registration routine. |
| Channel | `3e 4a 09 4e 3b 0d 47 75 a6 5e 67 07 a8 a3 70 c9` | `0x12000` | `0x9fd3` loads the constant and `0x9fdb` stores it at registration-description RVA `0x18ac0`; `0x9ecf` calls the registration routine. |

The independent probe observed zero through public `countClasses`; it did not inspect the live internal count or create a business object. The count result must not be conflated with the internal table count.

## Context-related gate

Each slot 9 implementation queries its supplied object through vtable slot 0 using the same 16 IID bytes, `c7 dc eb ad 94 44 0b 43 ab 1c 9a 17 4c e0 06 f5` (project RVA `0x34530`, channel RVA `0x11fe8`). On successful acquisition it calls the acquired interface's slot 3 with that component's own CID and integer `1`; a zero result sets factory byte `+0x200` to one. It releases the acquired interface and, when the byte is set, transfers control to the corresponding base routine. A failed acquisition or check leaves the byte unchanged and returns a failure status.

This is evidence of a host-supplied, CID-dependent check, not identification of its interface name, purpose, policy, authorization semantics, or a supported method for supplying context. No conclusion is drawn that this is ordinary initialization or a licensing mechanism. No gate was changed or simulated.

## Bounded next investigation

Recover authoritative declarations or independent static cross-references for the shared IID and its slot 3 before identifying the contract. The initial static analysis did not execute business-object creation. Project creation, event editing, export, and complete background MCP coverage remain unverified and unimplemented by this investigation.

## Independent service-interface probe

After the static review, `native/FactoryProbe.cs` gained an explicit `InspectProjectService` operation, selected only by `scripts/Inspect-ProjectFactory.ps1 -ProbeProjectService`. The default metadata operation is unchanged. The new operation checks the observed registered CID through standard `getClassInfo(0)`, requests the observed service IID through standard `IPluginFactory.createInstance`, records four vtable entries, and releases the interface. It never sets the factory gate, supplies a synthetic host context, invokes a service request, attaches to Cubase or edits a project.

The separate PowerShell probe completed with return value `0` and a non-null interface even though public `countClasses` still returned `0`. The interface vtable RVAs were `0x11e24`, `0x7c88`, `0x11ed8`, `0x11ef0`, matching the statically recovered service. Evidence: `artifacts/ipc/service-probe-20261110.json`, probe PID `50864`, UTC `2026-11-09T15:19:24.9571228Z`. The real Cubase process remained separate.

This proves that the observed service interface can be instantiated in the diagnostic process without forcing the visibility gate. It does not establish a valid Cubase project context, a request ABI, successful project enumeration, or a production native backend.
