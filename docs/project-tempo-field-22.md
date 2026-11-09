# Project tempo-field static trace 22

## Scope and identification

This is static evidence only, not a live reading, a BPM measurement, or proof of project persistence. The files inspected were `C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe` (Cubase 16.0.5.174 x64, PE timestamp `0x6adf121b`) and `C:\Program Files\Steinberg\Cubase 16\Components\Filters\dawproject.dll` (PE timestamp `0x69e0f9bd`; separately observed installed version 1.1.0.3). All addresses below are RVAs for these builds, not a supported API. The root-to-document candidates and their non-atomic limitations are documented in `project-root-documents-22.md`; this trace does not select an active root.

## Host object field

Static RTTI identifies `MTempoTrackEvent` primary vtable RVA `0x4475ca8` and secondary vtable RVA `0x4476318` at complete-object offset `+0x1a8`. The secondary slot `+0x40` targets RVA `0x1884490`: bytes `f3 0f 10 41 10 c3` decode to `movss xmm0,[rcx+0x10]; ret`. Thus this getter returns the 32-bit floating-point contents at complete object `+0x1b8`, not a pointer. The secondary slot `+0x38` targets `0x2771ea0`: it compares the incoming single-precision `xmm1` with `[rcx+0x10]`, stores it when different (`f3 0f 11 49 10`), then follows host notification-related calls. These are Windows x64 register observations, not a callable ABI or authorization to invoke a method.

Secondary slot `+0x18` targets `0x276e260`: bytes `80 79 14 00 74 06 f3 0f 10 41 10 c3` check byte secondary `+0x14` (complete-object `+0x1bc`), and return the same float when nonzero; otherwise control adjusts `this` to the complete object and branches to `0x276e2e0`. That routine obtains floating-point values through node virtual calls and uses double values at node `+0x58` in a linear interpolation calculation on one branch. The flag meaning, node types and coordinate units remain unidentified; this is not proof that the raw field is the tempo at an arbitrary timeline position.

## Filter-to-host data flow

In `dawproject.dll`, at `0x1f9d3–0x1f9da` a root interface's virtual slot `+0x68` is invoked. The source object at `0x1f9e0–0x1f9e7` supplies a child through its virtual slot `+0x38`. If both objects are non-null, `0x1f9fc–0x1fa05` calls that child's virtual slot `+0x20` and copies the returned `xmm0` into `xmm2`; `0x1fa11` calls filter function `0x39200`. The observed function preserves `xmm2` as a double and at `0x39233–0x39255` gets the root's `+0x68` interface, converts that double to a single-precision value (`cvtsd2ss`), and passes it in `xmm1` to that interface's virtual slot `+0x38`. There is no arithmetic scaling in this traced segment; conversion can round the value.

The separately traced host root secondary slot `+0x68` at `0x2758c60` reads root `+0xf8` and returns its `+0x1a8` subobject when present. For an actual object whose type and vtables match the above `MTempoTrackEvent`, the filter's observed call therefore reaches the float setter at `0x2771ea0`. The source child getter's nominal type, XML provenance, parameter meaning, and units have not been established. The class name and this data flow alone do not establish BPM, an actual runtime value, or the persistence of a project.

## Verification boundary

A discriminating next investigation is to identify the filter source child's concrete class and its getter-to-XML mapping, then compare known differing fixture values with independently observed host values after verifying object type, flag and root identity. No independently established known-tempo fixture or such cross-check is asserted here. The static trace does not invoke the host, change its memory, operate a prompt, or prove a completed import.
