# MIDI Remote Script-State Investigation

Date: 2026-11-10. Target: installed Cubase AI 16.0.5 Windows x64. Static observations are specific to this build. The bounded live observations below used only `OpenProcess` and `ReadProcessMemory` on the explicitly identified private process; there were no function calls, process writes, debugger attachment, foreground input, or restarts.

## Error output path

The native function at RVA `0x26749a0` obtains a message through `0x347e330` from its object's `+0x40` member. It writes the literal `js script error:` and then that message through the import at RVA `0x4162960`, identified in the PE import table as `MSVCP140.dll`'s `std::cout`; it also constructs a string and passes it to the object's vtable slot `+0x18`. This is an observed code path, not evidence that it ran in the current process, that a particular controller failed, or that the process's stdout is captured. Output already emitted before a capture was attached is not recoverable from this fact alone.

The `private_loadScriptFile`-named function `0x2674fe0` references `json` and sends the text `loading script` through a virtual method at `0x2675a8f`. The meaning, destination, and persistence of this notification are unresolved. A targeted read of the Cubase profile and MIDI Remote directories found no recent obvious script-error log; that filename-based search does not rule out a differently named log or another location.

## Script-state container

Getter `0x262df50` returns the singleton at module RVA `0x590a1b0`; its initializer calls the `SystemRoot` constructor `0x25e99d0`. That constructor installs the RTTI-identified `SystemRoot` vtable RVA `0x4454c88` and initializes the three vector pointers at offsets `0xd0`, `0xd8`, and `0xe0`. The `private_loadScripts` callback at `0x2619a00` appends a 16-byte shared-pointer pair to this vector. The nested type name describes `shared_ptr<UIScriptState>`; the field layouts and actual script identity are not established by the count alone.

On 2026-11-09 at 16:25:02.795 UTC, PID `66528` was alive and its read-only snapshot had image base `0x140000000`, root `0x14590a1b0`, expected vtable `0x144454c88`, and vector `begin=0xa99753e0`, `end=0xa99756f0`, `capacity=0xa99757d0`. The 784-byte range contains 49 non-null object/control-pointer pairs. At 16:25:28.221 UTC, the first and last object vtable pointers were both `0x14445a1a8`; its static RTTI identifies `Steinberg::Lego::MidiRemote::ScriptBinding::JavaScript::JSState`. These two spot checks do not establish the types or status of every entry, the file paths, device instances, port routing, or whether the requested controller loaded or responded.

One initial vtable-read command failed before reading an object because PowerShell treated a hexadecimal pointer as signed; a later bounded read using an unsigned conversion succeeded. No state was changed.

## Console and target-path follow-up

At 2026-11-09 16:33:18.246 UTC, an isolated hidden helper attempted to attach to PID `66528`'s existing console, with no input or window activation. `AttachConsole` returned Win32 error `6`; the target was alive both before and after. Thus no console buffer was read. This does not establish that no script error occurred. Evidence: `artifacts/ipc/midi-console-snapshot-66528.json`; the helper is `scripts/Inspect-CubaseScriptState.ps1`.

At 16:33:32.907 UTC, bounded reads found the first and last `JSState` objects' `+8` backing pointers, whose vtable `0x14445a170` has static RTTI name `JSState::InnerState`. Method `0x32cd660` treats the inner object's `+8` string as a path. At 16:34:14.434 UTC, the root vector remained unchanged across a bounded 49-entry read with zero per-entry read errors, and the first entry's path string matched `C:\Users\99325\Documents\Steinberg\Cubase\MIDI Remote\Driver Scripts\Local\CubaseAI\MCP\CubaseAI_MCP.js`. Evidence: `artifacts/ipc/midi-script-state-observation-66528.json`.

The matching `JSState` object is evidence of an associated script state, not successful evaluation, current installed revision, active device instance, MIDI binding, or response.

## Target script error history

The error handler's virtual notification targets `0x3228420`. The callback RTTI names it `ScriptStateBase::addErrorMessage`; its dispatched lambda `0x32285e0` obtains the `ScriptConsole` singleton at RVA `0x596eae0` and calls its slot `+0x08` (`0x32cf420`). That routine finds a path-keyed tree entry and appends a 48-byte message record with an embedded string to a vector at node offset `0x40`.

At 2026-11-09 16:35:23.311 UTC, a bounded read of that singleton in alive PID `66528` found its expected vtable `0x144609d58`, 49 tree nodes, and the target script's path. Its two records were `loading script` (kind 1) and `ReferenceError: identifier 'module' undefined (line 7)` (kind 0). Evidence: `artifacts/ipc/midi-script-console-66528.json`. This establishes a recorded target-script evaluation error, not exactly when it happened, the full causal chain, or whether any subsequent attempt succeeded. It is consistent with the observed timeout; resolving and live-verifying the installed script remain separate work.

Read-only inspection of the installed entry file confirms line 7 is `module.exports = deviceDriver;`. Its earlier lines call `require('midiremote_api_v1')` and `require('./controller').createController(api)`. The error is associated with the entry script at that line; the ordering alone does not establish successful device activation or port binding.

The installed Steinberg factory example `midiremote_factory_scripts/Public/akai/apcmini/akai_apcmini.js` imports the MIDI Remote API, creates its device driver at entry-script scope, and has no `module.exports` at its end. This example is consistent with an entry-script environment distinct from CommonJS modules; it does not establish that removing the failed line would make this controller initialize or respond.

## Reproduction and next step

Run `python scripts/midi-script-state-inspect.py --target script_error`, `system_getter`, `system_construct`, `load_scripts`, `load_script_file`, or `script_callback` to inspect the corresponding bounded function from the executable on disk. The script uses `pefile` and `capstone`; it does not connect to a process. Generated disassemblies and RTTI reports are archived under `artifacts/research/session-08`.

For a current private process, `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Read-MidiScriptErrors.ps1 -TargetProcessId PID` performs a read-only diagnostic and emits JSON. It requires `artifacts/runtime/cubase-launch.json` to name that PID and `winsta0\CubaseAI_MCP`, checks executable path, file version `16.0.5.174`, expected image base and process start against metadata, and verifies at least one target-owned window on the private desktop by enumeration without activation. Window enumeration does not prove that every target thread belongs to that desktop. The script verifies the ScriptConsole vtable, bounds traversal to 256 nodes, limits strings to 4096 bytes and matched messages to 512, and emits records only for the fixed MCP entry path. It checks the tree header and count again after traversal; this reduces but does not eliminate concurrent-mutation risk. Failures return JSON with `status: error` rather than asserting an empty log. Access to the process and private desktop may require elevation.

A focused invocation against PID `66528` at 2026-11-09 16:38:15 UTC passed those guards, observed 15 target-owned private-desktop windows, traversed 49 nodes and reproduced both messages above. The process remained alive. This is a snapshot and does not replace a fresh check after reload. An attempted direct `GetThreadDesktop` check returned access denied; the working diagnostic uses private-desktop window ownership instead and does not switch desktops.

The entry's top-level export was removed and a regression reproduced the original failure before the fix. On a later private launch, PID 17596 logged `controller constructed 2026-11-10-coverage-3.1` and no script error, but no device/mapping activation or MIDI input log was observed after a real status request timed out. Both virtual ports initially reported PID 17596 as a client; after the subsequent controlled port-host restart, the new endpoints did not. These observations narrow the issue to device/mapping activation or routing; script construction and open ports are not a handshake. Evidence: `artifacts/ipc/midi-script-trace-after-request-17596.json` and `artifacts/ipc/midi-clients-after-hotplug-17596.json`.

The later isolated PID 45628 opened a separate experimental project copy whose existing saved MIDI Remote instance block was changed to reference the target driver and port names. It logged construction of revision 3.2; both endpoints listed it as a client, but a status request timed out and the console still showed no activation. Opening the copy does not prove that Cubase accepted or instantiated its edited metadata. Evidence: `artifacts/ipc/midi-device-test-after-request-45628.json` and `artifacts/ipc/midi-device-test-clients-45628.json`.

After revision 3.3 was installed, a new isolated PID 3720 opened the same test copy, both endpoints listed it as a client, and the target script console logged construction without device/mapping activation. A focused live verifier timed out on status before any write. Evidence: `artifacts/ipc/midi-clients-coverage-3.3-3720.json`, `artifacts/ipc/midi-script-after-request-3.3-3720.json`, and `artifacts/live-smoke/verification-coverage-3.3-3720.json`.
