# Session 01: Strict Background MCP

Date: 2026-11-10 (local clock).

## Request

Create a Cubase AI 16 MCP, informed by PIXELHIZE/CubaseMCP, strictly without foreground control or fallback.

## Evidence

- Workspace initially empty; no repository instructions or Codex configuration found.
- User target `D:\CubaseAI` contains Download Assistant content, including `WIN64/Cubase 16.0.5 - Application/Cubase_16.0.5_Installer_win64.zip`.
- Registry and disk identify an installed Cubase 16.0.5 at `C:\Program Files\Steinberg\Cubase 16` with MIDI Remote API declarations.
- Reference project exposes unverified and companion-required capabilities; tool count does not establish working coverage.

## Work

- Implemented an independent TypeScript MCP server using SDK 2.4.0 and @julusian/midi 3.8.1, with one production backend.
- Shared ES5 size-bounded SysEx codec, strict current-session/object/tag admission, exact parameter representation, observed plugin UID admission and fixed command allowlist.
- Added 16 MCP tools and 31 control declarations, including native tempo/time operations. Unsupported DAW workflows are documented, not emulated.
- Added mandatory request deadlines and no-retry/fault-latched transport. Receipts distinguish not_started/submitted/unknown.
- Created VS Code stdio configuration, build/test/install/diagnostic tasks, protected user-script installer and explicit live doctor.
- Installed four files to the current user's `Local/CubaseAI/MCP` driver folder without starting Cubase.

## Verification

- `npm run build`: passed after final code changes.
- `npm test`: 35 passed, 0 failed, 0 skipped. Includes 1 real MCP subprocess test, 15 MIDI-client tests, 2 shared-codec tests and 17 ES5/controller tests.
- PowerShell installer parse and actual file-copy/readback verification: passed.
- `npm run doctor -- --live`: expected prerequisite failure `MIDI_PORT_NOT_FOUND`, execution `not_started`. Native enumeration returned no input devices and only Microsoft GS Wavetable Synth output.
- Normal shared-terminal output was incomplete during one attempted verification; it was not counted as evidence. Dedicated VS Code tasks produced the reported build and test results.

## Remaining

- Provide the two configured virtual MIDI ports and let Cubase load the installed driver.
- Repeat the explicit live diagnostic and verify individual capabilities under the actual AI license.
- Full application functionality, arbitrary project/track/event manipulation and parameterized export are not covered by this public-API implementation.