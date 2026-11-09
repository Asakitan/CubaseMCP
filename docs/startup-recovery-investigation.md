# Isolated Startup Recovery Investigation

Date: 2026-11-10. Scope: the owned `MCP Smoke` test project and isolated Cubase instance only. The user explicitly approved restarting that instance and related operations, including elevation. No other project was selected and no project file was deleted.

## Observations

- The owned MIDI port host was stopped through its existing event and restarted without a window. PID 38352 exited; PID 55396 became ready. The two exact ports were enumerated, but two status requests timed out. Port existence did not establish Cubase endpoint reattachment.
- A fixed device-change diagnostic was added for the isolated `USB Change Listener`. Initial notification returned Windows error 5. The diagnostic now binds a fresh worker thread to the isolated desktop and restores its original thread desktop afterward. A later test before the listener existed failed explicitly; successful delivery and reconnection are not established.
- The original isolated Cubase PID 11368 was terminated only after the user approved it. The entire test directory was copied to `artifacts/runtime/test-project-before-restart-20261110`.
- A direct native relaunch PID 38772 exited with `0xc0000409`; the Application Error event identified `ucrtbase.dll`, offset `0x7f6fe`, and WER BEX64 parameter 7. The root cause remains unproven.
- A CIM-launched diagnostic PID 68856 ran but did not use the requested private desktop. It was stopped rather than accepted as an isolated runtime. Attempts to let CIM start a PowerShell launcher returned access denied before the launcher ran. Those diagnostics were not added as runtime choices.
- A temporary private-desktop startup debugger produced a surviving Cubase PID 42240. The debugger was ended with its `-pd` preservation policy, and the target remained alive. A read-only private-window capture then identified a newer-backup prompt. No button was invoked.
- The actual newest test backup, `Auto Saves/MCP Smoke-01-().bak`, was copied to a new, explicitly named `MCP Recovered 20261110.cpr`. Original CPR and backup files remain intact. This is test recovery, not native MCP project creation.
- The launcher now accepts an explicit existing CPR path and records it in the launch receipt. A restart with that path showed Safe Start before project opening. Moving the empty `ApplicationStarted.txt` into `artifacts/startup` with no Cubase running was a reversible hypothesis test; it did not establish removal of Safe Start. The application owns subsequent marker creation.
- The native launch now requests a new hidden console on the same private desktop. The corresponding PID 58536 remained alive beyond the earlier failing startup interval but still showed Safe Start and license-check startup windows at the last observation. The process's existence and this initialization screen are not a working MCP connection.

## Current state

- Cubase: PID 58536, requested project `artifacts/live-smoke/MCP Recovered 20261110.cpr`, private desktop `winsta0/CubaseAI_MCP`; startup incomplete at last observation.
- Desktop/process holder: PID 48104. MIDI port host: PID 55396.
- `artifacts/live-smoke/launch.json` records identical foreground window handles before and after the native launch.
- No project-readiness or coverage-2 MIDI handshake has been observed. Do not repeat status requests without a new readiness observation, and do not count copied files as native project functionality.

## Boundaries

The earlier native factory and registry evidence remains valid for its recorded processes. A transient read-only registry snapshot is not proof that a later process is ready. No UI fallback, generic window-command tool, or alternate runtime backend was introduced. Temporary CIM, debugger and private screenshot diagnostics remain under ignored `artifacts/startup`; production requests still use the strict MIDI path. The startup blocker and complete native project lifecycle remain open work.
