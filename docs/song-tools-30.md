# Song tools (session 30)

This document records the session-30 baseline. Session 31 replaces audio export with parameterized native NonUI export and adds audio import, event/note discovery and guarded single-note edits; see [native file services](native-file-services-31.md) for current contracts and evidence. Old limits below describe the earlier implementation.

These tools cover the path an agent needs to build a song in the owned background instance: create MIDI tracks with notes, read them back, organise and mix tracks, drive the transport, and export the result as audio. They are built from three host mechanisms that were each verified on Cubase AI 16.0.5.174:

- DirectAccess parameters of mixer channels and of the transport object (read and written by the MIDI Remote script),
- the fixed key-command allowlist (see [command allowlist](command-allowlist-30.md)),
- one additional native lifecycle operation, MIDI file import, run on the event thread like create/open/save-as.

No tool sends input to a window or brings one to the foreground, and no write is repeated. Session 30 used the host export window; session 31's replacement does not open it. Every tool needs the current `session` unless noted.

## Typical sequence

1. `cubase_project_create` (or `cubase_project_open`) gives the managed project and a session.
2. `cubase_tempo_set` and `cubase_transport_set` (`field: "signature"`) set tempo and time signature.
3. `cubase_midi_import` with a `song` creates the MIDI tracks and their notes.
4. `cubase_midi_read` returns what Cubase holds; `cubase_channels_list` shows the tracks.
5. `cubase_channel_set`, `cubase_track_edit`, `cubase_command_execute` (quantize, legato, transpose, ...) edit; `cubase_midi_read` again confirms.
6. `cubase_transport_action` plays and stops; `cubase_audio_export` writes the mixdown; `cubase_project_save` stores the project.

## Tools

| Tool | Bridge operation | What it does |
| --- | --- | --- |
| `cubase_channels_list` | `channels.list` | Mixer channels in project order with `typeName`, `title`, `uniqueIdString` and the fields `name`, `volume`, `pan`, `mute`, `solo`, `selected`, `monitor`, `recordEnable`, `automationRead`, `automationWrite`, `midiChannel`, `input`, `output`, `freeze`. Each field reports `value`, `display`, and the `objectId`/`tag` that carry it; those parameters are admitted for `cubase_parameter_set`. |
| `cubase_channel_set` | `channels.set` | Writes one field of a listed channel. Requires `expectedUniqueId`. `name` takes text; switches take a boolean; `volume` and `pan` take a normalized number or the host display text. `selected: true` selects exclusively. |
| `cubase_transport_state` | `transport.state` | playing, stopped, recording, cycle, punch in/out, metronome, precount, cursor in both time displays, cycle locators, signature, last observed tempo. |
| `cubase_transport_set` | `transport.set` | `signature` (`"3/4"`), `cycle`, `metronome`, `precount`, `punchIn`, `punchOut`. |
| `cubase_transport_action` | `transport.action` then `transport.state` | `start`, `stop`, `returnToZero`, `gotoEnd`, `gotoNextMarker`, `gotoPrevMarker`, `stepBar`, `stepBackBar`; returns the state before and `settleMs` after. |
| `cubase_midi_import` | native operation 4 | Adds MIDI data as new tracks, from a `song` in beats or from an existing `.mid` file. |
| `cubase_midi_read` | command `midi.writeFileToProjectFolder` + file parse | Returns the MIDI content Cubase writes for the project. |
| `cubase_audio_export` | commands `export.openMixdownWindow` and `export.perform` + file inspection | Writes an audio mixdown of the locator range with the host's export and reports the file. |
| `cubase_track_edit` | `channels.set` + fixed command sequence | `duplicate`, `moveUp`, `moveDown`, `moveFirst`, `moveLast`, `clearEvents`, `remove` for one channel, with selection confirmation and a before/after channel comparison. |
| `cubase_runtime_windows` | read-only window inventory | Visible windows of the owned process; `unexpected` is everything that is neither the project window nor the Hub. No session needed. |

### Channel fields and tags

The tags are the DirectAccess parameter tags observed on this build. Titles of these parameters are localized, tags are not.

| Field | Audio-type channels | MIDI channels |
| --- | --- | --- |
| name | 1024 (text) | 1024 |
| volume | 1025 (display in dB) | 1025 (MIDI volume 0–127, "off" when unset) |
| pan | child object of type `Panner`, tag 4201 | 1026 |
| mute / solo | 1027 / 1028 | 1027 / 1028 |
| selected | 4000 | 4000 |
| monitor / recordEnable | 4001 / 4002 | 4001 (MIDI Thru) / 4002 |
| automationRead / automationWrite | 4014 / 4013 | 4014 / 4013 |
| midiChannel | – | 4006 |
| input / output | 4101 / 4102 | 4007 / 4008 |
| freeze | 4113 | – |

`midiChannel`, `input`, `output` and `freeze` are reported only. Their process values are native indices, and a write path for them was not verified. Tracks without a mixer channel (marker, chord, video, folder, ruler) do not appear in the list. Cubase can list the last channel twice; the repeated entry is skipped and counted in `duplicatesSkipped`.

Soloing a channel also solo-flags the channels it feeds, and a mute written while another channel is soloed follows the host's own solo/mute rules; read the list again instead of assuming the resulting flags.

### Transport object

`transport.state` reads the transport DirectAccess object by fixed tags and checks each tag's title, which on this build is an internal identifier (`start` 4015, `stop` 4016, `record` 4019, `cycle` 4022, `punchIn` 4020, `punchOut` 4021, `time` 4023, `time2` 4101, `timeFormat` 4025, `timeFormat2` 4102, `signature` 4027, `cycleLeftTime` 4030, `cycleRightTime` 4031, `cycleDuration` 4051, `metronomeOn` 4099, `precountOn` 4100, `returnToZero` 1, `gotoEnd` 2, `gotoNextMarker` 3, `gotoPrevMarker` 4, `stepBar` 5, `stepBackBar` 6). A tag with a different title is treated as absent and its field is `null`. The object has no tempo parameter; `tempo` is the value the host last reported through the time-display callback and stays `null` until then.

## MIDI import

`cubase_midi_import` takes exactly one of:

- `song`: `{ ppq?, tracks: [{ name?, channel?, program?, notes: [{ pitch, start, duration, velocity? }], controlChanges?, pitchBends? }] }`. `start`, `duration` and `beat` are quarter-note beats from the project start. `channel` is 0–15 (9 is the General MIDI drum channel), `program` a General MIDI program written as a program change at beat 0.
- `midiPath`: an existing local `.mid`/`.midi` file (22 bytes to 16 MiB, `MThd` header).

A `song` is written as a format-1 Standard MIDI File to `<project folder>/MCP MIDI/import-<UTC time>-<id>.mid`. Its conductor track carries the current project tempo and time signature: Cubase turns a conductor track without events into an empty MIDI track, and a host that applies the file's tempo then changes nothing.

The file is imported once by native operation 4 (`scripts/Project-Runtime.ps1` action `import_midi`, `native/bridge/CubaseProjectCreate.cpp` `importMidiFile`). The operation mirrors what the host does after a file has been chosen in File > Import > MIDI File: it opens the file through the host file system object, creates the host's MIDI file filter, sets its merge flag and lets it import into the active project. It checks every vtable it calls against the 16.0.5.174 image and requires that the managed document and its path are unchanged afterwards. It does not choose a file, show a dialog or change a preference.

Consequences of using the host's own import:

- The Cubase MIDI import preferences of this installation apply. Here (`Destination = HALion Sonic multi-timbral`) every file track becomes a MIDI track routed to a HALion Sonic instance that the import creates, and the program changes stay on the tracks. The exported audio of such a project contains sound; which sound each program selects was not checked by ear.
- **Every import creates its own HALion Sonic instance** (`HSSE Main`, `HSSE Main (2)`, ...). Import a whole arrangement in one call where possible. An instrument channel is not a track: it cannot be removed with `cubase_track_edit`, and an unused one stays in the project.
- Tempo and time-signature events of the file are not applied when merging into an open project (`tempoAndSignatureApplied: false`). Use `cubase_tempo_set` and `cubase_transport_set`.
- Import always adds tracks. To replace the content of a track, clear or remove it with `cubase_track_edit` and import again. Events can also be moved between tracks with commands: select the source track, `edit.selectAllOnTracks`, `edit.cut`, select the destination track, `edit.pasteAtOrigin` (observed: four notes moved from one imported track onto another, positions kept).

The result names the file, the native result and the channels the import added. Import time on this machine is about 1.5 s.

## MIDI read

`cubase_midi_read` executes the key command "Write MIDI File to Project Folder" once, waits for a new or changed `.mid` file in the managed project folder whose bytes are stable, and parses it with `src/smf.ts`. Cubase overwrites `<project name>.mid` silently on each write. The result has `tempos`, `timeSignatures`, `markers`, per-track summaries and a page of notes in beats (`track`, `noteOffset`, `noteLimit`, `includeControllers`).

What Cubase writes, as observed:

- every unmuted MIDI track that has events, in project order after the conductor track; track selection does not matter;
- not muted or solo-muted tracks (they are listed in `mutedChannels` when their mute flag is set) and not empty tracks;
- notes, program changes and controller events as imported; tempo and time signature of the project.

When nothing is written, the tool returns `MIDI_FILE_NOT_OBSERVED` with execution `submitted`; it never presents an older file as the current content.

## Track edits

`cubase_track_edit` needs `objectId` and `expectedUniqueId` from `cubase_channels_list`. It selects that channel through its `selected` parameter, waits until Cubase reports exactly that one channel as selected (otherwise `SELECTION_NOT_CONFIRMED`, and no command runs), and then executes the fixed sequence once:

| Action | Commands |
| --- | --- |
| duplicate | `track.duplicate` |
| moveUp / moveDown / moveFirst / moveLast | `track.move.previous` / `.next` / `.first` / `.last` |
| clearEvents | `edit.selectAllOnTracks`, `edit.delete` |
| remove | `edit.selectAllOnTracks`, `edit.delete`, `track.removeSelected` |

Cubase asks for confirmation before it removes a track that still has content. That prompt cannot be answered by this server, so `remove` deletes the track's events first, and `track.removeSelected` is refused by the bridge (`COMPOSITE_REQUIRED`) unless it comes from this tool. The result lists every step with its host binding event, the channels before and after, and `windows.unexpected`. If a window appears anyway, nothing touches it: the note in the result says to replace the owned instance.

New tracks without MIDI data: `cubase_command_execute` with `track.add.audioMono`, `track.add.marker`, `track.add.chord` or `track.add.video`. The other Add Track commands of this build open the Add Track dialog and are not in the allowlist; MIDI tracks come from `cubase_midi_import`.

## Audio mixdown export

`cubase_audio_export` uses the export function of Cubase itself. Two key commands of the host do the work:

1. `File / Export Audio Mixdown` opens the export window. The window belongs to the owned process and appears on its private desktop, not on the user's desktop.
2. `Audio Export / Perform Audio Export` starts the export with the settings of that window. Cubase performs the export offline and closes the window when it is done.

The server sends no input to the window and does not change its settings. On this installation the window has never been used interactively, so the defaults apply: a stereo WAV (44.1 kHz, 32-bit float) of the main output, written to `<project folder>/Mixdown/<project name>.wav`, for the range between the left and right locators.

What the tool does around those two commands:

- It refuses to start while the transport runs (`TRANSPORT_RUNNING`), while any unexpected host window is open (`HOST_WINDOW_OPEN`), or when the locator range is empty (`EXPORT_RANGE_EMPTY`): an empty range makes Cubase show an alert instead of exporting. `range` (`left`, `right` in the primary time format, for example `"1.1.1.0"` and `"9.1.1.0"`) sets the locators first.
- Cubase asks before overwriting an existing export file, and that prompt cannot be answered here. So the tool first renames any file in `Mixdown` that carries the default name, and renames the new file to `<project name> <UTC time>.wav` when the export is finished. Each call therefore returns its own file.
- It waits until `Perform Audio Export` becomes performable (otherwise `EXPORT_NOT_READY`), sends it once, and then waits until a new audio file in the project folder has stopped growing and the export window is gone. If no file appears before `timeoutMs` the result is `EXPORT_FILE_NOT_OBSERVED` with execution `submitted`; if a window stays open, the error says to replace the instance.
- It reads the written WAV (`src/wav.ts`) and returns sample rate, channels, bit depth, length, peak and RMS level, `silent`, and the time of the last non-silent sample.

Both export commands carry the composite marker in `remote/commands.js`; `cubase_command_execute` cannot run them.

Limits: format, bit depth, sample rate, output channel, file name and folder are whatever the export window of the installation holds. If the user changes those settings in their own Cubase, the next background instance may export elsewhere or in another format, and a folder outside the project is not watched. Stems and per-channel export are not offered. The host does not report a binding event for `Perform Audio Export` reliably, so the written file is the only completion evidence.

Observed (acceptance run `e2e1`): eight bars at 104 bpm exported in 7.4 s to a 6,515,326-byte file, 44.1 kHz stereo 32-bit float, 18.462 s long (exactly eight bars), peak -12.9 dBFS, sound up to the end; a second export immediately afterwards produced a second file and left no window. An earlier manual probe showed what happens without the renaming: the second export with the same name opened the overwrite prompt and wrote nothing.

## Evidence

- Channel fields, transport fields and actions: live scenario on project `artifacts/managed-projects/session-30/song-a` (rename, mute, solo, select, volume `"-6"` → -6.00 dB, pan 0.25 → L50, MIDI volume and pan; cycle, metronome, precount, signature 4/4 ↔ 3/4; stepBar, gotoEnd, returnToZero, start, stop).
- MIDI write content rules and the empty-then-remove sequence: `song-b`.
- Import → read round trip and every edit command: `artifacts/ipc/command-verify30-*.jsonl`, summarised in the [command allowlist](command-allowlist-30.md).
- Whole workflow through the real MCP server, 28 of 28 checks: `scripts/verify-song30.cjs`, evidence `artifacts/ipc/song30-live-e2e1.json`, project and exported files in `artifacts/managed-projects/session-30/song-e2e1`. It ends with Save, a fresh-process reopen and an identical read-back of the edited song.
- What a second import adds, moving events between tracks, and the export probe: project `exp-a`.
- Contract tests: `tests/song.test.cjs`, `tests/wav.test.cjs`, `tests/song-tools.test.cjs`, the session-30 section of `tests/remote.test.cjs`.

## Plug-ins

`cubase_plugins_list` and `cubase_plugin_set` work on a slot object found through `cubase_objects_list` (channel → `Inserts` → `Slot`). Loading MonoDelay into the first insert slot of the instrument channel and replacing it with another effect opened no window, and the insert-viewer controls of that slot (`track.insert.slot.0.on`, `.bypass`, `.parameter.N`) were then writable with host feedback. There is no tool that unloads a plug-in: the host call `resetSlotPlugin` opens a confirmation prompt that blocks the MIDI Remote script, and assigning an empty type UID is refused. Replace the plug-in or switch it off instead.

## Not covered

Audio file import and audio event editing with read-back, export settings (format, stems, channel selection), instrument or FX track creation other than through MIDI import, removing an instrument, instrument presets, automation data, and bus routing writes are not implemented. A single existing note cannot be edited in place; notes change through commands on a selection or by replacing a track's content. See [feature coverage](feature-coverage-30.md).
