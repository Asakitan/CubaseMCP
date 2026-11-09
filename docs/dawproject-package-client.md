# DAWproject Package Client and Host Context

Static, read-only analysis of the installed Cubase AI 16.0.5 executable and `Components/Filters/dawproject.dll`, timestamp `0x69e0f9bd`. RVAs apply only to these binaries. No package, import, project or target-process method was called and no filesystem content was extracted.

## Package return and ownership

At the successful tail of `DPPackageManager` method `0x41b10`, code at `0x424d7` allocates `0x20` bytes and calls `0x41550` with a previously produced object interface at `RDX`. The latter constructs a `Steinberg::DPPackage`, retains that input through slot `+0x08`, and stores it at complete-object `+0x18`. Its primary vtable is `0x1050d8`; the returned pointer is the secondary interface at complete-object `+0x10`, vtable `0x105150`. Its slot `+0x18` is leaf `0xf0a0`: `mov rax,[rcx+8]; ret`. Thus the returned package provides a borrowed pointer to the retained object; the getter itself does not add a reference. The `DPPackage` destructor `0x415b0` releases the stored input through slot `+0x10`. The exact nominal type and schema of that held input are not yet proven. Callers must not use the borrowed pointer after the package's ownership ends.

## Package-client filesystem effects

The client destination mappings and host-service path are recorded in `dawproject-host-filter.md`. In the package loop, `0x41f17` calls client slot `+0x18` with an integer derived from the package item; its returned path is used to construct a path object. At `0x41f91`–`0x41fa2` the code calls slot `+0x108` on the filter's filesystem singleton. Static initializer `0x6340` installs vtable `0x10e6d8`, RTTI `Steinberg::FNFileSystem`, and points global RVA `0x15b250` at that singleton. Slot `+0x108` is `0x944a0`; its branch at `0x945fc` calls the imported Windows `CreateDirectoryW`. This is evidence that package preparation can create directories before `DPHostProject` import, not proof that every item does or that extraction completed. The exact subsequent media-file write/overwrite semantics remain unresolved. A package-only invocation is not established as read-only.

## Concrete Cubase-side IID match

The host IID raw bytes `13 28 7c 3d bf 8a ae 4a a2 3a 11 bf 37 21 4c 36` appear in Cubase executable at RVA `0x54e05f0`. `Steinberg::MProject` primary vtable `0x447d378` uses query method `0x279e290`, which compares those 16 bytes, retains the object and returns its complete-object `+0x10` secondary interface. The latter vtable is `0x447d448`; slot `+0x28` is leaf `0x279dc30`, which reads secondary `this+0xe8` (complete object `+0xf8`) and returns the pointed object's `+0x98` subobject if non-null. This matches the shape consumed by `DPHostProject` when it retrieves and retains its field `+0x70`.

This is a concrete implementation match, not proof that the running filter's host service locator returns this `MProject`, that the project has the necessary active state, or that these methods can be called from a worker thread. The import path's ownership, threading, execution lifetime and edition-specific result remain unverified. Do not manufacture a host or call these project-mutating methods on the strength of this match.

Run `E:\Py\python.exe scripts/dawproject-package-client-inspect.py` to print fixed bounded filter disassembly. The package-construction range starts at instruction-aligned RVA `0x424cf`; the package getter is a fixed leaf without its own `.pdata` range. The script checks the PE profile and reads the installed DLL only.
