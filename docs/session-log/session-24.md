# Session 24: Empty startup and first-project observation

Date: 2026-11-10.

## Request and boundary

The two earlier open submissions in PIDs 50568 and 24036 remain `unknown` and were not replayed. Prior owned state was backed up before a no-CPR-argument launch.

## Work and evidence

- PID 72128 with holder PID 55324 produced `artifacts/ipc/midi-startup-empty-summary-corrected-e6ef5f706a6f436896265a73a0ba82a3.json`: 878 samples, 822 root absent with informer and listener, 56 pending, zero errors; first sample 0.120866 seconds after start and sampled input desktop `Default`.
- One independent fixed diagnostic submitted `First Empty Probe 24.cpr` after Job, observer and no-project checks. The fixture is a byte copy, not a newly created project. `open-result-72128.json` reports `openResult=0` as submission only. The live trace `artifacts/ipc/midi-project-transition-72128-50933c2c3095684409cb2358fcc8629d.jsonl` observed the same-name project window, root and informer `treeContainsRoot`.
- Console evidence `artifacts/ipc/after-first-open24-Read-MidiScriptErrors-b41e5813e0904e24808b0b0f7db780be.json` records 3.8 device and mapping activation; host environment evidence is `artifacts/ipc/after-first-open24-Read-MidiHostEnvironment-8c27a4a97a7940d889bb3a98c627902a.json`.
- MCP live read and discovery passed. Track-volume target was not observed two seconds after the write (`artifacts/live-smoke/verification-coverage-2e833fdb-d371-40e8-a20f-b323084016fd.json`), and later read remained at the original value (`artifacts/ipc/after-first24-write-read-847d5129-3802-495a-8b53-d7b3c80d9c31.json`). The original operation was not repeated.
- A separate DirectAccess test on Stereo Out volume observed `0.7890865802764893` → `0.5` → `0.7890865802764893` through MCP, with distinct submitted writes and reads (`artifacts/ipc/first24-direct-parameter-7e95d319-4f95-4c4b-aa8c-d1bb30070815.json`). It is an individual parameter test, not general project editing or saving.
- The same distinct parameter's edit lock was read `false → true → false` after separate submissions (`artifacts/ipc/first24-edit-lock-1f3fa813-58c7-49bf-b974-f34fc5fa2afd.json`). The 1,311-sample transition trace and 512-sample desktop observer recorded no sample errors or sampled background violation (`artifacts/ipc/first24-transition-summary-50933c2c3095684409cb2358fcc8629d.json`).
- PowerShell syntax parsing, C# compilation, MSVC `/W4 /WX /Zs`, and the fixed diagnostic build passed. Empty-start, prior-launch regression and existing-instance guard checks passed. `npm run build` and all 91 tests passed.

## Limitations and remaining

Sequential checks and polling are non-atomic and foreground samples are not continuous. These observations do not establish creation, durable saving or general project/event editing. Resolve the observed track-control discrepancy and independently verify persistence and lifecycle completion before claiming them.
