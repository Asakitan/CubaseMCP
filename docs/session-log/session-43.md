# Session 43: automatic cleanup of temporary output

Date: 2026-11-11.

## Why

`artifacts/` had accumulated 622 `project-create-<32 hex>` lifecycle request directories (201.3 MB), 8.3 MB in 123 `scratch-temp` entries and 193 `*.before-<id>` atomic-write backups in `artifacts/runtime`. Every successful non-status lifecycle call writes `operation.json`, `request.bin`, `result.json` and possibly a copied launch receipt; only a successful `status` call removed its directory. Nothing removed old records, so the working tree grew with each session.

## What changed

- `src/cleanup.ts` removes only three fixed shapes under `<root>/artifacts`:
  - `project-create-<32 lowercase hex>` directories whose newest byte is older than `retentionHours` (default 1 h). Names or absolute paths listed in `artifacts/temp-cleanup-keep.txt` (or the `keep` option) are never removed.
  - entries inside `scratch-temp` older than `scratchRetentionHours` (default 1 h); the directory itself stays.
  - `runtime/*.before-<32 hex>` and `runtime/*.tmp-<32 hex>` older than `retentionHours`.
  Age is the newest modification time of the whole tree, so an old-looking request record with a newer nested file is kept. Reparse points, trees above 20 000 entries and anything that resolves outside `artifacts` are skipped, not deleted. `managed-projects`, `ipc`, the current `cubase-launch.json` and newer request records are not candidates.
- The threshold is one hour for all three shapes, by the user's rule that anything older than an hour is temporary. An earlier draft used 24 h / 6 h and exempted the newest 20 request records; no age-based exemption remains. `keepRecentLifecycle` still exists for an explicit `--keep-recent N`, defaulting to 0.
- `startTempCleanup` runs 30 s after the stdio transport connects and then hourly. Both timers are `unref`'d and every failure is swallowed, so the pass cannot delay or write to the protocol stream; `src/server.ts` starts it with the parsed settings.
- `cubase.config.json` gains an optional `cleanup` block. `src/config.ts` defaults it to `{ enabled: true, retentionHours: 1, scratchRetentionHours: 1 }` and rejects values outside 1..720.
- `src/cleanup-cli.ts` (`npm run cleanup:temp`) runs the same code on demand: `--dry-run`, `--verbose`, `--root`, `--retention-hours`, `--scratch-retention-hours`, `--keep-recent`. It prints a JSON summary and exits 2 when a locked entry could not be removed.

## Evidence

- `npm run build` passed.
- Full suite **226/226** (218 existing plus eight cleanup tests). `tests/cleanup.test.cjs` covers stale request, scratch and atomic entries removed while `managed-projects`, the current receipt, sub-hour records and a non-matching directory stay; a newer nested file keeps an old-looking record; dry run; keep manifest and keep option; idempotent second pass; an explicit newest-N window; the background schedule; config defaults and range rejection.
- The one-hour `npm run cleanup:temp`: scanned 573 candidates, removed 550, 23 skipped, freed 179,045,321 bytes, zero failures. 20 request records remained (7.2 MB): the two cited by documents and records younger than an hour. The first pass under the earlier 24 h draft removed 265 entries and 33,277,145 bytes; both are recorded because only the final default is one hour.
- Both records cited by documents (`project-create-560c1e73a4ec1bee802f5f70ae499ba5` in session 37, `project-create-c1eac85f6c0124cf0837eb3810b26c90` in `native-host-contracts-33.md`) still exist and are listed in `artifacts/temp-cleanup-keep.txt`.

## Limits

- Retention is age-based, not reference-based. A record cited by a document stays only while it is listed in `artifacts/temp-cleanup-keep.txt`; adding a new citation means adding a line there.
- Files locked by a live process are reported and retried by the next hourly pass; the CLI exits 2.
- The pass does not remove `.test-build`, `dist`, `node_modules` or any evidence outside the three shapes.
- Background cleanup is started by the stdio entry point. Importing `createServer` in tests does not schedule anything.
