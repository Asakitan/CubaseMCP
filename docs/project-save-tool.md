# `cubase_project_save`: one Save plus file observation

This 25th MCP tool combines the existing prepared MIDI Save with read-only file sampling. It does not add a second Cubase execution backend, choose a destination, perform save-as, open a project or drive a dialog.

## Input

```json
{
  "session": "CURRENT_SESSION",
  "projectPath": "E:\\PROJECTS\\PROJECT.cpr",
  "confirmCurrentProjectPath": true,
  "observationTimeoutMs": 5000
}
```

The caller confirms that the existing CPR is the intended current project's destination. MIDI Remote does not independently establish that path. The tool accepts an absolute regular `.cpr` between 12 bytes and **64 MiB**, rejects symbolic links/junctions in its path, and requires stable preflight bytes before entering Save. The observation timeout is 500–30,000 ms, default 5,000 ms; the MIDI handshake has its separate configured deadline. Path validation and reads are sequential, not a defense against a hostile same-user path race.

The byte bound limits this observation tool, not the fixed `project.save` command's host-side file size. There is no automatic switch to another method when a bound or preflight fails.

## Result and uncertainty

- `save`: the underlying submission receipt, including the **new primary `session`**. Use it for new discovery; prior session/object IDs are stale.
- `file.state: "changed_stable"`: bytes differ from the preflight snapshot and two or more observations span at least 400 ms with matching bytes and metadata. No hash/checksum or CPR decoding is used.
- `file.state: "change_not_observed"`: content change was not established before the observation deadline. Unchanged bytes or metadata-only changes are not reported as saved contents. A clean project may legitimately save without a content change; no mutation is repeated to decide that.
- `file.pathSource: "caller_asserted_current_project"`: the path is not an independently recovered active-document identity.
- `semanticReopenVerified: false`: this tool does not restart Cubase or compare the project model after reopen.

There is exactly **one** Save mutation call. Subsequent work is read-only sampling. A transient missing/short file during host replacement is sampled until the same deadline, not an alternate Save route. Preflight failure is `not_started`; observation failure/cancellation after Save is `unknown`, with the known Save receipt retained in error details. Normal unchanged observation returns its explicit unconfirmed state, not an invented persistence success.

Stable changed bytes are not an atomic document-to-file correlation, a host durable-flush callback or a guarantee of semantic content. The separate real MCP tempo/save/fresh-reopen observation is documented in [session 28 evidence](project-save-chain-28.md).

## Necessary verification

The final TypeScript build and two focused checks passed: obsolete-bridge gating for all session operations, and one in-memory MCP test covering 25-tool discovery, changed/stable bytes, unchanged bytes and missing-path rejection before mutation. Each accepted call submitted Save once; preflight rejection submitted none. Temporary test files were created under E-drive `artifacts/scratch-temp` and removed within that exact generated directory.

Logs: `artifacts/ipc/save-observer-build.log`, `save-observer-focused.log`. This new file-observation wrapper has **not** been separately live-certified; its underlying MIDI Save/reopen chain was already observed on the owned CPR, and no unchanged live acceptance was repeated just for reassurance.
