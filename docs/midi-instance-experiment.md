# Saved MIDI Remote instance experiment

Date: 2026-11-10. This is a single controlled experiment on an isolated test copy, not an MCP project-creation or runtime execution path.

## Method

The recovered test project contained a saved `test` / `test` MIDI Remote instance, not the `CubaseAI` / `MCP` driver. A separate file, `artifacts/live-smoke/MCP Device Test 20261110.cpr`, was created from that recovered copy. Within its existing instance block the experiment replaced the saved driver, mapping-page and port names with the target names and removed the unrelated device's SysEx-identity references. The script is fixed to this particular source, offset and block profile and is retained only under ignored `artifacts/research/session-08/make-device-instance-test.py`.

The original zlib block was 533 bytes and its decompressed representation was 1,543 bytes, including a `JsonString8` value of 1,514 JSON characters plus NUL. The candidate preserved those compressed and decompressed lengths, verified the zlib round trip, and verified that all bytes outside the block were unchanged. The original recovered project and its automatic backup were left intact. These checks establish the transformation's bounds, not a complete CPR format specification or valid Cubase semantics.

## Observed result

After the user-approved restart, Cubase PID 45628 opened the experimental project on `winsta0/CubaseAI_MCP`; foreground handles before and after launch matched. Both current virtual ports listed that process as a client, and its script console recorded construction of controller `2026-11-10-coverage-3.2`. A real status request timed out, and the console recorded no device or mapping activation. Evidence: `artifacts/live-smoke/device-test-startup.json`, `artifacts/ipc/midi-device-test-clients-45628.json`, `artifacts/ipc/midi-device-test-after-request-45628.json`, and `artifacts/runtime/before-coverage-3.3-20261110-040212/verification-coverage-3.2.json`.

Opening the file does not prove that Cubase accepted or instantiated the modified metadata. The experiment did not establish a working background activation procedure, save operation or project editing contract, and it is not promoted into the production MCP. Further work must distinguish block acceptance, external-driver matching and device activation with actual model evidence.

A subsequent bounded read of PID 45628 established that the target `CubaseAI` / `MCP` driver's `DeviceInstances` vector was empty at the snapshot. Static creation code establishes that this vector is at driver offset `0x1d0`; its three pointers were unchanged across the read. This confirms the candidate did not yield an associated instance at that time, but does not distinguish rejected metadata from a later matching or creation failure. Evidence: `artifacts/ipc/midi-device-model-45628.json` and `docs/midi-device-state.md`.

One later device-arrival experiment briefly created two differently named virtual ports without stopping the existing endpoint host. The target script log still showed only controller construction, and the existing endpoints still listed PID 45628. This does not prove that Cubase received an OS device-arrival event for those temporary ports. Evidence: `artifacts/ipc/midi-script-after-arrival-45628.json` and `midi-clients-after-arrival-45628.json`.
