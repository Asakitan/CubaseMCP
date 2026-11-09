# Project and MIDI lifecycle contract investigation

Target: installed Cubase AI 16.0.5 Windows x64. This is static investigation, not a supported SDK, a client ABI, or evidence of a successful host operation. Addresses are RVAs specific to this installation. No Cubase process was opened or modified in this investigation.

## Project lifecycle

The existing `projectplugin.dll` request parser dispatches `ExportMix`, `CreateTracks`, `Transport`, `Locators`, and `GetMusicalTrack` as documented in `docs/host-project-api.md`. Its observed dispatch table is not a new/open/save/save-as project contract. Component export or creation of a project service object does not establish a live project owner, native main-thread access, project lifecycle arguments, or disk persistence.

The executable RTTI `SkiProjectController` has a complete-object vtable at `0x42df078` and secondary vtables at `0x42df0f0`, `0x42df118`, `0x42df148`, and `0x42df170`, with secondary offsets `0x10`, `0x18`, `0x20`, and `0x28`. Slot targets can be inspected with `scripts/project-lifecycle-inspect.py`. Their signatures and association with project creation or saving remain unproven. Treating an RTTI name or slot location as a lifecycle API would be speculation; no method here is exposed to MCP.

Steinberg's [VST 3 documentation](https://steinbergmedia.github.io/vst3_dev_portal/pages/Technical%2BDocumentation/API%2BDocumentation/Index.html) describes host persistence of plug-in component and controller state, not a demonstrated external Cubase project lifecycle interface. Plug-in `getState`/`setState` is not evidence that a complete project was saved.

## MIDI device notification and script reload

The executable's ASCII `USB Change Listener` string is at RVA `0x45d1b00`. A RIP-relative reference in the window class setup function `0x2f400a0` associates it with a window procedure at `0x2f401e0`. In that procedure, `0x2f40203`–`0x2f4021c` effectively compare the message to `0x219`, and `0x2f40222`–`0x2f40229` compare `wParam` to `7`. The matching branch calls a virtual method on a global object if non-null and conditionally invokes another function with `0xfa0`. Its callback identity, timing semantics, device enumeration effect, thread ownership, and relationship to MIDI Remote activation have not been established. The branch does not read `lParam` before those calls.

Microsoft documents [`DBT_DEVNODES_CHANGED`](https://learn.microsoft.com/en-us/windows/win32/devio/dbt-devnodes-changed) as a system-broadcast `WM_DEVICECHANGE` notification with `wParam` `7` and `lParam` zero for changes to device nodes; it recommends refreshing device lists. This describes the event, not a guarantee that creating virtualMIDI endpoints generates a devnode change, that an application-posted message has identical semantics to a system broadcast, or that Cubase reloads MIDI Remote scripts in response.

The executable also contains RTTI naming `SystemRoot::private_loadScripts` and `ScriptLoader::private_loadScriptFile`. `SystemRoot` has secondary vtable `0x4454c98` at offset `0x8`; `ScriptLoader` has vtable `0x445a488`. Names and vtables alone do not identify a callable reload method or provide object lifetime, context, or thread requirements. Steinberg's [MIDI Remote getting-started guide](https://steinbergmedia.github.io/midiremote_api_doc/getting-started/) documents the Script Console reload button; it does not establish a background API for invoking reload.

## Startup marker static evidence

The UTF-16 text `ApplicationStarted.txt` at executable RVA `0x482bca0` is held in a pointer at RVA `0x552ff08`. The pointer is loaded at RVAs `0x3ac5605`, `0x3ac5865`, `0x3ac5c9b`, `0x3ac5d57`, and `0x3ac5f66`. At functions `0x3ac5c70` and `0x3ac5d30`, the marker string enters a path-construction call; the same global object's virtual method at offset `0xe8` is called with that path, and if it returns nonzero its method at offset `0xe0` is called with the path. This pattern is consistent with a test followed by a path operation, but method semantics, caller identity, normal-exit behavior, and the relationship to the Safe Start dialog are not proven by this trace. `scripts/project-lifecycle-inspect.py` includes these exact references. Any controlled marker-move experiment and its live result must be recorded separately; the static finding itself performs no file operation.

## Reproduction and status

Run `python scripts/project-lifecycle-inspect.py` with `pefile` and `capstone` to print bounded disassembly of the fixed candidate methods and window procedure. This reads the executable from disk only and creates no file. The fixed offsets must be re-established after any application update. Supporting RTTI/vtable extraction uses `scripts/host-project-inspect.py` with narrowly scoped patterns; the RTTI association and the window procedure entry are independent static observations.

No native project lifecycle call, script reload, MIDI notification, or persistence operation was made by this investigation. A safe next step is to determine the notification callback's concrete object identity and callers, and separately recover a lifecycle interface with defined argument ownership, main-thread dispatch, asynchronous completion and verified disk outcome before implementing any operation.
