# Session 05: Component Factory Boundary

Date: 2026-11-10, local time.

## Request

Continue toward full MCP functionality without foreground interference or fallback.

## Work and Evidence

- Added an independent standard-factory metadata probe and PowerShell wrapper, using the published `IPluginFactory` method order and structures.
- Compiled and executed the probe against the installed project and channel components. Both factory queries succeeded, returned the Steinberg vendor, and exposed zero public classes. Evidence: `artifacts/ipc/project-factory-20261110.json`.
- Bounded disassembly at `projectplugin.dll+0x3ec0` and `hostchannelaccess.dll+0x3480` showed registration-table lookup and constructor dispatch rather than fixed private class IDs.
- Recorded the unresolved host registration/context contract. Did not invoke unknown methods, create business objects, attach to Cubase, restart it, operate foreground windows or change the production backend.

## Verification

The real factory task passed. The C# probe compiled and both module queries completed. Editor diagnostics reported no errors. The existing production test suite was not rerun because production code did not change.

## Unfinished Goal

No native project read/write operation is implemented. Full project creation, note/audio-event editing and parameterized export remain blocked by the missing host service contract. A further recovery effort needs an explicit bounded target and acceptance criteria; current metadata success is not full feature coverage.