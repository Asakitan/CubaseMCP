# Project Command Catalog: Static Contract

Date: 2026-11-10. Target: installed Cubase AI 16.0.5 `Components/projectplugin.dll`. All RVAs are build-specific. This is a static parser/handler inventory, not a vendor SDK, a complete schema, or evidence that commands execute successfully in a live project. No command was submitted by this investigation.

## Common envelope and status

The service entry is RVA `0x11ef0`; parser/dispatcher is `0x23730`. The parser recognizes exactly these case-sensitive command literals in its dispatch comparisons: `ExportMix`, `CreateTracks`, `Transport`, `Locators`, and `GetMusicalTrack`. `payload_version` and `command` are looked up in the top-level document. The date-format validator compares against the runtime global initialized from `2026.10.01`; see `host-project-api.md` for limits. The independent empty-input test reports service return `1` and status `4`; it does not validate a nonempty request. A nonempty service response is delivered to a receiver as a transient pointer/length span and must be copied during the callback; see `service-request-contract.md`.

The output serializer references `payload_version`, `response_name`, and `response_status`; the operation handlers contain literal statuses `Success` and `Failure`. Additional fields are command-specific. These observations do not establish all status values, success guarantees, or error text. Host request submission success is distinct from the later callback outcome.

## Commands

### GetMusicalTrack (read-oriented)

Parser `0x22d50` requires a `type` string exactly equal to `Tempo`, `Key Signature`, `Chord`, or `Bar Signature`. When `range` is absent, it selects internal mode 0. When present, it checks `range.mode` for `Locators` or `Seconds`. For `Seconds`, it reads `start_time` and `duration` through numeric helper `0x203d0` and rejects a duration that compares less than or equal to zero. That helper returns `0.0` for missing or unsupported nonnumeric values; NaN and all malformed JSON edge cases are not characterized.

The response serializer references `track`; nested track serialization `0x26360` references `type`, `color`, and `events`, with event helper `0x25d90` referencing `type`, `color`, and `start_time`. Exact response shapes, event-specific payloads and units require further tracing or actual response capture.

```json
{"payload_version":"2026.10.01","command":"GetMusicalTrack","type":"Tempo"}
```

This is a static candidate, not an observed successful response.

### Locators

Parser `0x24a30` requires an `action` string. For `Set`, it reads `left_locator_time` and `right_locator_time` using the numeric helper; missing or unsupported values become `0.0`. The execution handler `0x103c0` explicitly compares action values `Get` and `Set`; it reads locator values for those paths. The parser itself accepts action strings other than `Set`, and the full execution/error semantics of unrecognized actions remain unresolved. The response writer references `response_action`, `left_locator_time`, and `right_locator_time`; exact units and full object structure are not verified.

### Transport

Parser `0x24eb0` reads `action` and requires `state` to be present. Its state conversion at `0x25327` compares the DOM type tag with `0x0a`; exact behavior for every non-boolean input is not yet established. Execution handler `0x10730` compares actions `Start`, `Stop`, `Record`, and `Cycle`. Presence of these branches does not show that each action honors state identically or succeeds in all editions.

### ExportMix

Parser `0x222e0` validates `file_type` against `WAV` and `AIF` and requires `range` to be present with its object-type tag. It recognizes `range.mode` values `Locators` and `Seconds`; the `Seconds` branch reads `start_time` and `duration`, rejecting duration less than or equal to zero. The observed handler has file-type mappings and an `audiopreview` reference, while response serialization references `file_name`, `file_type`, `file_path`, `file_length`, and `sample_rate`. Destination selection, output encoding parameters, render completion and response units are not established.

### CreateTracks

Parser `0x208f0` requires `tracks` with the array-type tag and iterates track objects; malformed objects fail parsing. It compares track `type` with `Audio` and `MIDI`, and references `color`, `select`, and `clips`. Clip parsing references `type`, `color`, `start_time`, `length`, `file_path`, `auto_convert`, and `select`; it also compares clip types with `Audio` and `MIDI`. Numeric fields use helper `0x203d0`, which can default absent or nonnumeric inputs to `0.0`; optionality, boolean coercion, path rules, bounds and cross-type constraints have not been fully established. Treat this as an observed field inventory, not a complete working JSON schema. The response serializer references `tracks`.

## MIDI and audio event boundary

The five observed dispatch strings do not include a dedicated note-add, note-edit, audio-event-edit, or arbitrary event mutation command. `CreateTracks` references nested clips, and `GetMusicalTrack` serializes musical events; neither observation proves individual MIDI-note creation/editing, audio-event modification, or a complete timeline API. Further handlers may exist elsewhere in Cubase, but this catalog makes no claim about them.

## Reproduction and next work

Run `python scripts/project-command-catalog.py --output NEW_PATH` to extract the bounded disassembly and RIP-relative string references for the dispatcher, five parsers, and response/track serializers. The output is generated from the installed DLL without loading or calling it; diagnostic dependencies are `pefile` and `capstone`. The report is intentionally limited to known function extents and excludes whole-binary scans. `project-command-static.json` and related disassembly are under `artifacts/research/session-08`.

Next, trace the command-specific execution and nested event serializer to resolve data types, output nesting, defaults, and error cases; compare these with one actual copied-project read-only callback once the host service is present. Preserve the distinction between immediate submission, callback failure, and a parsed successful response.
