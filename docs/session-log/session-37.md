# Session 37: Port-host startup readiness

Date: 2026-11-11.

## Request

Repair the MIDI port startup failure without replaying the project creation or interacting with an existing host.

## Evidence

The `8f0a2a05acdf1d00355572af8c5e6e7f` creation receipt reports `stage=ports`, `Configured MIDI ports are not ready.`, and `native=null`; the background port host later reported ready. The prior lifecycle checked immediately after asynchronous launch. A later live create reached `stage=launch` and failed before native admission; its launch stderr recorded `Owned holder creation failed: 9`. Two discovered Node paths were interpolated as one executable. A synthetic Win32_Process.Create reproduction returned 9 for the concatenated paths and 0 for a single path. A separate fake child demonstrated an inherited pipe delaying the Node `execFile` completion by 4236 ms while the parent had already printed its result.

## Work

`Start-MidiPorts.ps1` creates the host independently through the existing `StartDetachedHolder` no-inherited-handles implementation, without inheriting the lifecycle pipes. `Project-Runtime.ps1` waits for the launched PID's ready state and the configured exact ports, with a 15-second deadline, and stops on host failure or exit. `Start-CubaseEmptyBackground.ps1` selects the first discovered Node executable rather than interpolating all matches. No project request is repeated.

## Verification

Fixture-only regression: `node --test tests/midi-port-readiness.test.cjs`, 2/2 passed, including delayed host readiness and two discovered Node paths. This does not establish live Cubase project creation or song production.

## Live verification

The main agent's subsequent explicit MCP create completed with Cubase 16.0.5 and `readyForOperations: true`. `artifacts/project-create-560c1e73a4ec1bee802f5f70ae499ba5/create-result.json` records `operation_succeeded`, `saveReturned: true`, and `saveValue: 1`; the requested `E:/VC/LabyRinth/production/cubase/LabyRinth_note_production_v02.cpr` was observed at 67559 bytes. This verifies the corrected empty-launch path with the ports already present, not the delayed port-host startup branch in live conditions.

## Remaining

The delayed port-host readiness branch retains fixture-only verification. `Invoke-Contracts33Reopen.ps1` and `Start-BindingTestPorts26.ps1` use a similar multiple-match pattern and are diagnostic scripts outside this repair. Existing port and editor processes were not terminated.

## Subsequent cross-sample-rate import finding

The main agent observed slowed playback after importing a 48 kHz source into `E:/VC/LabyRinth/production/cubase/LabyRinth_note_production_v02.cpr`. A solo export matched the samples interpreted at 44.1 kHz with correlation 0.999999925 and zero lag; nominal-speed correlation was 0.007975. Evidence: `E:/VC/LabyRinth/production/evidence/cubase_import_timebase_probe.json`. The project now uses resampled 44.1 kHz accompaniment working copies and native 44.1 kHz vocal output, with event durations read back as approximately 206.8679365 and 19 seconds. Original source files were preserved. No general sample-rate detection/conversion was implemented, and the corrected playback was not independently compared in this documentation task.
