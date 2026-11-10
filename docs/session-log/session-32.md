# Session 32: Track, plug-in, automation and routing contracts

Date: 2026-11-10.

## Request

Complete the remaining host contracts for track creation, plug-in unloading,
automation data and routing without dialogs or foreground input.

## Evidence

- Initial real MCP status: `artifacts/ipc/native32-initial-status.jsonl`.
- The initial owned instance was PID 51676, creation FILETIME 134387574650950198.
  Its source `Native31-Verified.cpr` was preserved; native save-as created the
  separate `session-32/contracts-a/Contracts32.cpr` (287501 bytes).
- Direct-call inspection found callers of the MIDI constructor and the group/FX
  channel factory, but no direct call to the virtual track-list insertion method.

## Work

- Added optional bounded call-site instruction context to the existing file-only
  host inspection script. Its default output and read-only scope are unchanged.
- Added provisional native operation 9 and `cubase_track_create` for empty MIDI
  tracks, with fixed-root admission and independent tree/mixer confirmation.
- First call (`native32-track-create-a.jsonl`) changed the tree from 14 to 15
  objects, but mixer channels stayed at four. The result was `confirmed:false`.
  Later reads timed out; window inventory observed three host error windows.
- Corrected the missing owning-project call (virtual slot `0x1f8`) before list
  insertion. This correction is source/build tested, not host certified.
- Added post-call window rejection and tested the unknown/no-replay outcome.
- Follow-up confirmed that mixer registration and post-insert notifications are
  also missing. Withdrew the provisional tool and native operation 9; the final
  source and rebuilt artifacts retain the 47-tool, operations-1..8 baseline.
- The route display probe (`native32-route-display-probe.jsonl`) kept output
  ID 22 and `Stereo Out`; it did not establish routing support.
- Discarded the failed in-memory state. A new owned instance, PID 47292 / creation
  FILETIME 134387654154762255, stopped at license checking before native open.
  Evidence: `native32-clean-reopen-a.jsonl`, `native32-reopen-blocker-windows.jsonl`.
- Added optional read-only child-text collection to the existing window script;
  it returned an inventory but no usable child text for those dialogs.
- Stopped the license-blocked empty instance through the owned lifecycle tool;
  `native32-blocked-host-stop.jsonl` reports `running:false`. No project file was
  deleted, overwritten or saved from the failed experiment.

## Verification

- Strict C++ syntax and TypeScript/native builds passed.
- Two initial focused MCP tests passed; the revised post-call-window test passed.
- The full suite passed 194/194 before prototype withdrawal. Four affected
  tool-exposure checks passed after withdrawal, including a negative assertion
  for `cubase_track_create`; both PowerShell files passed syntax parsing.
- No successful new track persistence or full four-family host acceptance.

## Remaining

Complete track attachment/undo, prompt-free plug-in unloading, automation data
and routing still require an implemented and observed host contract. No owned
project is running after cleanup. Normal license readiness must be restored
before another clean-host acceptance. No license settings, foreground controls
or original project files were modified.