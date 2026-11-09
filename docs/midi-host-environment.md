# MIDI Remote host environment snapshot

Date: 2026-11-10. This investigation uses static inspection of the installed Cubase 16.0.5 Windows x64 executable and a bounded read-only process snapshot. It does not change the running process, ports, preferences or UI. RVAs describe this installed build and are not a supported API.

## Static type and direction evidence

- The already established `DomainModel` global shared-reference storage is executable RVA `0x595a4c8`; its object vtable is `0x45fae68`. At `0x30c16be` the model initialization calls `0x2fddc20`, which calls the `HostEnvironment` constructor `0x301b6b0`, and then assigns the returned shared reference to model `+0x50` at `0x30c16c9–0x30c16d1`. `HostEnvironment` RTTI's vtable is `0x45fa638`.
- Input creation at `0x313d55a` calls `0x2fe1200`, which calls the `HostMidiInput` constructor `0x301c7d0` (vtable `0x45fa5a8`); the created object's string-shaped field `+0x28` is assigned and the shared pair is appended to the environment vector at `+0x28` beginning at `0x313d5cd`.
- Output creation at `0x313d93a` calls `0x2fe15b0`, which calls the `HostMidiOutput` constructor `0x301c9e0` (vtable `0x45fa608`); its corresponding name field `+0x28` is assigned and the shared pair is appended to the environment vector at `+0x40` beginning at `0x313d9ad`. The element stride is 16 bytes. Both constructors initialize an MSVC string-shaped object at `+0x28`, length `+0x38`, capacity `+0x40`; object ID `+0x18` is an internal runtime number, not a durable port identity.
- The detection lambda accesses those same two environment vector offsets through the distinct helper paths described in `docs/midi-detection-ports.md`. Presence in these collections would establish model candidates, not necessarily filter acceptance or an active MIDI Remote mapping.

## Bounded snapshot

On 2026-11-09 at `17:08:31.7255307Z`, `scripts/Read-MidiHostEnvironment.ps1 -TargetProcessId 3720` returned `status=observed`, `stable=true`, model `0x7bfd3ab0`, environment `0x7c15fc70`, **zero entries in each input and output vector**, and a live process after the read. The JSON evidence is `artifacts/ipc/midi-host-environment-3720.json`, transcribed from the diagnostic output with an added verification summary. The preceding 17:07:50Z read likewise returned empty collections, but lacked the later explicit process-start check and is not the final evidence.

The diagnostic verified the launch metadata PID/private desktop, process start against launch file timestamp and again after reading, exact executable and file version `16.0.5.174`, image base `0x140000000`, and 15 target-owned private-desktop windows. It checked the live model and environment vtables; limited vectors to 64 elements, strings to 512 bytes, and checked vtables and stable repeated headers/elements for any elements. Model/global/environment headers were reread and agreed. Because both vectors had zero entries, **no element vtable, port name, identity, or name matching was observed**. The script returns exit 1 for an error, not an empty-success report. PID/launch checks and repeated reads reduce but do not eliminate races; the observation is point-in-time.

The coordinator had separately observed Windows MIDI endpoints and Cubase port clients. The two facts are not contradictory: the OS-visible or opened ports and the MIDI Remote host-environment collections are distinct layers. This snapshot explains why the expected names were not present in the inspected model at that moment, but it does not establish why the collections were empty, whether detection ran, whether another path supplied candidates, or whether port ownership caused the condition. No configured device activation or working bridge is asserted.

The coordinator independently ran the checked diagnostic at `17:09:02Z` and captured its unmodified output in `artifacts/ipc/midi-host-environment-main-3720.json`. Both collections again had zero entries and the stable-header checks passed. A separate invalid-PID invocation returned `status=error` and process exit code 1 before any process read. This remains an unlocked point-in-time observation, not proof of event history or root cause.

## Next discriminating step

Trace the native producer or synchronization path which populates `HostMidiInput` and `HostMidiOutput` in the MIDI Remote host environment, including its documented ownership/context and any bounded observable status. Do not infer that toggling a setting, opening a panel, recreating ports or altering a saved project will populate these vectors without separate evidence. Revalidate the process, executable, version and model before any new snapshot.

## Session 20 distinct-startup snapshot

In isolated PID 24036, `artifacts/ipc/midi-informer-samedir-24036-20.json` observed a 16-entry port registry with both MCP names in each of the MME input and output socket classes, the adapter in the informer observer vector, and informer `+0x60` and `+0x90` counts of zero. A separate validated stable snapshot `artifacts/ipc/midi-environment-samedir-24036-20.json` observed zero HostEnvironment input and output entries. These separate point observations reproduce the earlier separation of OS-facing registry presence and empty model vectors, not its cause, callback history, device activation or a working MCP handshake.

After a distinct same-directory host-open submission and the subsequent private activation prompt, a new point snapshot still showed the two informer counts at zero and the adapter in the observer vector; the script console still showed construction only (`artifacts/ipc/midi-informer-after-open20-24036.json`, `artifacts/ipc/midi-script-after-open20-24036.json`). The prompt was not operated. No new MIDI status request was issued merely in response to the unknown host-open submission.
