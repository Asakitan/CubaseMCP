# Session 38: sample-rate-safe audio import, and what a full production taught

Date: 2026-11-11.

## Request

During a full song production (`E:/VC/LabyRinth`, arrangement and mix through this server, vocal through the VOCALOID bridge) the owner asked that defects and missing features met on the way be repaired without asking.

## The defect

`cubase_audio_import` copies the source into the project `Audio` folder and hands it to the host's pool path. On that path Cubase does **not** convert a file whose sample rate differs from the project rate; it plays the samples at the project rate. The projects this server creates run at 44.1 kHz, so every 48 kHz layer ran 8.1 % slow and 1.47 semitones flat, drifting against the MIDI tracks (15 s late at the end of a 3.5-minute song).

Session 37 had already recorded the effect on another project file and left it as a known limitation. In this production it was met again and cost eight mix revisions: level and band comparisons against the reference still looked plausible, because a slowed vocal has nearly the same long-term spectrum. It was found by tracing kick pulses in two bars that should have been silent: they repeated every 0.363 s instead of 0.333 s (165 BPM instead of 180 = 44.1/48).

Evidence in the production: an envelope correlation of the solo vocal export against its source gave 0.99-1.00 at zero lag for a playback ratio of 44100/48000 and 0.13-0.18 for ratio 1.0. After re-importing 44.1 kHz copies the same test gave 0.62-0.97 at ratio 1.0 (inside the full mix) and at most 0.16 at the wrong ratio.

## The repair

- `src/project-rate.ts` reads the project sample rate from the saved `.cpr`: the setup record is stored under the class name `PArrangeSetup`, and the rate follows 72 bytes after the start of that name as a big-endian float32 (`47 2C 44 00` = 44100), then the record bit depth as a big-endian uint32. Two projects of this installation (67 KiB empty, 2.4 MiB arranged) carry it there. Only a standard rate is accepted; anything else reads as unknown.
- `src/resample.ts` converts a PCM / float WAVE file: polyphase windowed sinc for the exact ratio (147/160 for 48 to 44.1 kHz), 64 zero crossings per side at the lower rate, Kaiser beta 12, cut-off half a transition band under the lower Nyquist frequency so the stop band begins at that frequency. Output is 32-bit float; the source is never touched and an existing target is never overwritten.
- `cubase_audio_import` compares the two rates before anything is written. New input `sampleRateMismatch`: `convert` (default) writes the converted copy `<name>-<id>-<rate>Hz.wav` into the project `Audio` folder and imports that; `reject` refuses with `AUDIO_SAMPLE_RATE_MISMATCH`, `execution: not_started`; `ignore` imports the file as it is. AIFF and FLAC sources are not converted: a mismatch is refused with the same code unless `ignore` is passed. The result carries `sampleRate: { source, project, check, conversion }` with `check` one of `match`, `converted`, `imported_at_wrong_speed`, `project_rate_unknown`.
- When the rate cannot be read (unsaved or foreign layout) the import proceeds as before and says `project_rate_unknown`.

## Verification

- `node --test tests/*.test.cjs`: **212/212**. New: `tests/sample-rate.test.cjs` (record parsing, filter bank, tone at 1 kHz keeps length, pitch and level within 0.01 dB, 18 kHz within 0.1 dB, a 23 kHz tone above the new Nyquist is more than 90 dB down, file conversion in both directions, refusal of non-audio) and two scenarios in `tests/song-tools.test.cjs` (conversion before the host sees the file; match copied unchanged; `reject` writes nothing and calls no native operation; `ignore` reports the wrong speed).
- Real data: the built converter read 44100 Hz from the production's `.cpr`, converted a 213.7 s stereo 24-bit 48 kHz layer in 4.0 s, and the result differs from an independently made copy (SciPy `resample_poly`) by -139.8 dB, correlation 1.000000.
- **Not verified live:** the running MCP server of this session still had the old build loaded, so the production used pre-converted 44.1 kHz files through the unchanged tool. The new branch has fixture and real-file evidence, not a live Cubase import.

## Findings from the production (how the tools behave in practice)

- **One HALion Sonic instance per MIDI import.** Every file track is routed to a new 16-part instance with its own mixer channel (`HSSE Main (n)`), so one import is one mixer group. Simultaneous program changes are dropped: stagger them (0.45 beats apart) and leave a pre-roll before the first note. The GM kit ignores kit program changes.
- **A MIDI track's fader is CC7.** A controller written in the part overrides it later in the same pass; change the level in the file or on the instrument channel.
- **The channel-strip EQ accepts values but does not reach the export** (proved by stem band comparison). Use the input filter (`PreGain`, `LC`, `HC`) and insert plug-ins (DJ-Eq, ToneBooster, Limiter). Frequencies need `mode: "display"` (`"300.0Hz"`).
- **Observation is per listing.** A `cubase_channels_list` / root `cubase_objects_list` page replaces what counts as observed; list the page that contains the channel right before `cubase_channel_set`, and walk root -> channel -> Inserts -> slot -> plug-in again after every `cubase_plugin_set` or import.
- **Faders through `cubase_channel_set` take the normalized value**; the receipt shows the dB it became (0.7891 = 0 dB, 0.8761 = +3, 0.6613 = -3, 0.6307 = -3.9, 0.5391 = -7). A negative number is refused by the schema.
- **`cubase_track_edit remove` works on audio tracks** and leaves the other object IDs intact; six replaced layers were removed this way without a prompt.
- **Automation:** `cubase_events_list` gives the device track's `eventId` and the root; `cubase_automation_read` shows the volume lane; `insert` with `expected.pointCount` and `setValue` with the exact previous time and value both read back confirmed. Switch `automationRead` on for the channel.
- **Export from a 44.1 kHz project at 48 kHz** raises inter-sample peaks of limited transients; a limiter ceiling of -1 dB still produced full-scale samples, -2 dB did not.
- **Startup refusal "Unexpected startup marker was preserved"** came from a zero-byte `%APPDATA%/Steinberg/Cubase 16_64/ApplicationStarted.txt` left by an earlier run. Moving it away while no Cubase process existed let `cubase_project_create` succeed.

## Remaining

A live import through the new branch after the server is restarted (done in [session 42](session-42.md): match, reject and convert all ran against the real host); conversion of AIFF/FLAC sources; reading the rate of a project that was never saved.
