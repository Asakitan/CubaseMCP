# Session 44: fix 0xC0000005 in native audio export and raise event/automation bounds to 131072

Date: 2026-11-14.

## Why

1. **`0xC0000005` at `exportStage = 4` in `cubase_audio_export`**:
   In `E:/VC/make_some_room` (request `a04c178b566c5db42ad4e0c493dbb3d2`), `cubase_audio_export` failed before rendering with a caught host exception `0xC0000005` (`exception: 3221225477`) at `exportStage = 4` (`exportStarted = false`).
   Disassembly of `Cubase 16.exe` at RVA `0x3b14d40` (the 7-argument file-format constructor called in `exportStage = 4`) shows that the 7th parameter (`[rsp + 0x30]` at the call site, `[rsp + 0xd0]` inside `0x3b14d40`) is a 64-bit string pointer (`const wchar_t*`) forwarded to `0x3b7f020(this + 0x60, rdx, -1, 1)`. All host callers in `Cubase 16.exe` write a 64-bit value (`mov qword ptr [rsp + 0x30], 0` or `rax`).
   In `native/bridge/NativeAudioExport.h`, the 7th parameter of `0x3b14d40` was typed as `uint32_t` instead of `const void*`. MSVC emitted a 32-bit store (`mov dword ptr [rsp + 0x30], 0` at RVA `0x42ea`), leaving the upper 32 bits `[rsp + 0x34..0x37]` uninitialized on the event-thread stack. When prior stack contents at `[rsp + 0x34..0x37]` were non-zero, `0x3b14d40` read a non-null bogus pointer `0x????????00000000` and `0x3b7f020` dereferenced it (`movzx eax, word ptr [r9]` at `0x3b7f050`), raising `0xC0000005`.

2. **`error: 13` (`ERROR_INVALID_DATA`) on multi-track songs exceeding 8192 events**:
   `Make Some Room.cpr` contains 8,404 MIDI notes across 14 tracks (8,659 total event-tree items). `collectModel` in `native/bridge/NativeProjectModel.h` capped total items and per-container iteration at `8192` (`createMixerTrack` also rejected `before.size() >= 8191`), used an $O(N^2)$ `std::vector<void*>` linear scan for cycle detection and track-creation diffing, and invoked `VirtualQuery` (`readable`) on every single character of `hostNarrow`/`hostWide`. Because `collectModel` is shared by `cubase_events_list`, `cubase_event_edit`, `cubase_midi_note_edit`, `cubase_track_create`, `cubase_automation_read` and `cubase_automation_edit`, any project above 8,192 events failed all six operations.

3. **Pre-mutation `operationStarted` state and locked-DLL cleanup**:
   `exportAudioFile`, `importMidiFile` and `importAudioFile` inherited `result.operationStarted = true` before their preflight checks completed. Additionally, `src/cleanup.ts` called `rm(dir, { recursive: true })` directly on expired `project-create-<id>` directories; when a live Cubase process still held `CubaseProjectCreate.dll` pinned in memory, recursive deletion removed `operation.json`, `create-result.json` and `operation-error.json` before failing on the locked DLL.

## What changed

- `native/bridge/NativeAudioExport.h`:
  - Changed the 7th parameter of `0x3b14d40` from `uint32_t` (`0`) to `const void*` (`nullptr`).
  - Reset `result.operationStarted = false` at entry and set `result.operationStarted = true` at `exportStage = 7` immediately before invoking `0x1a6bd30(controller, 1)`.
- `native/bridge/CubaseProjectCreate.cpp` & `native/bridge/NativeAudioImport.h`:
  - Added `#include <unordered_set>`.
  - Reset `result.operationStarted = false` at entry of `importMidiFile` and `importAudioFile`, setting `result.operationStarted = true` right when `result.importStarted = true` is set.
- `native/bridge/NativeProjectModel.h` & `native/bridge/NativeAutomation.h`:
  - Raised `kMaxModelItems` from `8192` to `131072`, page `limit` up to `512`, and `writeModelJson` buffer bound from `1 MiB` to `8 MiB`.
  - Replaced `std::vector<void*>& visited` linear scan and `createMixerTrack` `before` linear scan with $O(1)$ `std::unordered_set<void*>`.
  - Optimized `hostNarrow` and `hostWide` to call `readable` (`VirtualQuery`) on the start address and when crossing 4 KiB page boundaries.
- `scripts/Project-Runtime.ps1`, `src/lifecycle.ts`, `src/server.ts`:
  - Updated `offset` max to `131072`, `path` index max to `131071`, page `limit` max to `512`, `model.json` size bound to `8MB`, `execFile` `maxBuffer` to `16 MiB`, and per-track `cubase_midi_import` arrays to `100000`.
- `src/cleanup.ts`:
  - Unlinks `CubaseProjectCreate.dll` first when removing a `lifecycle-request` directory so a live Cubase process holding the pinned DLL fails immediately without deleting the JSON receipts in that directory.

## Evidence

- `scripts/Build-ProjectRuntime.ps1` (`/W4 /WX`) and `npm run build` succeeded.
- Disassembly of `artifacts/native-runtime/CubaseProjectCreate.dll` confirms `mov qword ptr [rsp + 0x30], 0` before calling `0x3b14d40`.
- Focused test suites (`tests/song-tools.test.cjs`, `tests/lifecycle.test.cjs`, `tests/cleanup.test.cjs`: **33/33 tests**) passed.
- Live verification against the running owned Cubase instance (PID 31100, `Make Some Room.cpr`):
  - `model_snapshot` returned `ok: true`, `total: 8659`, `exception: 0`, `error: 0`.
  - `export_audio` to a temporary scratch WAV rendered the full 259.048 s stereo 48 kHz / 24-bit mixdown (`74,607,808` bytes, `12,434,286` frames, `peak: 0.678611` / `-3.4 dBFS`, `rmsDb: -22.4 dBFS`, `exportStage: 8`, `exception: 0`), and the scratch WAV was cleaned up afterwards.

