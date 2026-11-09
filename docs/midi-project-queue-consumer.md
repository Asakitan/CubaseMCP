# Project activation posted-message consumer

This is read-only static analysis of Cubase AI 16.0.5 x64, PE timestamp `0x6adf121b`. Runtime execution, object lifetime, operating-system thread and public interface are not established by these RVAs. No process, project, UI or settings were changed.

## Record and queue

The producer `0x3a8c770` creates a 0x28-byte object with vtable `0x4825768`; its MSVC RTTI identifies `Steinberg::FPostedMessage`. It stores the message pointer at record `+0x10`, the incoming receiver pointer at `+0x18`, and a stack-supplied integer at `+0x20`. It then calls `0x3ab9330`, a direct jump to `0x3a88620`, on the queue at producer `+0x20`. The latter allocates a two-pointer link, appends it to list head/tail `+0x18/+0x20`, and increments count `+0x10`. An earlier producer path can suppress the allocation based on queue contents, so a producer call alone does not prove enqueue or dispatch.

`0x3a8c220` checks owner `+0x48` and queue count, processes queued records into separate lists based on each `+0x20`, and consumes entries in the list at owner `+0x30`. It obtains each record's receiver from `+0x18` and message from `+0x10`. The first interface-query branch invokes the obtained interface at slot `+0x18` with a message subobject. If that branch is not taken, another query and `CmObject` type check gate the call at `0x3a8c3f9`: receiver slot `+0xb0` with the message pointer. These are conditional paths; neither confirms delivery, receiver validity, or which query succeeds in an actual invocation.

For the documented `PRemoteWheel` producers, the originally supplied receiver is the `PRemoteWheel` object, so on the conditional `CmObject` branch dispatch is to that receiver's slot `+0xb0`; the separate arranger controller's matching literal is not evidence of delivery to an arranger. The first interface branch, query result identity, runtime dynamic type and any later forwarding remain unproven. See `project-activation-provenance.md` for producer provenance and the arranger selector branch.

## Scheduling and bounds

A direct relative-call scan found 11 candidate call sites for `0x3a8c220`, all decoded from their PE runtime-function beginnings. One is at `0x279ea3e` inside the different-root selector after its notification loop, subject to a global-pointer condition. This shows a conditional consumer invocation inside that selector, not that a consumer invocation causes a project switch, that a matching message exists, or that the consumer is restricted to a particular thread. Other call sites exist in unrelated functions; the scan excludes indirect calls and other modules. Thread affinity, queue owner lifetime, receiver lifetime and completed delivery still require independent evidence.

The public MIDI Remote and project-window descriptions in `project-activation-provenance.md` establish neither a documented prompt-free background API for selecting an already-open different project nor a usable project switch before MIDI mapping activation. The posted-message machinery is not a documented host-owned external API. This finding does not establish a working repair or justify calling internal methods.

Reproduce the fixed-build checks and disassembly with `python scripts/midi-project-queue-consumer-inspect.py`; it validates the PE profile, verifies instruction-function starts, checks the leaf jump target, and reads the record RTTI. The focused script was run successfully. Future work must identify an independently supported external switch contract, and observe different root identities, listener membership, notification insertion and mapping activation without assuming queue delivery.
