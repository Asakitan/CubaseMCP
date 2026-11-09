# Session 08: Isolated startup, native diagnostic and MIDI activation

Date: 2026-11-10.

## Request

Continue toward all Cubase MCP functionality, including project creation, saving and editing without foreground interaction, fallback execution or manual user steps. The full objective remains active and is not complete.

## Work and evidence

- The user approved restarting the owned isolated test instance and loading a fixed diagnostic DLL inside that process. The diagnostic loader validates the executable, process lifetime and private desktop; it is not an MCP execution backend.
- In PID 58536 the initial diagnostic acquired the registered project host without a request. In later PID 66528 the fixed read-only `GetMusicalTrack` request returned a correlated error callback, not project data. The host service pointer was null and `projectplugin.dll` was absent. The observed component-record mask test did not match the host mask; the reason for the absent module is not established. See `docs/native-probe.md` and `docs/service-admission.md`.
- Two startup markers explained the Safe Start branch. An independent crash analysis identified `ERROR_ACCESS_DENIED` during a scoring-engine cache open. The single administrator-owned candidate and its ACL were archived; after a fresh launch the current user recreated it and the recovered score project opened. The original dump did not retain the entire failed path. No unrelated cache or ACL was changed.
- A bounded script-console read found the installed entry's actual `ReferenceError: identifier 'module' undefined (line 7)`. A top-level-script regression reproduced it; the unnecessary export was removed. The coverage 3.1 controller adds bounded lifecycle messages, more declared controls, a compact status and separate control/group pages.
- The port host gained an explicit one-shot client-PID snapshot. A temporary-port test identified the child MIDI client on the selected port and not the unused port. Both real endpoints also passed a SysEx loopback test. After deployment, Cubase PID 17596 initially appeared as a client of both ports and logged controller construction, but neither device nor mapping activation was recorded and a real status request timed out. A controlled port-host hotplug followed by a fixed device notification left the new endpoints without that client.
- A separate experimental `MCP Device Test 20261110.cpr` was generated from the recovered copy by changing one existing compressed MIDI Remote instance block while preserving its compressed and uncompressed lengths. The original recovered project remains unchanged. Cubase opened the experimental copy in PID 45628 and logged controller 3.2 construction, but no mapping activation was recorded and status timed out. This experiment does not establish that the embedded instance was accepted or that MCP can create a project. Original test files and replaced controller files were backed up under `artifacts/runtime`; the current launch receipt is `artifacts/runtime/cubase-launch.json`.
- After preserving that test CPR, the prior installed driver and startup markers, revision 3.3 was deployed and the isolated host restarted as PID 3720 with holder PID 6156; the foreground handle did not change. Both ports listed the new PID and its script console recorded revision 3.3 construction, with no activation message.
- Bounded reads of the previous PID 45628 found the target driver instance vector empty, the loader's script path present, an uninitialized rejection-set guard and a configured `blockeddrivers.json` path whose file was absent at the snapshot. Static analysis linked detection to a prepared activation command and bounded save-stream behavior. A later PID 3720 snapshot recorded root `+0x130 = 0` and `+0x138 = 0x01` twice; these transient fields do not prove whether detection ran. These findings are not a proven activation procedure or project lifecycle ABI.

## Verification

- `node node_modules/typescript/bin/tsc -p tsconfig.json` passed; `node --test tests/*.test.cjs` passed **70/70**, zero skipped. The native virtual-port client snapshot and probe-wrapper policy tests also passed. Installed/source/server revision 3.3 includes fixture-tested mixer bank channels and insert viewers.
- Earlier real-host request evidence: `artifacts/native-probe/result-66528.json` and `feature-admission-66528.json`. Current script and endpoint evidence: `artifacts/ipc/midi-script-after-request-3.3-3720.json`, `artifacts/ipc/midi-clients-coverage-3.3-3720.json`, and `artifacts/live-smoke/verification-coverage-3.3-3720.json`. The new verification timed out at status, before any volume write.
- The full suite and fixture results do not prove current mapping activation, a successful project operation, disk persistence or complete Cubase feature coverage.

## Remaining

Recover a repeatable background device/mapping activation path and verify the active controller against the actual host. Establish a safe project lifecycle and event-editing contract, implement and verify creation, saving and rendering, and finish remaining Cubase/MIDI Remote feature families. No Cubase instructions, interface tables or product-admission state were patched in this session.
