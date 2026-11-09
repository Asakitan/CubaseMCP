# Fixed Native Diagnostic Loader

This explicit developer diagnostic loads only `artifacts/native-probe/CubaseMcpNativeProbe.dll` into the owned private Cubase test process. The user specifically approved this module loading and in-process read-only diagnostic. It is not an MCP backend, a generic injection tool, or a fallback execution route.

The wrapper requires the current private launch receipt and an explicit confirmation switch. The loader checks the executable path, AMD64 PE profile and timestamp, observed private-desktop window and process creation time. It resolves the real owner of `LoadLibraryW`, matches that module in the target and computes its relocated function address. Probe export parsing reads PE data without loading the DLL into the helper. The loaded 64-bit module address comes from module enumeration, not a truncated thread exit code.

The module load and the selected fixed `StartProbe` or `StartPathProbe` entry are each attempted once with bounded waits. The path entry is available only through `scripts/Invoke-PathServiceProbe.ps1` and its hardcoded loader method; the loader accepts no arbitrary module path or export. A pending load retains its path buffer because freeing memory still used by the thread would be incorrect; this is reported, not retried. The module's result file is separate from the loader receipt. Module loading and temporary host-object allocation change the approved test process even though the path diagnostic does not open or modify a project. No Cubase instructions, interface tables, project data, licensing state or foreground controls are patched.

## Validation

The C# loader compiled and the wrapper parsed before an explicitly approved invocation in isolated PID 58536. The module was loaded, its fixed entry returned 1, and its report recorded `queryResult:0`, `hostMatch:true`, and `requestSubmitted:false`. Evidence is in `artifacts/native-probe/loader-58536.json` and `result-58536.json`. This validates module loading and interface acquisition for that process; it is not evidence of a project read.

The later request-capable build was loaded into isolated PID 66528. `StartProbe` returned 0 for worker launch; the worker acquired the host and recorded `requestId=callbackId=1`, `requestReturn=0`, and `host_error_callback`. No project response was obtained. That process has since exited. Evidence: `artifacts/native-probe/loader-66528.json` and `result-66528.json`.

For the current asynchronous probe, only entry return code 0 means that the worker was launched. The wrapper exits with an error for nonzero entry codes or an incomplete entry; the separate worker report remains authoritative for the request outcome.

The path entry ran once in isolated PID 39068: the loader reported entry return 0 and its separate worker result recorded a successful fixed IID lookup, matched `FNPath` vtable and returned release call. The worker start and result records identify thread 39876; they do not establish host-thread affinity for a project operation. See `docs/native-probe.md` for the evidence and limits. The module is pinned; neither entry is replayed in that process.

`tests/probe-wrapper-policy.ps1` checks both fixed wrappers' entry-result guards for successful submission, nonzero entry returns, incomplete entries and loader errors; it does not launch or attach to Cubase.
