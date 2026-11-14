# Session 42: live check of the sample-rate import, and the 32-audio-track limit of Cubase AI

Date: 2026-11-11. Same production as session 38 (`E:/VC/LabyRinth`): the mix was rebuilt twice more (v22, v32) and every audio layer went through `cubase_audio_import`.

## Live verification of the sample-rate branch (open item of session 38)

Session 38 left the new import branch without a live Cubase run because the server process of that chat still had the old build. This chat's server already carried it, so all three branches were exercised against the real host (project at 44.1 kHz, layers at 48 kHz / 24-bit):

- **match:** fifteen layers that had been converted beforehand were imported with `check: "match"` and copied unchanged.
- **reject:** a 48 kHz layer with `sampleRateMismatch: "reject"` returned `AUDIO_SAMPLE_RATE_MISMATCH` with `execution: "not_started"`; no file was written and the channel list was unchanged.
- **convert (default):** the same layer returned `check: "converted"`, ratio 147/160, 140 taps per phase, and a 32-bit float 44.1 kHz copy in the project `Audio` folder. The import added one audio channel. A scratch project (`scratch_rate_test.cpr`, disposable) with a 10 s excerpt was exported through `cubase_audio_export` (48 kHz, 24-bit) and compared with the source excerpt: envelope correlation 1.0000 at lag 0, level ratio 1.000. The wrong-speed hypothesis (playback ratio 44100/48000) scored 0.0093 on the same pair, so the test discriminates.
- The saved production project was reopened afterwards; the fader values of the new channels persisted, and the master limiter read back with input +2.6 dB, output -2.0 dB and auto release on.

## Finding: Cubase AI 16 holds at most 32 audio tracks

The new mix added fifteen audio layers next to the audio tracks of the previous mix (muted, not removed). The 13th to 15th import returned `AUDIO_IMPORT_NOT_OBSERVED`: the native call returned, the converted file existed in `Audio`, the window state was clean, and no audio channel had been added. Counting the project's audio channels gave exactly 32. Removing three old audio tracks with `cubase_track_edit remove` and importing again worked; the 33rd track is what Cubase AI refuses. Nothing in the host's reply says so; the call looks like a success that did nothing.

Change (`src/server.ts`): the import failure path now counts the audio channels that existed before the call. If nothing was added, the window state is clean and the count is already 32 or more, the error is `AUDIO_TRACK_LIMIT_SUSPECTED` (execution `submitted`, as before) with a message that names the limit and the two ways out (remove a track with `cubase_track_edit remove`, or reuse a track), and `details.audioChannelsBefore`. Every other failure keeps `AUDIO_IMPORT_NOT_OBSERVED`. The constant `AUDIO_TRACK_LIMIT = 32` is at module level. The code says "suspected" because the host never reports the reason: the count and the clean window state are the evidence.

Test: `tests/song-tools.test.cjs`, "an import that adds no channel while the project holds 32 audio channels reports the Cubase AI track limit". With it the suite is **218/218**.

Status of the running server: the build in the production chat was compiled before this change, so the production chat itself still saw the generic code. The new message is in `dist/` after `npm run build` and appears once the server is restarted.

## What the review of the converter left as documented limits

The converter and the project-rate reader were reviewed externally earlier on 2026-11-11 (the source comments in `src/resample.ts` call that round "session 39"; this file is its numbered record). Fixed there: bounded filter bank and result size, refusal of a data chunk longer than the file or ending inside a frame or with the streaming size, refusal of non-finite float samples, measured stop-band attenuation on every phase, edge policy at both ends of the file. What remains a limit by design:

- **Rate source is the saved project.** `readProjectSampleRate` reads the `.cpr` on disk. A rate changed in a live project and not saved is not seen; an unsaved project reads as `project_rate_unknown` and the import proceeds unchanged.
- **First record wins.** `findProjectRate` takes the first `PArrangeSetup` record whose float32 is a standard rate. The layout was seen in two projects of one installation (Cubase 16.0.5); another layout reads as unknown rather than as a wrong number.
- **Source is read in separate passes** (header inspection, then conversion). A file that is rewritten between the two is not detected.
- **WAVE_FORMAT_EXTENSIBLE:** only the first two bytes of the sub-format GUID are used to tell PCM from float; the channel mask is ignored and channels are converted independently, in file order.
- **Sample formats:** 16 / 24 / 32-bit PCM and 32 / 64-bit float are converted; 8-bit PCM is refused as an unsupported format, AIFF and FLAC are refused unless `ignore` is passed.

## Findings from the production that belong to the tools

- `cubase_parameter_set` needs `root`, `mode` and a prior `cubase_parameters_list` of that plug-in. Tags and object IDs are valid for one session only; in the production's session the master limiter answered on tag 4210 (input) and 4205 (output), which means nothing in another session: list first.
- `cubase_audio_export` takes `left` / `right` for the range. `"1.1.1.0"` to `"161.1.1.0"` exported the whole 156-bar song; the file is longer than the source, so cut it to the source length afterwards.
- `cubase_track_edit remove` replies with about 5k tokens of listing each time; removing several tracks is cheap in time and expensive in context.
- `cubase_objects_list` takes `parentId` to walk root, channel, `Inserts`, slot and plug-in.
- Fader normalized value to dB, measured on this host: 0.6803 = -2.5, 0.7348 = -1.15, 0.7891 = 0, 0.8019 = +0.5, 0.8125 = +0.9, 0.8349 = +1.7, 0.8695 = +2.8, 0.9045 = +3.8, 0.9125 = +4.0.

## Not done

- A live check of the new error code (it needs a 33rd import into a project at the limit; the fixture test covers the branch).
- Conversion of AIFF / FLAC sources; the project-rate reader for projects never saved.

## 补充（同一天晚些时候：用干净工程替换换版本的旧工程）

- `cubase_track_edit remove` 只删通道和事件，**素材池里的片段和 `Audio/` 里的文件都不清**，允许列表里也没有"移除未使用媒体"。LabyRinth 的旧工程（v09）挂着 68 个导入音频（3.9 GB），活着的通道只有 16 条；要彻底去掉旧音频只能新建工程（`cubase_project_create`，替换当前会话要 `replaceCurrent` 与 `confirmDiscardChanges`），把需要的文件重新导入、重设推子和总线插入。
- 在旧工程里"删旧通道、导入新层"的换版本做法容易漏层：对照发现旧工程里的 `low_fx`、`sub_bass` 没有按流水线更新，已交付的几版缺了一处混音决定。新建工程后把导出与旧导出逐样本比较（差异只出现在漏掉的位置）是个有效的核对。
- 总线插件装进插槽（`cubase_plugin_set`）之后，原来的对象 ID 全部失效（`OBJECT_UNOBSERVED`），要从根重新 `cubase_objects_list` 逐级列下去，才能列到插件对象和它的参数；`cubase_parameter_set` 的 `normalized` 模式能精确复现旧值（限制器输入 0.5541666746 = +2.6 dB、输出 0.7333333492 = −2.0 dB）。
- `cubase_project_save` 之后后续调用要用返回里的 `save.session`；`cubase_audio_import` 的 `sampleRateMismatch: reject` 在 44.1 kHz 副本上返回 `check: match`，可当导入前检查。
