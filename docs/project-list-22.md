# Project-list bounded snapshot 22

At `2026-11-09T19:35:45.8446720Z`, a single read-only post-prompt snapshot of PID `24036` was recorded in `artifacts/ipc/project-list-22-24036-e4a3bf4bec784c6993568b65f05fafa7.json`. The script `scripts/Read-ProjectList22.ps1` checked the exact process creation time `2026-11-09T19:11:22.3263004Z`, installed executable path and file version `16.0.5.174`, disk PE x64 timestamp `0x6adf121b`, image base `0x140000000`, and observed 16 PID-owned windows on the `CubaseAI_MCP` private desktop. It rechecked the process creation time after traversal. It used process read/query rights only; no target call, memory write, host request or UI action was made.

The global MProject pointer at RVA `0x59110d0` was `0x3fdc4a0`; its `+0x78` list interface had vtable RVA `0x4192350` and stored count 2. Global `MProject+0xf8` held root pointer `0x79235b60`. The list head at interface `+0x18` was `0xa3923470`. Using node `+0` as next and `+8` as value, two nodes were visited and traversal ended at null; count and traversal length matched. Each read pointer, node pair and value vtable was read again and matched. The walk limits count and nodes to 128, rejects cycles, and treats inaccessible non-null values as an error.

| Node | Value | Primary vtable RVA | Equals global root |
|---|---|---|---|
| `0xa3923470` | `0xabe3c210` | `0x4471c40` | no |
| `0x5be4e4f0` | `0x79235b60` | `0x4471c40` | yes |

The fixed-profile RTTI check in `scripts/project-candidate-provenance-inspect.py` identifies vtable RVA `0x4192350` as `Steinberg::CmLinkedList` and primary vtable `0x4471c40` as `Steinberg::MRoot`; therefore both values are MRoot candidates under exact vtable matching. The first is an additional distinct root candidate at the observed moment. No project filename, active selection, request completion or saved state is established. Repeated reads detect some changes but are sequential and unlocked: they do not provide an atomic view, guarantee object lifetime, or reveal the state at the earlier prompt gate.
