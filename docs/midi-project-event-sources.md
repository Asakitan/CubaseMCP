# MIDI project event sources: bounded static follow-up

Build: Cubase AI 16.0.5 Windows x64, PE timestamp `0x6adf121b`. This is on-disk static analysis only; RVAs are build-specific and are not a supported API. No project or process state was changed.

## Selector callers and command-shaped branch

A raw x64 `E8 rel32` search of the executable `.text` for calls to selector `0x279e640` yielded seven candidates, each separately confirmed as a decoded call in its enclosing runtime function: `0x1a323ae`, `0x1a798b2`, `0x1d144fe`, `0x1d1e207`, `0x1d39d06`, `0x1d43957`, and `0x1d50979`. This search does not cover indirect calls, other modules, or other instruction forms, so it is not an exhaustive producer inventory. The already-investigated existing-project open path contains `0x1d43957`.

The coordinator also independently decoded each candidate from its `.pdata` function begin rather than only from the local slice; each decoded as a direct call to the same selector. This verifies these instruction boundaries, not the meaning or runtime use of their enclosing functions.

The function at `0x1d1e0c0` compares an input with the ASCII string `ActivateProject` at `0x42e0650`; the matching branch reads `[r15+0x1a8]`, obtains the pointer at that object's `+0x108`, checks it for null, and calls the selector at `0x1d1e207`. This establishes an additional command-shaped upstream branch, not an externally callable command, public MIDI Remote API, background executor, or proof it ran. Its input type, receiver lifetime, thread, project identity, and launch conditions remain unknown. Other decoded call sites pass register or object-derived pointers, but their event meanings and input provenance are not established by their call alone.

## Selection, removal and no-op boundary

The selector rejects a null new pointer and checks byte `MProject+0x71`; it returns success before listener dispatch when the incoming root equals `MProject+0xf8` (`0x279e676–0x279e67d`). When proceeding with a different root, the branch iterating the project listener container passes old root `+0x98` to listener slot `+0x20` at `0x279e79d`; later it passes new root `+0x98` to slot `+0x18` at `0x279e99b`. For the informer, those slots respectively reach removal `0x25b1a30` and insertion `0x25b17f0`, subject to the informer actually being a listener and the respective branches executing. This is a paired removal/addition in this selector, not evidence that all project removal producers have been identified. Registration itself does not replay an existing root; see `midi-project-notifications.md` and `midi-project-tree-meaning.md`.

The observed startup samples support a late-registration investigation but do not establish missed delivery, an unobserved root transition, or a causal repair. `ActivateProject` still reaches the same selector and therefore is not evidence of re-notification for an unchanged root. No normal same-root producer or verified background reset is established by this bounded inspection. The separately documented MIDI Remote prepared activation command has unresolved scheduling and public entry conditions; script construction is not activation, and neither path proves a usable reset.

## Reproduction and next evidence

`python scripts/midi-project-event-sources-inspect.py` decodes the bounded instruction ranges and validates the PE machine, timestamp and image base. The direct-call inventory was derived from a raw byte scan then checked against decoded enclosing runtime functions; a byte scan alone is not a valid instruction-boundary proof. Further work is to trace the `ActivateProject` input and caller provenance, project lifetime and threading, plus independently identify any other listener-slot `+0x18` sender with receiver provenance. A documented supported API or normal host action with verified completion would be needed before claiming a background route.
