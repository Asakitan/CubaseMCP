# Native Startup Decision

Date: 2026-11-10. Target: installed Cubase AI 16.0.5 Windows x64. All addresses below are executable RVAs. The investigation used static disassembly, profile file metadata, and bounded read-only process memory; it did not alter process memory, invoke host functions, operate UI, or change files.

## Safe-Start branch

Startup routine `0x1d551d0` calls the Safe-Start dialog routine `0x1dc74e0` at `0x1d554b6` when either the marker check `0x3ac5810` returns nonzero or the modifier query `0x3675dd0` returns exactly 7. An earlier byte at the startup object offset `0x14` branches out before this sequence. The dialog branch itself has these two conditions; this statement does not assert that all later startup conditions are satisfied.

The marker routine first has an early-return check at `0x3b93f20` whose broader meaning was not established. Otherwise, on its first evaluation it checks `ApplicationStarted.txt` and `CrashNotification.txt` with a shared FNPath mode and caches their combined boolean in byte RVA `0x599df39`; byte `0x599df3a` records that the check was initialized. Subsequent calls return that cached value. The cached boolean alone does not identify which file was present.

The FNPath constructor at `0x3b0c960` forwards mode 1 to `0x3b0e120`. Its mode-1 branch uses the string object at offset `0x60` of the object returned by `0x3aceb60`, whose address is RVA `0x599e450`, and appends the requested filename. A bounded read at 2026-11-09 15:57:14.578990 UTC found that string in PID 58536 was `C:/Users/99325/AppData/Roaming/Steinberg/Cubase 16_64`. A read-only file-metadata search found `CrashNotification.txt` in that exact directory, 127 bytes, last modified locally at 2026-11-10 02:46:53. File contents were not read.

At 15:55:43.010072 UTC the same alive process had marker cache `1` and initialized flag `1`. Thus changing disk markers after that check does not itself update that process's cached boolean. This does not establish which marker caused the value, nor whether other processes or subsequent launches change those files.

## Modifier branch

Read-only pointer observations in PID 58536 connected the UI factory's slot 9 to `0x18f7d00`, which returns its object plus `0x40`, and the resulting object's slot 17 to `0x39354d0`. That routine uses `GetAsyncKeyState`: Shift (`0x10`) contributes bit 1, Alt (`0x12`) bit 2, Ctrl (`0x11`) bit 4, and either Windows key (`0x5b`/`0x5c`) bit 8. Therefore the immediate comparison to 7 corresponds to Shift, Alt, and Ctrl down, with neither Windows-key bit set. This is a live-pointer/static-code identification, not a recorded key-state sample.

## Evidence and boundary

The raw observations, timestamps, and limitations are in `artifacts/ipc/native-startup-readonly-20261110.json`. Reproduce static slices with `python scripts/native-startup-disasm.py --range decision`, `markers`, `marker_path`, or `modifier_keys`. Archive-only removal of the markers before a fresh process and absence of the modifier combination predict a false value for these two inputs, subject to the early-return condition and any newly created files. They do not prove successful license checks, project loading, MIDI readiness, or completion of startup. No file cleanup or restart was performed in this investigation.
