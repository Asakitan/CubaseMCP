# Control and command writes that the host never applied: root cause and fix (session 30)

## Symptom

Since session 24 some binding writes were submitted and echoed by the surface but never produced host feedback: the selected-track volume, a bank-channel volume, and later every command pulse except Save. `cubase_control_set` returned `submitted`, the surface variable changed, and Cubase did nothing. The Save command worked because it lives on its own tiny mapping page.

## What was measured

The diagnostic controller in `diagnostics/binding-scale-30/` builds the production control table on several mapping pages and adds probe controls at the start and at the end of the surface. It was run on the owned private-desktop instance with `scripts/run-binding-scale30.cjs`; every run wrote a ledger under `artifacts/ipc/`.

| Experiment | Result | Conclusion |
| --- | --- | --- |
| Same controls split over 13 pages, probes created early and late (`binding-scale30-35232-*.jsonl`, `binding-scale30-58020-*.jsonl`) | Small pages worked, the page with the mixer bank did not; early and late probes behaved the same | Not surface creation order and not the number of surface variables as such |
| Variants of the production controller without one feature each: no bank, basic bank, bank sends, bank viewers, no viewer identities, short names (`binding-variant30-*.jsonl`) | Only variants that kept the full bank feedback handlers failed | Not dotted variable names, not one specific binding type |
| Callback counters during page activation (`binding-counters30-full-counted-*.jsonl`) | Failing page: 2005 host-value callbacks, 0 surface callbacks, activation burst 4.41 s. Working page: 4451 host callbacks, 165 surface callbacks, 2.02 s | On a failing page the host stops delivering the activation burst before it reaches the surface values |
| `apionly`: callbacks keep every host API call but skip the table bookkeeping | Works | Host API calls inside callbacks are not the problem |
| `heavyonly`: callbacks do only the bookkeeping, no host API call | Fails exactly like the full controller | The script time spent inside the callbacks is the problem |

## Root cause

While a mapping page activates, Cubase calls every bound host value once. The 3.13 controller answered many of those callbacks by walking its whole table: `clearBankSlot`, `clearGroupObservation` and `clearTrackObservation` iterated about 2550 controls and 360 groups each time a channel identity or plug-in identity arrived. That made the activation burst take seconds. Cubase 16.0.5 gives up on the rest of the activation in that case, and the surface values of that page are left without host propagation for the lifetime of the mapping. Nothing reports the abandonment; writes simply have no effect.

This is why the failures looked selective: they depended on which page the control lived on and on how expensive that page's activation was, not on the control itself.

## Fix in controller 3.14

- **O(1) invalidation.** Observations carry epoch stamps (`stampSession`, `stampScope`, `stampGroup`). Invalidating a track, a bank slot or a plug-in group increments one counter; a record is checked against the counters when it is read (`isCurrent`, `renew`). No callback iterates a table any more.
- **Page split.** The main page holds transport, selected-track, quick-control, Control Room and command bindings (313 controls). All `mixer.*` controls (2237) live on a separate mixer page. `cubase_pages_list` and `cubase_page_activate` expose this; an operation for the inactive page returns `PAGE_INACTIVE`.
- **Activation is observable.** `bridge.status` and `pages.list` report host, display, surface and identity callback counts and the burst duration. A page that delivered at least 64 host callbacks and no surface callback is reported as `surfaceInput: "stalled"` and binding writes fail with `SURFACE_INACTIVE` instead of being submitted into the void.
- **Commands are pressed and released in separate idle callbacks**, and the binding event that the host reports for the press is counted. `cubase_command_execute` returns `bindingObserved`; `cubase_control_set` returns `confirmation.state` from host feedback inside a settle window.

## Live verification

Fresh owned instance, controller `2026-11-10-coverage-3.14`:

- Main-page activation burst **106–107 ms**, 535 host callbacks, 9 surface callbacks, `surfaceInput: "ready"` (3.13 on the combined page: 4.41 s and no surface callback).
- `transport.metronome` written through `cubase_control_set` and confirmed by host feedback in both directions.
- `transport.cycle` executed twice through `cubase_command_execute`, `bindingObserved: true` both times, and the cycle state changed.
- The full command table was then verified one command at a time, see [command allowlist](command-allowlist-30.md).

The two volume writes from sessions 24 and 25 are therefore explained: both controls sat on the page whose activation the host had abandoned. Their old unknown outcomes stay recorded as they were; they were not replayed.

## What this does not establish

The mixer page activates more slowly than the main page because it carries 2237 bindings (about 0.48 s against 0.11 s); its activation counters are reported so that a stall is visible. Every writable control of both pages was afterwards written once with host feedback as confirmation, see [control sweep](control-sweep-30.md). A control that is declared by the API and bound without error can still be unavailable in the AI edition or for a channel type.
