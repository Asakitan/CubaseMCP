# Project Host Registry Access

Date: 2026-11-10. Static inspection of the locally installed Cubase AI 16.0.5 executable; RVAs and raw interface IDs apply only to that build. No code was injected, no process memory was written, and no host registry call was made.

## Registry route

The global request-bearing `ProjectPluginHost` subobject is at executable RVA `0x58d1780`, constructed as part of the object at `0x58d1770`. Function `0x1dd0340` passes that subobject to `0x3aa3230`. That routine obtains the singleton at `0x599cba0` through `0x3aa5890`, locks its subobject at offset `0x20`, and passes its vector at offset `0x08` and the host pointer to `0x3ad8100`, which appends the pointer. It then unlocks.

The singleton's vtable at `0x48274f0` has RTTI `Steinberg::StandardPluginContext::InterfaceContainer`. Slot 0 is `0x3aa8620`: it locks, loops through the registered pointers, calls each pointer's slot 0 with the caller's IID and output pointer, and returns zero on the first successful call. If none succeeds it clears the output and returns `0x80004002`.

The host subobject's queryInterface recognizes raw IID bytes `f1 79 58 57 70 b2 bf 48 82 1d be 11 9c d3 83 5f`, increments the reference and returns the host subobject. Consequently, **if** a caller receives this exact container and the host has been registered, a query of that IID has a statically established path to the request-bearing interface. A caller receiving or querying it has not been observed at runtime.

On 2026-11-09 at 15:41:12.496 UTC, a read-only snapshot of isolated Cubase PID 42240 found the host subobject at `0x1458d1780`, vtable `0x144305018`, and the container at `0x14599cba0`, vtable `0x1448274f0`, matching the static RVAs at image base `0x140000000`. The container held an 88-byte list of 11 pointers; the host address appeared at indices 0 and 6. The process was alive at the check. Evidence: `artifacts/ipc/host-registry-live-20261110.json`. This confirms registration in that process at that instant, not that an external factory obtained the context or that any project call succeeded.

The constructor `0x3a9ffa0` installs an `FServiceManager` vtable and, when its second argument is nonzero, adds the singleton to a collection. Function `0x3aa5d80` used by the host's service lookup is distinct: it searches another object's `[+0x28,+0x30)` pointer range, compares 16-byte fields of each record to fields in its key object and returns the matched record's pointer at `+0x10`; it must not be conflated with the container's IID query.

## Native module factory context

The native module path has a direct delivery route to this same container. `Steinberg::FModule` vtable `0x482a750`, slot 30, points to executable RVA `0x3aba9a0`. That method resolves the `GetPluginFactory` export and invokes it, queries the factory with raw IID `ab a2 55 45 23 c1 57 4e 9b 12 29 10 36 87 89 31`, and, if that query succeeds, calls the resulting factory's slot at vtable offset `0x48`. The IID and slot correspond to `IPluginFactory3::setHostContext`; the second argument is the return of `0x3aa5a90`, which is an unconditional jump to the `InterfaceContainer` singleton getter `0x3aa5890`.

Thus a factory implementing that interface **and loaded through this `FModule` method** receives the registry container as its factory host context. Its query for the project-host IID follows the container route described above if registration has completed. This is static evidence of the object and call sequence, not a runtime test or a claim that simply placing a third-party DLL in `Components` makes Cubase discover or accept it. Module discovery, class category admission, registration order, callback lifetime, and background behavior remain unverified. The independent factory probe in `artifacts/ipc/service-probe-20261110.json` confirms the observed project component's service interface creation in a separate process; it is not evidence of in-host context delivery.

The component registry has a class-enumeration path at RVA `0x3aa2900`, slot 7 of its secondary vtable at `0x4827328`. After matching a supplied factory to an `FModule`, it calls factory vtable offset `0x20` (`countClasses`) at `0x3aa2a28`, skips the loop if the result is nonpositive, and obtains each indexed class description through the factory3, factory2, or base-factory metadata slots. It then uses the metadata category field in a registration lookup. This establishes the count bound for this path, not the whole set of possible registration mechanisms or class activation semantics.

An independent standard metadata query recorded in `artifacts/ipc/service-registration-20261110.json` found class 0 category `Service`, name `Project Plugin Component`, cardinality 1, and CID bytes `81 18 fa 7c 4d e5 50 4e 8a 01 de 63 b1 64 f7 42`. The factory returned `countClasses = 0` in that probe, despite allowing `getClassInfo(0)` and direct creation with the observed CID. The zero count means the observed registry enumeration would not visit class 0 under that independently observed factory state; it does not prove the count in the live host or exclude another admission mechanism.

## VST host context limitation

The RTTI `Steinberg::VstHostContext` has secondary vtable at RVA `0x43754a0`, whose slot 0 thunk `0x201a434` delegates to `0x201ab00`. This query method matches only raw IIDs `0000000000000000c000000000000046`, `cc95e5582ddb69498b6aaf8c36a664e5`, and `904f463d97473b4fb98d3fc15f00bc95`; unmatched IIDs clear the result and return `0x80004002`. The project-host IID is not among those matches, and this method does not delegate to the registry.

The binary identifies the class as `VstHostContext`, but this inspection has not established which concrete context is supplied to every VST3 plugin initialization or whether another documented component-loading path supplies the `InterfaceContainer`. Therefore, it does not establish a usable VST3 bridge route or rule out another context. Registration timing, ownership, lifetime and host-thread constraints remain unresolved.

## Reproduction and next step

`python scripts/host-registry-disasm.py --range container_query` prints a bounded static disassembly; other named ranges are `register`, `singleton`, `register_item`, `vst_query`, `manager_constructor`, `host_query`, and `module_factory`. The script reads the executable on disk and uses `pefile` and `capstone`; it does not inspect a running process.

Next, trace module discovery and the service category's class activation, then establish whether the host registers the project interface before factory context use. Validate the ordinary component lifecycle and lifetime before attempting a copied-project read-only query. No project query, mutation, or project creation was attempted by this investigation.
