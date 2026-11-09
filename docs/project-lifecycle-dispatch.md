# Project Lifecycle Dispatch: Static Follow-up

Target: installed Cubase AI 16.0.5, Windows x64. This is read-only analysis of executable bytes, not a supported ABI. No project creation, save, process modification or UI action was performed.

## Generic dispatcher provenance

The generic dispatcher holder at executable RVA `0x5890930` used by `ProjectPluginHost::request` is initialized through `0x39b3890`. At `0x39b3913`–`0x39b3927`, when the caller-supplied enable flag is set, this routine swaps a shared object and reference-control pointer into the holder. Its one direct caller found by bounded direct-call scanning is `0x15e7bb0`, which passes the string `com.steinberg.dispatcher` at `0x4197a30`, obtains a configuration value, substitutes `4` when it is zero, and clamps it to `0x10`; it also passes another value `2`. The actual meanings of those numeric parameters are not established.

The shared-object builder `0x39b3790` allocates `0x378` bytes and calls `0x39b3e50` for the object at allocation `+0x10`. That constructor installs primary vtable `0x47aa350`; its RTTI identifies `Steinberg::Detail::Dispatcher`. This confirms an actual generic dispatcher object and its registration path. It does not identify a host-main-thread executor, establish task affinity or ordering, or prove that a worker-originated request will be delivered on the project lifecycle thread. The previously observed holder check can also fall back to inline execution when null and is subject to a race if checked separately.

## Save dispatch and lifetime limits

The ordinary existing-path `Save` branch and the application's `PArrangement` save path are traced in `project-lifecycle-contract.md`; the file destination, potential deletion and internal error/retry branches are recorded in `project-save-target.md`. The `Save` dispatcher obtains the current document through application vtable `+0x1c0`, retains the returned path object from document `+0xe0` in local smart-pointer-like storage, and calls application vtable `+0x1c8`. The static `PCubaseApplication` vtable resolves these to `0x1d3a220` and `0x1d57900`; the actual application-vtable match was observed only in the isolated process described in the earlier document.

Neither this dispatcher's calling thread nor the identity/lifetime of the current document is guaranteed by these static observations. The `PArrangement` method can construct a transformed working path, reach `CreateFileW(CREATE_ALWAYS)` and conditional `DeleteFileW`, serialize project data, and enter a state-dependent error helper with possible internal retry. The returned byte and actual flush/error propagation are not fully characterized. It remains unsafe to infer success from a simple immediate return or to infer windowlessness from skipping initial path selection.

## Next discriminating work

Trace the host's actual main-thread lifecycle event/dispatcher and its callback lifetime from a proven existing call site, then complete the file replacement and failure-result mapping. Separately recover an actual project creation entry and document ownership; no currently identified generic creation slot establishes it. Only with those prerequisites and a disposable project should a controlled future test check exact destination, emitted events, disk state and reopen semantics. No such execution is claimed here.

`E:\Py\python.exe scripts/project-lifecycle-dispatch-inspect.py` checks the PE machine, timestamp and image base before printing selected fixed disassembly ranges without opening a process.
