# Project-open application dispatch: static follow-up

## Scope

This is read-only analysis of installed Cubase AI 16.0.5 x64, PE timestamp `0x6adf121b` and preferred image base `0x140000000`. No host method, queue, project operation, UI action or process write was performed. RVAs are build-specific, not a public ABI. The session 14 path lookup was a separate, one-shot temporary-object diagnostic and did not set a path or call project open.

## Application receiver and the conditional consumer chain

The global pointer at `0x5972e30` used as the `IHostApplication2` direct receiver and as the posted record receiver is the application pointer; prior static work found it assigned by the `UApplication` constructor and cleared by its destructor (`project-lifecycle-contract.md`). The static primary vtables of `PCubaseApplication` (`0x45d07a0`) and `PSequencerApplication` (`0x42eba20`) both have slot `+0xb0 = 0x1d50ad0` and slot `+0x178 = 0x1d53bb0`. A previous PID 17596 snapshot observed the former vtable; that historical observation does not establish the dynamic type of current PID 39068.

The separately traced `FPostedMessage` consumer `0x3a8c220` conditionally calls the record receiver's slot `+0xb0`; there is also a distinct earlier query-driven branch. If the former branch actually selects an application having one of the above vtables, the receiver dispatches to `0x1d50ad0`. At `0x1d50ea7`, this method checks the action name `OpenFile`; its matching branch extracts `Path` and `ProjectDir`, conditionally checks their types, then invokes the receiver's slot `+0x178` at `0x1d50f35`. Immediately afterward it returns `1`, without forwarding the slot's result. Thus, even an observed handler return of `1` would not by itself establish project-open completion. This is a conditional static chain, not an observation that a particular message was delivered or that the query branch selected this handler.

Both the direct host-open application call and this conditional posted-message path reach the same `+0x178` slot for the two static application vtables. At `0x1d53bd8`, `0x1d53bb0` tests two bytes at a separate global object's `+0x70` and `+0x71`; when either is nonzero it submits another `OpenFile` action, then continues at `0x1d53c7f` into further path-dependent logic. The meaning of these bytes and the consequences of this continuation are unproven. A submission must not be equated with successful completion or with a guaranteed one-shot lifecycle.

## Unresolved contract

The consumer's actual branch, thread, object lifetime and schedule remain unknown. The specific conditions and delivery of any prompts, correlation of errors or completion with the intended project, and a supported noninteractive entry remain unestablished. Static application vtables and message names do not justify invoking the internal host method or a project mutation.

## Reproduction

`E:\Py\python.exe scripts/project-dispatch-15-inspect.py` checks machine, timestamp, preferred base, exact action strings, both application RTTI names and the two vtable slots. It decodes each entire containing runtime function from its PE-declared beginning and prints selected instruction spans. The focused check completed successfully after correcting the full namespace in the script's initial RTTI expectation. No process snapshot was taken in this session.
