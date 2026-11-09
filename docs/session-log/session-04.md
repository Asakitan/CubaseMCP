# Session 04: Native Interface Investigation

Date: 2026-11-10, local time.

## Request

Investigate Cubase RPC and other internal interfaces to pursue project creation, MIDI/audio event editing and parameterized export without interfering with foreground work. Do not equate MIDI Remote's scope with all native host capabilities.

## Work

- Added a read-only Node diagnostic and VS Code task for endpoint/module metadata and bounded PE imports, exports and string inspection.
- Examined the installed main executable and nine related components. Located project-plugin factory exports, project model interface names, a project-host request callback and SKI dispatcher names.
- Captured the running Cubase PID, loaded vendor modules, absent TCP listeners/UDP bindings and four pipe-name candidates. Pipe ownership and protocol remain unverified; no endpoint requests were sent.
- Attempted to verify historical SKI descriptions through the vendor technology URL; the redirect did not yield current documentation. No SDK declarations were obtained, so historical capability claims are excluded from verified findings.
- Preserved the existing MIDI backend, running host, user preferences and prior verification artifacts.

## Verification

The independent VS Code task completed successfully and produced `artifacts/ipc/inspection-20261110.json`. All ten PE inspections and runtime metadata collection completed without reported errors. The script and task file had no editor diagnostics. No broad runtime suite was repeated because no MCP execution code changed.

## Remaining

Recover factory registrations, interface IDs, request payloads, vtables and host-thread requirements. Start with read-only project enumeration before any reversible test-project mutation. No functional native client or full feature coverage is claimed.