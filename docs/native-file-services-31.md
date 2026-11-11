# Native file services and editing (session 31)

Target: the installed Cubase AI 16.0.5.174 image, PE timestamp `0x6adf121b`. The built server has 47 tools; the full test suite passed 193/193. File/event/note operations below are implemented. Track factories, plug-in unloading and the other remaining families are not complete.

## File selection is not the operation

The host's file-selection provider is `PathBrowser::IDialog`. Getter RVA `0x3b22d90` obtains it through `0x3b22c30`; the service-name string is at `0x5523f10`. The provider returns path objects to callers. No provider is replaced and no chooser receives input.

The existing MIDI importer already starts after selection: host file system open, `MMidiFilter` and document refresh. Audio import uses the post-selection pool path at `0x27fb960` and arranger insertion path at `0x1d1b840`; operation 6 now exposes this explicit-path workflow through MCP.

## Parameterized audio export: source implementation

`native/bridge/NativeAudioExport.h` follows the temporary `PAudioExportControllerNonUI` used by `SKIAudioExport` (`0x1a7fa70`), rather than a command or the export window:

1. Construct the NonUI controller (`0x1a80360`) and verify its vtable `0x4267870`. Its `+0x1f9 = 1` branch avoids saving UI preferences in the destructor (`0x1a806d0`).
2. Reuse the admitted host `FNPath` descriptor (`0x4831d70`). Its `+0x30`, `+0x38`, `+0x58` methods provide name, parent path and file-type description. The filename value is controller ID 4; the explicit directory is stored on this controller's export-settings model.
3. Select the file format through `0x1a74d80`. Select sample rate (ID 8) and bit depth (ID 9) by inspecting the host's own tables, then read the selected indices back. The bit-depth table contains sample representation, bit count and the host enum; a bit count is not used as an enum.
4. Preflight the settings predicates without invoking their alert wrapper. Export once with `0x1a6bd30(controller, 1)`, destroy the temporary controller and check the requested output file and unchanged document identity.
5. `src/audio-info.ts` reads WAV/AIFF/FLAC metadata from the produced file. The MCP result requires format, rate, depth and integer/float representation to match the request. WAVE also has peak/RMS analysis.

The fixed native operation is 5 (`export_audio`). The lifetime request remains version 3 / 2096 bytes; `audio-export.bin` is exactly 16 bytes: four little-endian u32 values `version=1`, `sampleRate`, `bitDepth`, `floatingPoint`. The operation uses the existing owned process, event-thread, desktop, Job and document gates. Export deadlines follow the explicit tool timeout. An existing destination is rejected, not renamed or overwritten. A missing or mismatched output remains a submitted/unknown outcome and is not retried.

MCP inputs: `outputPath?`, `format?` (`wav`, `aiff`, `flac`), `sampleRate` (default 48000), `bitDepth` (default 24), `floatingPoint` (default false), `range?`, `confirmExport: true`, `timeoutMs`. An omitted path generates a unique filename under the project's `Mixdown` folder. Float requires 32 bits; FLAC is limited to 16/24-bit integer. Host format/rate availability is checked at runtime.

## Audio import: source implementation

Native operation 6 (`import_audio`) uses the current document's `PArrangeController`, resolves the root's pool, passes a host path array to `0x27fb960` with its non-interactive path flag, and inserts the resulting clip groups through `0x1d1b840`. The per-call `AskLineUpFiles` and `LineUpFiles` flags are explicitly zero. No global chooser or alert provider is replaced. The controller must point at the same managed document before import begins.

`cubase_audio_import` preserves the source, validates WAV/AIFF/FLAC metadata, copies it to a unique file in the managed `Audio` directory, optionally sets the cursor with the transport API, submits once and discovers the added audio channels. Builds and the focused source-preservation/native-route contract passed. The first live call stopped before import because a window-name lookup does not return its nested `PArrangeController`; the correction uses the host's `0x1d18510` window-to-arranger helper and matches the document pointer. A real MCP import of a four-second AIFF added one audio channel, retained the source and produced audible output when rendered over the imported range.

### Sample rate (session 38)

The pool path does not convert: a source at another rate than the project is played at the project rate (48 kHz in a 44.1 kHz project: 8.1 % slow, 1.47 semitones flat). Before anything is written the tool therefore reads the project rate from the saved CPR (`src/project-rate.ts`: big-endian float32 72 bytes after the start of the class name `PArrangeSetup`) and compares it with the source header. Input `sampleRateMismatch`: `convert` (default) writes `<name>-<id>-<rate>Hz.wav`, a 32-bit float copy made by `src/resample.ts` (polyphase windowed sinc, exact ratio, stop band from the lower Nyquist frequency), and imports that; `reject` returns `AUDIO_SAMPLE_RATE_MISMATCH` with `execution: not_started`; `ignore` keeps the old behaviour. Only WAV sources are converted. The result adds `sampleRate: { source, project, check, conversion }`; `check` is `match`, `converted`, `imported_at_wrong_speed` or `project_rate_unknown` (CPR missing or without a recognisable record: the import proceeds unchanged).

### Audio track limit (session 42)

Cubase AI 16 accepts at most 32 audio tracks. An import into a project that already holds 32 returns success from the native call, writes the (converted) copy into `Audio`, shows no window and adds no audio channel. `cubase_audio_import` counts the audio channels before the call; when no channel was added, the windows are clean and the count is 32 or more, it fails with `AUDIO_TRACK_LIMIT_SUSPECTED` (execution `submitted`, `details.audioChannelsBefore`) and tells the caller to remove or reuse a track. It is "suspected" because the host gives no reason; any other no-channel outcome stays `AUDIO_IMPORT_NOT_OBSERVED`. The sample-rate branches were run live in the same session (see [session 42](session-log/session-42.md)).

## Event discovery and timing edits

`cubase_events_list` (operation 7) reads tracks, parts, audio events and individual MIDI notes. It returns paths, temporary `eventId` values, types, names, lock state, native time values and host-converted project seconds. Notes also include `pitch`, `velocity`, `channel` and the original `velocityNormalized`. Limits are 8192 objects, depth 8 and pages of at most 128 items. Paths and IDs are not durable across structural edits or reopen.

The parent time base is copied into three temporary `MEditContext` descriptors: working base at `0x58`, start base at `0x88` and end base at `0xb8`. Copying only the working base fixed reads but left the inverse conversion inconsistent for a nonzero MIDI part. `native31-note-parent-offset-position.jsonl` preserves the observed wrong position and `confirmed:false`; it is not a pass. Current code synchronizes all three bases and checks current seconds convert back to the observed native value before a time setter.

`cubase_event_edit` (operation 8) requires the current root, event path, expected type/name/start/duration, one field (`position` or `duration`), seconds and `confirmEdit: true`. It admits unlocked audio events, audio parts and MIDI parts and rejects locked ancestors. Audio-event duration may be shortened, not extended beyond its current duration. Host write access, the `IProjectObject` setter and project notification perform the edit; a second traversal supplies `before`, `after` and `confirmed`. A submitted request is not repeated when confirmation is absent. Undo integration is not certified.

The current `event-edit.bin` is version 2, exactly 656 bytes. Its first 624 bytes contain version/field/path count/reserved u32 values, root u64, eight path u32 values, expected start/duration and requested value as f64, a 256-unit UTF-16 name and a 32-byte type. Appended fields are event ID u64, expected pitch/velocity/channel/reserved u32 values, and expected normalized velocity f64. Event-time calls zero the note-specific fields. Audio move/trim and a MIDI part moved to 3 seconds were observed.

## Single-note editing

`cubase_midi_note_edit` reuses operation 8. Required inputs are `session`, `root`, `path`, `eventId`, `expected`, `field`, `value` and `confirmEdit:true`. Copy the identity and expected fields from one `MMidiNote` row: name, pitch, velocity, channel, velocityNormalized, startSeconds and durationSeconds. Native code re-enumerates and checks every original value and ancestor lock before one setter. Pitch is 0..127, velocity is 1..127, position uses project seconds, and duration must be positive. Expected start can be negative for an already-observed event; requested positions remain nonnegative.

The note primary vtable is `0x43d7fe8`; its MIDI interface is at `+0x40`, vtable `0x43d84d0`. Pitch setter `0x2240b60` and velocity setter `0x2240ce0` use the host's field and conversion logic. Getter `0x22411f0` returns 7-bit velocity; the original normalized value is retained in snapshots and guards. Timing uses `IProjectObject`. No note is reimported, no instrument is added and no selection command is used. An entered setter is never relabeled as `not_started` after an error.

Real MCP changed one note from pitch 60 to 62, velocity 96 to 80, start 0 to 0.5 seconds and duration 2 to 1.25 seconds. A stale expected-state request was rejected before the setter. Save-as and a fresh-process reopen retained these fields, both untouched notes and the edited audio event. After the nonzero-part fix, new explicit requests confirmed project start 4 seconds / local 960 ticks and duration 1.5 seconds / 1440 ticks. The corrected state was saved to `Native31-Verified.cpr`; that final file was not reopened again.

## Verification evidence

Static function listings and direct-call evidence are under `artifacts/research/session-31/ghidra/out-cubase16/` and `artifacts/ipc/native-editing31-*.json`. The static helpers read installed files only and refuse evidence overwrites.

TypeScript/native builds and three focused export-contract checks passed. A first real-MCP export in the fresh owned fixture reached the settings preflight but did not enter the renderer (`exportStage=6`, `exportStarted=false`); the subsequent window inventory contained only the project and Hub. The correction explicitly selects the host's main `VSTOutputChannel` through the same `0x2c75c70` getter used by its default-mixdown implementation.

Four distinct real-MCP renders passed after that correction, each at an explicit new filename/directory and without an unexpected window in the post-call sample:

| Evidence under `artifacts/ipc/` | Observed file |
| --- | --- |
| `native31-export-wav-b.jsonl` | WAV, 48000 Hz, stereo, 24-bit integer, 192000 frames / 4 s, peak -13.4 dBFS |
| `native31-export-aiff.jsonl` | AIFF, 44100 Hz, stereo, 16-bit integer, 176400 frames / 4 s |
| `native31-export-flac.jsonl` | FLAC, 96000 Hz, stereo, 24-bit integer, 384000 frames / 4 s |
| `native31-export-float.jsonl` | WAV, 48000 Hz, stereo, 32-bit float, 192000 frames / 4 s, peak -13.4 dBFS |
| `native31-audio-import-b.jsonl` | AIFF imported once; one new audio channel and source-preserving project copy |
| `native31-audio-import-render.jsonl` | Imported range rendered to a non-silent 4 s WAV, peak -13.4 dBFS |
| `native31-event-seconds-corrected.jsonl` | Event tree with audio start 8 s / duration 4 s and MIDI-part timing |
| `native31-event-move.jsonl` | Audio start 8 to 12 s, host readback confirmed |
| `native31-event-trim.jsonl` | Audio duration 4 to 2 s at 12 s, host readback confirmed |
| `native31-event-edit-render.jsonl` | Edited range rendered to a non-silent 2 s WAV, 44100 Hz / 16-bit, peak -13.4 dBFS |
| `native31-note-fields.jsonl` | Native note pitch/velocity/channel matched the preserved source MIDI |
| `native31-note-{pitch,velocity,position,duration}.jsonl` | Four fields on the same note confirmed by host getters |
| `native31-note-stale-rejected.jsonl` | Stale original values rejected before mutation, error 1306 |
| `native31-edited-save-as.jsonl`, `native31-edited-reopen-model.jsonl` | New CPR and fresh-process semantic readback |
| `native31-note-offset-corrected-{position,duration}.jsonl` | Nonzero part: project seconds and local ticks agree after the context fix |
| `native31-final-save-as.jsonl` | Final corrected state saved to new `Native31-Verified.cpr`, 287504 bytes |

Fixtures are under `artifacts/managed-projects/session-31/native-a/`. The original `Native31.cpr`, independently reopened `Native31-Edited.cpr` and final `Native31-Verified.cpr` are retained. Other export combinations are admitted only when actual host tables and output headers agree. Final native/TypeScript builds, PowerShell parsing and 193 tests passed. These results do not certify track factories, plug-in unloading, note insertion/deletion/undo, automation, routing, tempo-track or arranger/score work.