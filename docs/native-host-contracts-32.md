# Remaining host contracts (session 32)

Historical snapshot. Current implementations, failed persistence checks and
the two crash-dump analyses are in [session 33](native-host-contracts-33.md).

Target: installed Cubase AI 16.0.5.174, timestamp `0x6adf121b`. Full coverage is
not complete. No new formal operation was published: the unsuccessful MIDI-track
prototype was withdrawn, retaining the 47-tool, native-operations-1..8 baseline.

## Track creation

The withdrawn operation-9 prototype read `track-create.bin`, exactly 528 bytes: version and kind
as two u32 values, current root as u64, then 256 UTF-16 units for the name. Kind
1 represented an empty MIDI track; other kinds were rejected. Root, stopped
transport and pre-call windows were checked before the factory was entered.

The candidate sequence was factory `0x225f780(root)`, name setter at virtual `0x1b0`,
owning-project setter at `0x1f8`, and root track-list insertion at `0x130`
(`0x2784c50`). Host caller `0x1f625f0` provides the owning-project evidence.
Construction and insertion alone do not certify a usable track or an undo step.
The canonical importer also sets a root-derived time base, updates an index map
and sends post-insert notifications. Mixer factory `0x2c712d0` operates on the
global mixer pointer at RVA `0x5943ad0`, not on `MRoot`; these objects are not interchangeable.

The first live version omitted the owning-project setter. It returned a named
`MMidiTrackEvent` at path `[4]`, and tree size increased 14 to 15. No mixer channel
was confirmed; three error windows were subsequently observed and MIDI reads
timed out. That instance was discarded without saving. The corrected sequence
and post-call window rejection passed compilation and focused MCP tests, but
the corrected sequence was not run on a clean host and was then withdrawn.

`cubase_track_create` is not exposed. A future implementation must confirm both
a matching native tree object and a new matching mixer channel, with a clean
window sample. Instrument, group, FX and folder factories, edition admission,
notifications and undo are not certified. The current code does not offer an
operation-9 request or accept that number in the native loader.

## Plug-in unloading

The installed public API exposes `trySetSlotPlugin` with `dontAskDiscard`, but
`resetSlotPlugin` has no such argument. Prior live reset calls opened a prompt;
an empty UID was refused. The reset wrapper reaches `0x245aaa0`, resolves a slot
through `0x2459c70`, then calls its virtual `0x450` with an empty type/options
structure. The corresponding `trySetSlotPlugin` body at `0x245c650` rejects an
empty type before resolving a slot and sets option word `0x01010001`, whereas
reset sets zero. This locates the relevant policy difference but does not prove
an individual flag's meaning. The resolver also needs a live mapping handle;
its native acquisition and safe slot identity remain unresolved. No unload
tool is published, and no option bit or all-zero UID is guessed.

## Automation and routing

Automation data types are distinct from read/write switches. Static strings
identify `MAutomationNode` (`0x41b1e60`), `MAutomationTrackEvent` (`0x41dd2c8`) and
`MAutomationTrack` (`0x4206c40`). No complete node creation/edit transaction has
been certified. The missing pieces are the node value accessor, its parameter
binding, container-specific insertion/removal and undo transaction. The generic
event-tree name or automation read/write switch is not parameter identity.

Audio input/output tags 4101/4102 expose project-scoped discrete values: this
fixture had input 19 / `Stereo In` and output 22 / `Stereo Out`; the earlier
`native31-channel-routes.jsonl` had 2 and 5 for the same labels. They are neither
normalized 0..1 values nor stable target identifiers. An earlier parameter dump
reports type `discrete`, unlocked and non-automatable. One explicit display-write
probe for `No Bus` returned the original 22 / `Stereo Out`; it is a negative
result. The public API supplies no destination-list enumeration, and send-slot
bindings expose on/pre/level, not destination identity. Routing therefore needs
actual target enumeration, identity admission and a verified setter.

## Runtime blocker and evidence

The original `Native31-Verified.cpr` remains unchanged. Save-as created the
separate `artifacts/managed-projects/session-32/contracts-a/Contracts32.cpr`.
After discarding the failed in-memory experiment, the next owned instance
(PID 47292, creation FILETIME 134387654154762255) displayed `Checking licenses...`.
The empty-readiness check timed out before the native open was submitted. No
licensing setting, check, credential or window input was changed.

The blocked empty instance was then explicitly stopped. The final owned state
is `running:false`; the original and copied project files remain on disk.

Evidence under `artifacts/ipc/`:

| File | Observation |
| --- | --- |
| `native32-track-callers.json` | Bounded decoded factory caller context |
| `native32-fixture-save-as.jsonl` | Separate native-saved test copy |
| `native32-route-display-probe.jsonl` | Output route did not change |
| `native32-track-create-a.jsonl` | Tree insertion, no mixer confirmation |
| `native32-after-track-windows.jsonl` | Three host error windows |
| `native32-clean-reopen-a.jsonl` | Empty readiness failed, no native open |
| `native32-reopen-blocker-windows.jsonl` | License-checking window |
| `native32-blocked-host-stop.jsonl` | Owned empty instance stopped |

Strict C++ syntax and TypeScript/native builds passed. The full suite passed
194/194 with the temporary prototype; after withdrawal, four affected exposure
checks and both PowerShell syntax checks passed. The final source contains the
193-test baseline with an added assertion excluding the unverified tool. These
checks do not replace clean-host, undo, save and fresh-process reopen acceptance.