# Session 36: Capability Discovery Without a Running Host

Date: 2026-11-11.

## Request

The Cubase capability query returned `MIDI_TIMEOUT`; find and fix the cause.

## Cause

The failing call was `cubase_capabilities` at 2026-11-10T15:23:34Z. It ended after
8004 ms, exactly the configured MIDI timeout, and an explicit
`cubase_connection_reset` ended after 8014 ms in the same way. The owned host had
already been stopped at 15:10:10Z, so the two virtual ports were present but no
MIDI Remote controller answered. `cubase_capabilities` performed only a raw
`bridge.status` request, so an absent host surfaced as a transport timeout with
`execution: "unknown"` and faulted the shared client.

## Work

- `cubase_capabilities` now reads the owned-runtime inventory first (no MIDI
  handshake) and then performs a bounded 2000 ms read-only `bridge.status`.
  `host` is `null` when nothing answers, and `hostState` carries `observed`,
  `compatible`, `readOnly`, `timeoutMs`, the transport `code`/`message` and a
  `nextAction` that distinguishes "no owned host" from "host running but the
  mapping is silent".
- `MidiClient` accepts a per-request `RequestBudget`. A read-only request that
  receives no reply reports `execution: "not_started"`; when no other
  non-look-up request is pending, the silent channel is disposed and the next
  request opens both ports again. Nothing is resent. With a mutation pending,
  the previous fault behaviour is unchanged.
- `bridge.status` is always sent as read-only, so `cubase_status` and
  `cubase_connection_reset` now report `not_started` instead of `unknown` on a
  missing host while keeping the configured 8000 ms budget.
- A client that is not usable after the probe (`MIDI_FAULTED`, `MIDI_CLOSED`,
  `HOST_VERSION_MISMATCH`) is replaced before the capability response, so later
  calls are not poisoned. No request is replayed.

## Verification

- `npm run build` passed; `npm test` passed **201/201** (two focused tests were
  added: capability discovery against a silent bridge, and a read-only miss that
  reopens the channel without replay).
- Real stdio MCP against the current machine, where the ports exist but no
  Cubase answers: `cubase_capabilities` returned `ok: true` in 2860 ms with
  `host: null`, `hostState.code = "MIDI_TIMEOUT"`,
  `hostState.nextAction = "No owned Cubase host is running..."` and
  `runtime.running = false`; a second call and a call after an 8004 ms
  `cubase_status` timeout both returned the same successful shape.
- No Cubase instance was started, focused or modified for this change.

## Remaining

A live host was not available during this session, so the 2000 ms capability
budget has not been exercised against an answering controller; `cubase_status`
retains the full configured budget for that handshake.
