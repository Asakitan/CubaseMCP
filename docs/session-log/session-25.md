# Session 25: Project framing and control-binding investigation

Date: 2026-11-10.

## Request

Continue the full background-only single-MIDI MCP goal, including project creation, storage and editing. Earlier unknown operations are not replayed.

## Evidence

- A fixed read-only process snapshot observed one root equal to the global root, a matching document back-reference and the lexical `First Empty Probe 24.cpr` candidate (`artifacts/ipc/current-project-path-25-72128-bd629cbb991942a0ad9eabaa565bf17b.json`). The snapshot is sequential, not authoritative active or save-target state.
- A distinct Stereo Out bank-channel `cubase_control_set` submitted `0.75`; the direct parameter and bank feedback remained `0.7890865802764893` in immediate and later reads. No restore or replay was sent. The independent observer captured 173 samples without a sampled target foreground or target input desktop (`docs/control-binding-25.md`).
- Static analysis connects `New` and `NewWithHub` to a conditional Hub service path. Save analysis found potential path mutation and a separate working path object; no destination or noninteractive completion is established (`docs/project-create-25.md`, `docs/project-save-25.md`).

## Work

- Added a bounded read-only CPR RIFF/NUND envelope inspector. The owned 93,085-byte fixture yielded 12 bounded chunks; ARCH contents, semantics, persistence and successful creation are not claimed (`docs/cpr-envelope-25.md`).
- Added a regression distinguishing a submitted surface echo from independent host feedback, and retained the separate fixed-process path candidate reader and file-only static inspectors.

## Verification

- Focused CPR framing test and live read-only fixture inspection passed. The project-path reader was parsed, exercised against the fixed identity and rejected a wrong PID; static branch scripts were checked against the installed image. `npm run build` and `npm test` passed with **93/93** tests.

## Remaining

Determine the binding propagation/takeover behavior without replaying either unconfirmed request. Establish authoritative project identity, creation arguments, safe destination, noninteractive save completion, and semantic reopen/persistence evidence. No MCP project create/save/event-edit implementation or full Cubase coverage is claimed.
