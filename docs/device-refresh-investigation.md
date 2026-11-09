# Device Refresh Investigation

Date: 2026-11-10. This diagnostic is separate from MCP and has no selectable runtime backend.

An explicit stop/start of the owned virtualMIDI host completed: PID 38352 exited through its normal stop event; the new no-window host PID 55396 reported ready and its two exact ports were enumerated. Cubase PID 11368 remained running. Two bounded status requests then timed out; new port existence did not prove that Cubase rebound its endpoints or reloaded the script.

The installed virtualMIDI header states that a DAW's existing public port front-end becomes inactive when the owning application exits. Its Ex3 GUID parameters describe manufacturer/product identity, not a promise that existing handles reattach.

Static Cubase analysis identifies `USB Change Listener` registration at RVA `0x2f400a0` and its window procedure at `0x2f401e0`. The procedure explicitly branches on message `0x219` and wParam `7`, then invokes its device-change handler. These values match the documented [WM_DEVICECHANGE](https://learn.microsoft.com/en-us/windows/win32/devio/wm-devicechange) / [DBT_DEVNODES_CHANGED](https://learn.microsoft.com/en-us/windows/win32/devio/dbt-devnodes-changed) event with lParam zero. This proves a handler path, not successful MIDI reattachment.

`native/CubaseDeviceRefresh.cs` and `scripts/Refresh-CubaseDevices.ps1` deliver only that fixed event to exactly one `USB Change Listener` window belonging to the requested Cubase 16 process on the fixed isolated desktop. They do not activate windows, synthesize keyboard/mouse input, expose arbitrary messages, kill a process, change preferences or assert successful driver reload. Delivery is followed by a separate MIDI status check. This manual diagnostic notification is not represented as an actual OS broadcast.

## Verification

The first fixed notification returned Windows error 5 and did not establish delivery. A private-thread binding was then added because cross-desktop operations require the calling thread to use the target desktop. A subsequent call against a startup-stage process found no device listener and failed explicitly.

After the recovered project opened and the revised script constructed in isolated PID 17596, one fixed notification was delivered to its private `USB Change Listener`; foreground handles before and after matched. The later script-console snapshot still showed construction but no device or mapping activation. Delivery does not prove script reload or MIDI reconnection. Evidence: `artifacts/ipc/device-refresh-17596.json` and `midi-script-after-device-refresh-17596.json`. The authorized restart sequence is recorded in `docs/startup-recovery-investigation.md`.

A subsequent single hotplug experiment stopped port host PID 25704 while the test Cubase process stayed alive, started host PID 62944, and delivered the same fixed device notification. The new endpoints listed no clients before or after the notification, and the script log still had no activation message. This is evidence that this controlled notification did not restore the observed connection, not proof of all possible device-refresh behavior. Evidence: `artifacts/ipc/midi-clients-after-hotplug-17596.json` and `midi-script-after-hotplug-17596.json`.
