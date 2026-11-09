# Real MCP edit, Save and fresh-process reopen

## Accepted increment

Revision `2026-11-10-coverage-3.13` has a **real stdio MCP** persistence observation on the owned `artifacts/live-smoke/MCP Save 32.cpr`: tempo was changed from 134 to **146.75**, the fixed current-project Save was submitted once, the file changed from **93,085 to 93,730 bytes**, and a fresh Cubase process subsequently returned **146.75** through MCP. Its bytes matched the saved snapshot. This is semantic persistence of that tempo edit, not merely a file timestamp or a project-window title.

It does not certify every project, arbitrary destination/save-as, blank-project creation, track/event editing or all Cubase functions. The fixed native first-open bootstrap is still a separate diagnostic, not an MCP lifecycle API. Normal MCP execution remains a single MIDI transport.

## Why the Save path changed

The old custom-value pulse and subsequent distinct physical-input experiments on the large primary mapping did not produce an observed Save. Holding the input longer also did not establish completion. A minimal one-button page did produce a binding callback and a changed file. This comparison motivated the separate minimal Save page; it does **not** establish a particular host binding-count limit, scheduling or takeover root cause.

`diagnostics/minimal-save30` is a fixed diagnostic controller, never a selectable runtime backend. Its independent tempo **137.5** save/reopen result preceded the production fix. Early diagnostic startup/export and initial-tempo errors occurred before a write; a demonstrated second WinMM-output-open failure was corrected by using the already-open connection. These diagnostic results are not substitutes for the real MCP result above.

## Production protocol

1. `cubase_command_execute` with current session, `key: "project.save"` and `confirmCurrentSelection: true` enters `MidiClient.executeSave`.
2. `commands.prepare` checks the session, released input, confirmation and deadline. It activates the internal `CubaseAI MCP Save` page. That page checks host `canPerform` and responds with the original session, new page session, request-ID token and bounded input deadline.
3. The client validates the preparation and sends exactly one Note On, channel 0 / note 1, through the **same** validated output port. It only polls read-only `commands.result`; it never resends the press.
4. After the matching binding callback is observed, the client sends one Note Off and waits for the released value. `commands.finish` then returns to the primary page and returns its **new session**. Old object IDs and session values must be rediscovered.
5. A timeout/cancellation after input is `unknown` and fault-latches the client. There is no automatic reconnect, repeat or alternate route. A binding callback is evidence of command submission, not a correlated disk-save-completion callback.

The input is a fixed same-user local MIDI binding, not an authenticated transport against another process that can access the same port. Page activation, callbacks and host state are not an atomic project transaction.

Cubase can persist the active internal Save page while serializing. Revision 3.13 recognizes an **unarmed** internal page at startup and returns to the primary page on idle, without emitting Save input. It also retains an initial tempo callback delivered before page activation only when both its device and mapping match the activated page.

## Exact evidence

| Stage | Owned lifetime | Evidence |
| --- | --- | --- |
| Minimal diagnostic save | PID 55256 / `134387321900196282` | `artifacts/ipc/minimal30-55256-134387321900196282-94f2ba89-f6cf-4c8b-9656-3a288eee0b2f.jsonl`; 137.5; 93,706 bytes |
| Minimal diagnostic reopen | PID 58596 / `134387323122339176` | `artifacts/ipc/minimal30-58596-134387323122339176-88d543dc-651d-464b-bce4-b5de888505d3.jsonl`; 137.5 |
| Production large-page 3.11 attempt | PID 67568 / `134387326536681741` | `artifacts/ipc/mcp31-67568-134387326536681741-6e6dc512-b83b-4c27-ad47-5f41fc2096f7.jsonl`; binding timeout, unknown, no replay |
| Production MCP 3.12 edit/Save | PID 56160 / `134387329350213382` | `artifacts/ipc/mcp32-56160-134387329350213382-53581471-8e66-43d9-87a8-15526daeb900.jsonl`; 146.75; 93,730 bytes |
| First read-only reopen | PID 52820 / `134387329781221780` | `artifacts/ipc/mcp32-52820-134387329781221780-42cd8135-e7ca-4169-a704-1c7fd32860ae.jsonl`; saved internal page, `SAVE_PAGE_BUSY`, no edit/Save |
| Final read-only 3.13 reopen | PID 69368 / `134387330697650771` | `artifacts/ipc/mcp32-69368-134387330697650771-51d28318-d4a9-4740-8c8f-4051f325e55e.jsonl`; `reopen_content_observed`, 146.75 and saved bytes |

The observed Save token was `5e808bd860f6085f09f3c99982f2dcb4`; its returned primary session was `1a1c230d38e-896265611e94d-3`. These are historical observations, not reusable credentials or live IDs. `artifacts/live-smoke/MCP Saved 32.cpr` retains the stable saved bytes. No old uncertain submission was replayed.

## Background observations and limits

All host launches used the private `winsta0\\CubaseAI_MCP` desktop and the restricted owned Job. No desktop switch, foreground input, keyboard/mouse or dialog action was issued.

The writer observer recorded 49 samples without a sampled background violation, then reported a desktop-inspection error when its owned desktop was ended for the fresh reopen; it is **not** a complete 90-second observer success. File: `artifacts/ipc/first-project-open24-observer-56160-51010a6686764946b00f7af2308cd90f.json`.

The final read-only reopen observer completed 356 samples over 90 seconds with `backgroundViolation:false`: `artifacts/ipc/first-project-open24-observer-69368-de41c813d31b43e1ab09c8e14f161cfb.json`. Polling can miss brief events, and `GetForegroundWindow` is a calling-desktop view, not a global continuous history.

## Necessary validation only

- 3.12 build and seven focused Save/MIDI/MCP checks passed before the real MCP write.
- 3.13 build and three focused saved-page/initial-tempo/command checks passed before the read-only fresh reopen.
- The already successful unchanged acceptance was not repeated; the complete 109-test suite belongs to the earlier 3.9 revision, not a new 3.13 full-suite claim.

Logs: `artifacts/ipc/save32-build.log`, `save32-focused.log`, `save33-build.log`, `save33-focused.log`. Live wrappers use lifetime-keyed exclusive-create edit/Save admissions; new observation log names never bypass those admissions.
