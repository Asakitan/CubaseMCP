# Scoring Startup Failure Investigation

Date: 2026-11-10. This investigation reads a Cubase crash minidump and installed `ScoringEngine.dll`; it did not operate Cubase, modify the project, modify ACLs, or remove IPC objects. RVAs apply only to the installed build.

## Exception and error

The dump `C:\Users\99325\Documents\Steinberg\CrashDumps\Cubase 16.0.5 64bit2026.11.10 2.59.54.102.dmp` reports exception `0xe06d7363`, with image base `0x7fff0000` for `ScoringEngine.dll`. The C++ exception record points to thrown object `0x14bb60` and ThrowInfo `0x857b1168`. Its catchable-type array resolves to type-descriptor RVA `0x5831830`; the installed image supplies the name `boost::interprocess::interprocess_exception` at RVA `0x5831840`, with `std::exception` also listed. Some descriptor memory is absent from the mini dump, so the type name is read from the installed module image, not asserted to have been captured in the dump.

At thrown-object offset `0x18`, the dump contains two little-endian DWORDs `5` and `3`. In the installed image, constructor `0x1240b10` copies the error-info pair to that offset; helper `0x1240ac0` stores its input as the first DWORD and maps it through the table beginning at `0x44f3c90`, whose first entry is `5 → 3`. The failed operation path calls `GetLastError` and passes that result through this helper. Thus native error 5 is observed; Microsoft identifies it as [ERROR_ACCESS_DENIED](https://learn.microsoft.com/windows/win32/debug/system-error-codes--0-499-). The numeric mapped value 3 is observed, but its Boost enum name and exact library version have not been independently established. The [Boost exception declaration](https://raw.githubusercontent.com/boostorg/interprocess/develop/include/boost/interprocess/exceptions.hpp) documents the error-info and message members, but that current upstream source alone does not establish the target binary's exact version.

The exception message bytes in the available dump do not yield a reliable readable message. Do not substitute a guessed string.

## Operation and candidate file

The stack contains multiple `ScoringEngine.dll` frames followed by Cubase frames while opening the copied project. Return address `0x81234f10` maps to module RVA `0x1244f10`. Its caller sequence at `0x1244ef9` loads a pointer to the literal `CachedFileDataProviderManager` (RVA `0x44f3df8`) and passes it through `0x1240d80`, `0x123ece0`, `0x123e2f0`, and `0x123fc60`. The latter constructs a base path plus that name and calls helper `0x123e3a0`, which invokes `CreateFileA`; its failed-handle path constructs and throws the exception above. Path construction function `0x123e430` appends `/boost_interprocess`. These observations establish an attempted cache-file open and the access-denied error; they do not establish that the score project itself is corrupt.

An independently observed file at `C:\ProgramData\boost_interprocess\48020000\CachedFileDataProviderManager` has the same basename, length 12, creation time 2026-11-10 01:02:10 local, owner `BUILTIN\Administrators`, and an ACL granting full control to SYSTEM and Administrators, but only read/execute to logon SID `S-1-5-5-0-405685`. This is a strong candidate for the denied open. The complete failed path and process token were not recovered from the mini dump, so matching this file to the failed handle remains an inference, not a confirmed identity. The dump does not contain the cache basename or `/boost_interprocess` string in captured memory; the path fragments above come from the installed image.

In a separate Dorico case, a Steinberg forum representative identified this same cache basename and described administrator-created temporary files as a possible cause of later standard-user access failures. That account is corroborating context, not proof of this Cubase instance's exact failed path or root cause. [Steinberg forum discussion](https://forums.steinberg.net/t/dorico-not-opening-blue-circle-loading/1023758).

## Evidence and next discriminating step

Existing stack: `artifacts/startup/session08-crash-stack.txt`. Offline debugger excerpts and static disassemblies were archived under `artifacts/research/session-08`. One attempted trap-frame interpretation produced an invalid context and is not used as evidence.

After the approved isolated process exited, the single candidate file and its original SDDL were moved to `artifacts/startup/score-cache-before-fix`; the two transient startup markers were also archived. A fresh process opened the recovered score project, and the cache reappeared with current-user ownership and write access. The observed archive/recreate recovery supports the candidate diagnosis. The earlier dump still does not independently establish the exact denied full path or access mask; this test does not justify modifying unrelated caches or ACLs.
