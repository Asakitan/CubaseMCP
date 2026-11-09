#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <processsnapshot.h>
#include <dbghelp.h>
#include <psapi.h>
#include <cstdio>
#include <cwchar>
#include <cstdint>
#include <cstring>

// This executable accepts no target PID. Its only target is its own child.
namespace {
constexpr DWORD kTimeoutMs = 15000;
constexpr unsigned kMaxFrames = 64;
constexpr SIZE_T kReadBudget = 2 * 1024 * 1024;
HANDLE gClone = nullptr;
SIZE_T gReadTotal = 0;
bool gReadFailed = false;

BOOL CALLBACK bounded_read(HANDLE process, DWORD64 address, PVOID buffer, DWORD size, LPDWORD read) {
    if (read) *read = 0;
    if (process != gClone || !size || size > 65536 || address > UINT64_MAX - size ||
        gReadTotal > kReadBudget - size) { gReadFailed = true; return FALSE; }
    MEMORY_BASIC_INFORMATION mbi{};
    if (!VirtualQueryEx(gClone, reinterpret_cast<LPCVOID>(address), &mbi, sizeof(mbi)) ||
        mbi.State != MEM_COMMIT || (mbi.Protect & (PAGE_GUARD | PAGE_NOACCESS)) ||
        address < reinterpret_cast<DWORD64>(mbi.BaseAddress) ||
        address - reinterpret_cast<DWORD64>(mbi.BaseAddress) > mbi.RegionSize ||
        size > mbi.RegionSize - (address - reinterpret_cast<DWORD64>(mbi.BaseAddress))) {
        gReadFailed = true; return FALSE;
    }
    SIZE_T got = 0;
    gReadTotal += size;
    if (!ReadProcessMemory(gClone, reinterpret_cast<LPCVOID>(address), buffer, size, &got) || got != size) {
        gReadFailed = true; return FALSE;
    }
    if (read) *read = static_cast<DWORD>(got);
    return TRUE;
}
BOOL CALLBACK symbol_callback(HANDLE process, ULONG action, ULONG64 data, ULONG64) {
    if (action != CBA_READ_MEMORY) return FALSE;
    auto* request = reinterpret_cast<IMAGEHLP_CBA_READ_MEMORY*>(data);
    return request && bounded_read(process, request->addr, request->buf, request->bytes, request->bytesread);
}
#pragma optimize("", off)
__declspec(noinline) DWORD synthetic_leaf(HANDLE ready, HANDLE stop) {
    if (!SetEvent(ready)) return 10;
    return WaitForSingleObject(stop, kTimeoutMs) == WAIT_OBJECT_0 ? 0 : 11;
}
__declspec(noinline) DWORD synthetic_middle(HANDLE ready, HANDLE stop) {
    volatile DWORD result = synthetic_leaf(ready, stop); return result;
}
__declspec(noinline) DWORD synthetic_outer(HANDLE ready, HANDLE stop) {
    volatile DWORD result = synthetic_middle(ready, stop); return result;
}
#pragma optimize("", on)

bool local_directory(const wchar_t* path) {
    HANDLE directory = CreateFileW(path, 0, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        nullptr, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, nullptr);
    if (directory == INVALID_HANDLE_VALUE) return false;
    wchar_t resolved[MAX_PATH]{};
    DWORD n = GetFinalPathNameByHandleW(directory, resolved, MAX_PATH, FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
    bool closed = CloseHandle(directory) != FALSE;
    // Accept only a resolved fixed local drive, never UNC, a mapped drive or a device namespace.
    if (!closed || !n || n >= MAX_PATH || std::wcsncmp(resolved, L"\\\\?\\", 4) != 0 ||
        resolved[5] != L':' || resolved[6] != L'\\') return false;
    wchar_t root[] = {resolved[4], L':', L'\\', L'\0'};
    return GetDriveTypeW(root) == DRIVE_FIXED;
}
bool load_modules(HANDLE process, const wchar_t* exe) {
    HMODULE modules[512]{}; DWORD bytes = 0;
    // Refuse to substitute the live child mapping when clone enumeration fails.
    if (!EnumProcessModulesEx(gClone, modules, sizeof(modules), &bytes, LIST_MODULES_64BIT) || bytes > sizeof(modules) || !bytes) return false;
    wchar_t system[MAX_PATH]{};
    if (!GetSystemDirectoryW(system, MAX_PATH)) return false;
    const size_t systemLen = std::wcslen(system);
    for (DWORD i = 0; i < bytes / sizeof(HMODULE); ++i) {
        wchar_t path[MAX_PATH]{}; MODULEINFO info{};
        wchar_t childPath[MAX_PATH]{}; MODULEINFO childInfo{};
        if (!GetModuleFileNameExW(gClone, modules[i], path, MAX_PATH) ||
            !GetModuleInformation(gClone, modules[i], &info, sizeof(info)) ||
            !GetModuleFileNameExW(process, modules[i], childPath, MAX_PATH) ||
            !GetModuleInformation(process, modules[i], &childInfo, sizeof(childInfo)) ||
            _wcsicmp(path, childPath) != 0 || info.lpBaseOfDll != childInfo.lpBaseOfDll ||
            info.SizeOfImage != childInfo.SizeOfImage) return false;
        // Only the synthetic binary and direct System32 modules are accepted.
        bool isExe = _wcsicmp(path, exe) == 0;
        bool isSystem = _wcsnicmp(path, system, systemLen) == 0 && path[systemLen] == L'\\' &&
            std::wcschr(path + systemLen + 1, L'\\') == nullptr;
        if (!isExe && !isSystem) return false;
        DWORD attributes = GetFileAttributesW(path);
        if (attributes == INVALID_FILE_ATTRIBUTES || (attributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY))) return false;
        if (!SymLoadModuleExW(gClone, nullptr, path, nullptr,
                reinterpret_cast<DWORD64>(info.lpBaseOfDll), info.SizeOfImage, nullptr, 0)) return false;
    }
    return true;
}
int parent(bool useJob) {
    int rc = 1; HANDLE ready = nullptr, stop = nullptr, cloneMonitor = nullptr, job = nullptr;
    PROCESS_INFORMATION child{}; HPSS snap = nullptr; HPSSWALK marker = nullptr;
    bool symbols = false, childStarted = false, childSuspended = false;
    wchar_t exe[MAX_PATH]{};
    do {
        std::printf("mode=%s\n", useJob ? "synthetic-job-parent" : "synthetic-parent");
        if (!GetModuleFileNameW(nullptr, exe, MAX_PATH)) { std::puts("error=GetModuleFileName"); break; }
        if (useJob) {
            job = CreateJobObjectW(nullptr, nullptr);
            if (!job) { std::printf("job create=0 code=%lu\n", GetLastError()); break; }
            std::puts("job create=1");
            JOBOBJECT_BASIC_UI_RESTRICTIONS ui{}; ui.UIRestrictionsClass = 0x40;
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{}; limits.BasicLimitInformation.LimitFlags = 0x2000;
            BOOL uiSet = SetInformationJobObject(job, JobObjectBasicUIRestrictions, &ui, sizeof(ui));
            DWORD uiError = uiSet ? ERROR_SUCCESS : GetLastError();
            std::printf("job ui_set=%d code=%lu\n", uiSet != FALSE, uiError);
            if (!uiSet) break;
            BOOL limitSet = SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits));
            DWORD limitError = limitSet ? ERROR_SUCCESS : GetLastError();
            std::printf("job limit_set=%d code=%lu\n", limitSet != FALSE, limitError);
            if (!limitSet) break;
            JOBOBJECT_BASIC_UI_RESTRICTIONS actualUi{}; JOBOBJECT_EXTENDED_LIMIT_INFORMATION actualLimits{};
            if (!QueryInformationJobObject(job, JobObjectBasicUIRestrictions, &actualUi, sizeof(actualUi), nullptr) ||
                !QueryInformationJobObject(job, JobObjectExtendedLimitInformation, &actualLimits, sizeof(actualLimits), nullptr)) {
                std::printf("error=job_query code=%lu\n", GetLastError()); break;
            }
            std::printf("job ui_flags=%lu limit_flags=%lu\n", actualUi.UIRestrictionsClass, actualLimits.BasicLimitInformation.LimitFlags);
            if (actualUi.UIRestrictionsClass != 0x40 || actualLimits.BasicLimitInformation.LimitFlags != 0x2000) {
                std::puts("error=job_policy_mismatch"); break;
            }
        }
        SECURITY_ATTRIBUTES sa{sizeof(sa), nullptr, TRUE};
        ready = CreateEventW(&sa, TRUE, FALSE, nullptr); stop = CreateEventW(&sa, TRUE, FALSE, nullptr);
        if (!ready || !stop) { std::puts("error=CreateEvent"); break; }
        wchar_t command[2 * MAX_PATH]{};
        if (swprintf_s(command, L"\"%s\" synthetic-child %llu %llu", exe,
            static_cast<unsigned long long>(reinterpret_cast<uintptr_t>(ready)),
            static_cast<unsigned long long>(reinterpret_cast<uintptr_t>(stop))) < 0) break;
        SIZE_T attributeBytes = 0;
        InitializeProcThreadAttributeList(nullptr, 1, 0, &attributeBytes);
        if (!attributeBytes || attributeBytes > 1024 * 1024) { std::puts("error=attribute_size"); break; }
        auto* attributes = static_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(HeapAlloc(GetProcessHeap(), 0, attributeBytes));
        if (!attributes) { std::puts("error=attribute_allocation"); break; }
        bool initialized = InitializeProcThreadAttributeList(attributes, 1, 0, &attributeBytes) != FALSE;
        HANDLE inherited[] = {ready, stop};
        bool listed = initialized && UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
            inherited, sizeof(inherited), nullptr, nullptr) != FALSE;
        STARTUPINFOEXW si{}; si.StartupInfo.cb = sizeof(si); si.lpAttributeList = attributes;
        bool created = listed && CreateProcessW(exe, command, nullptr, nullptr, TRUE,
            CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT | (useJob ? CREATE_SUSPENDED : 0), nullptr, nullptr, &si.StartupInfo, &child) != FALSE;
        DWORD createError = created ? ERROR_SUCCESS : GetLastError();
        if (initialized) DeleteProcThreadAttributeList(attributes);
        bool freed = HeapFree(GetProcessHeap(), 0, attributes) != FALSE;
        if (!created) { std::printf("error=CreateProcess_or_attribute code=%lu\n", createError); break; }
        childStarted = true; childSuspended = useJob;
        if (!freed) { std::puts("error=attribute_free"); break; }
        if (useJob) {
            BOOL assigned = AssignProcessToJobObject(job, child.hProcess);
            DWORD error = assigned ? ERROR_SUCCESS : GetLastError();
            std::printf("job assign=%d code=%lu\n", assigned != FALSE, error);
            if (!assigned) break;
            BOOL member = FALSE;
            BOOL checked = IsProcessInJob(child.hProcess, job, &member);
            std::printf("job membership_query=%d member=%d\n", checked != FALSE, member != FALSE);
            if (!checked || !member) break;
            DWORD previous = ResumeThread(child.hThread);
            std::printf("job child_resume=%lu\n", previous);
            if (previous == static_cast<DWORD>(-1)) break;
            childSuspended = previous > 1;
            if (previous != 1) { std::puts("error=unexpected_suspend_count"); break; }
        }
        if (WaitForSingleObject(ready, kTimeoutMs) != WAIT_OBJECT_0) { std::puts("error=child_ready_timeout"); break; }
        DWORD status = PssCaptureSnapshot(child.hProcess, static_cast<PSS_CAPTURE_FLAGS>(
            PSS_CAPTURE_VA_CLONE | PSS_CAPTURE_THREADS | PSS_CAPTURE_THREAD_CONTEXT),
            CONTEXT_CONTROL | CONTEXT_INTEGER, &snap);
        std::printf("capture status=%lu\n", status);
        if (status != ERROR_SUCCESS) { std::printf("error=PssCaptureSnapshot code=%lu\n", status); break; }
        PSS_VA_CLONE_INFORMATION clone{};
        status = PssQuerySnapshot(snap, PSS_QUERY_VA_CLONE_INFORMATION, &clone, sizeof(clone));
        if (status != ERROR_SUCCESS || !clone.VaCloneHandle) { std::printf("error=PssQuerySnapshot code=%lu\n", status); break; }
        gClone = clone.VaCloneHandle;
        if (useJob) {
            BOOL member = FALSE;
            BOOL checked = IsProcessInJob(gClone, job, &member);
            DWORD error = checked ? ERROR_SUCCESS : GetLastError();
            std::printf("job clone_membership_query=%d member=%d code=%lu\n", checked != FALSE, member != FALSE, error);
            if (!checked) break;
        }
        DWORD cloneId = GetProcessId(gClone);
        if (!cloneId || cloneId == child.dwProcessId) { std::puts("error=clone_identity"); break; }
        cloneMonitor = OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, cloneId);
        if (!cloneMonitor) { std::printf("error=clone_monitor code=%lu\n", GetLastError()); break; }
        FILETIME monitorCreated{}, monitorExited{}, monitorKernel{}, monitorUser{};
        if (GetProcessId(cloneMonitor) != cloneId ||
            !GetProcessTimes(cloneMonitor, &monitorCreated, &monitorExited, &monitorKernel, &monitorUser)) {
            std::puts("error=clone_monitor_identity"); break;
        }
        unsigned long long cloneFiletime = (static_cast<unsigned long long>(monitorCreated.dwHighDateTime) << 32) | monitorCreated.dwLowDateTime;
        std::printf("clone_identity pid=%lu creation_filetime=%llu\n", cloneId, cloneFiletime);
        status = PssWalkMarkerCreate(nullptr, &marker);
        if (status != ERROR_SUCCESS) { std::printf("error=PssWalkMarkerCreate code=%lu\n", status); break; }
        CONTEXT context{}; bool found = false;
        for (unsigned i = 0; i < 512; ++i) {
            PSS_THREAD_ENTRY entry{};
            status = PssWalkSnapshot(snap, PSS_WALK_THREADS, marker, &entry, sizeof(entry));
            if (status != ERROR_SUCCESS) break;
            if (entry.ProcessId != child.dwProcessId || entry.ThreadId != child.dwThreadId) continue;
            if (!entry.ContextRecord || entry.SizeOfContextRecord < sizeof(CONTEXT) ||
                (entry.ContextRecord->ContextFlags & (CONTEXT_CONTROL | CONTEXT_INTEGER)) != (CONTEXT_CONTROL | CONTEXT_INTEGER)) break;
            context = *entry.ContextRecord; found = true; break;
        }
        if (!found) { std::printf("error=child_context code=%lu\n", status); break; }
        wchar_t symbolPath[MAX_PATH]{};
        if (!GetModuleFileNameW(nullptr, symbolPath, MAX_PATH)) break;
        wchar_t* slash = std::wcsrchr(symbolPath, L'\\'); if (!slash) break; *slash = L'\0';
        wchar_t systemPath[MAX_PATH]{};
        if (!GetSystemDirectoryW(systemPath, MAX_PATH) || !local_directory(symbolPath) || !local_directory(systemPath)) {
            std::puts("error=nonlocal_symbol_or_image_path"); break;
        }
        wchar_t pdbPath[MAX_PATH]{};
        if (swprintf_s(pdbPath, L"%s\\ActivationClone22.pdb", symbolPath) < 0) break;
        DWORD pdbAttributes = GetFileAttributesW(pdbPath);
        if (pdbAttributes == INVALID_FILE_ATTRIBUTES || (pdbAttributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY))) {
            std::puts("error=pdb_identity"); break;
        }
        const DWORD options = SYMOPT_DEFERRED_LOADS | SYMOPT_UNDNAME | SYMOPT_EXACT_SYMBOLS |
            SYMOPT_NO_PROMPTS | SYMOPT_FAIL_CRITICAL_ERRORS | SYMOPT_SECURE | SYMOPT_IGNORE_NT_SYMPATH |
            SYMOPT_NO_IMAGE_SEARCH | SYMOPT_DISABLE_SYMSRV_AUTODETECT;
        SymSetOptions(options);
        if ((SymGetOptions() & options) != options) { std::puts("error=symbol_options"); break; }
        if (!SymInitializeW(gClone, symbolPath, FALSE)) { std::printf("error=SymInitialize code=%lu\n", GetLastError()); break; }
        symbols = true;
        if (!SymRegisterCallback64(gClone, symbol_callback, 0) || !load_modules(child.hProcess, exe)) {
            std::printf("error=symbol_setup code=%lu\n", GetLastError()); break;
        }
        STACKFRAME64 frame{}; frame.AddrPC.Offset = context.Rip; frame.AddrPC.Mode = AddrModeFlat;
        frame.AddrStack.Offset = context.Rsp; frame.AddrStack.Mode = AddrModeFlat;
        frame.AddrFrame.Offset = context.Rbp; frame.AddrFrame.Mode = AddrModeFlat;
        DWORD64 previousSp = context.Rsp, previousPc = context.Rip;
        unsigned sequence = 0, accepted = 0; bool progress = true, orderError = false, echo = false;
        for (unsigned i = 0; i < kMaxFrames; ++i) {
            if (!StackWalk64(IMAGE_FILE_MACHINE_AMD64, gClone, child.hThread, &frame, &context,
                bounded_read, SymFunctionTableAccess64, SymGetModuleBase64, nullptr)) break;
            if (i == 0 && frame.AddrPC.Offset && previousSp && frame.AddrPC.Offset == previousPc &&
                frame.AddrStack.Offset == previousSp) { echo = true; continue; }
            if (!frame.AddrPC.Offset || frame.AddrStack.Offset <= previousSp) {
                const char* spRelation = frame.AddrStack.Offset == previousSp ? "equal" :
                    (frame.AddrStack.Offset < previousSp ? "lower" : "higher");
                std::printf("walk_stop index=%u pc_zero=%d pc_same=%d sp_relation=%s\n",
                    i, frame.AddrPC.Offset == 0, frame.AddrPC.Offset == previousPc, spRelation);
                progress = false; break;
            }
            previousSp = frame.AddrStack.Offset; previousPc = frame.AddrPC.Offset; ++accepted;
            alignas(SYMBOL_INFO) char storage[sizeof(SYMBOL_INFO) + MAX_SYM_NAME]{};
            auto* symbol = reinterpret_cast<SYMBOL_INFO*>(storage); symbol->SizeOfStruct = sizeof(SYMBOL_INFO); symbol->MaxNameLen = MAX_SYM_NAME;
            DWORD64 displacement = 0;
            if (SymFromAddr(gClone, frame.AddrPC.Offset, &displacement, symbol)) {
                if (std::strstr(symbol->Name, "synthetic_leaf")) { if (sequence != 0) orderError = true; else sequence = 1; }
                if (std::strstr(symbol->Name, "synthetic_middle")) { if (sequence != 1) orderError = true; else sequence = 2; }
                if (std::strstr(symbol->Name, "synthetic_outer")) { if (sequence != 2) orderError = true; else sequence = 3; }
            }
            if (sequence == 3 || orderError) break;
        }
        std::printf("frames ordered=%u rsp_progress=%d read_failure=%d order_error=%d echo=%d accepted=%u\n",
            sequence, progress, gReadFailed, orderError, echo, accepted);
        if (sequence == 3 && progress && !gReadFailed && !orderError) rc = 0;
    } while (false);
    if (symbols && !SymCleanup(gClone)) { std::puts("error=SymCleanup"); rc = 1; }
    if (marker) { DWORD s = PssWalkMarkerFree(marker); std::printf("cleanup marker=%lu\n", s); if (s) rc = 1; }
    if (snap) { DWORD s = PssFreeSnapshot(GetCurrentProcess(), snap); std::printf("cleanup snapshot=%lu\n", s); if (s) rc = 1; }
    gClone = nullptr;
    if (cloneMonitor) {
        DWORD wait = WaitForSingleObject(cloneMonitor, 2000);
        std::printf("cleanup clone_wait=%lu\n", wait);
        if (wait == WAIT_FAILED) rc = 1;
    }
    if (childSuspended) {
        DWORD previous = ResumeThread(child.hThread);
        std::printf("cleanup suspended_child_resume=%lu\n", previous);
        if (previous != 1) {
            rc = 1;
            if (previous == static_cast<DWORD>(-1) || previous > 1) {
                BOOL stopped = TerminateProcess(child.hProcess, 99);
                std::printf("cleanup suspended_owned_child_terminate=%d\n", stopped != FALSE);
            }
        }
    }
    if (stop && !SetEvent(stop)) { std::puts("error=release_child"); rc = 1; }
    if (childStarted) {
        DWORD wait = WaitForSingleObject(child.hProcess, kTimeoutMs);
        DWORD exitCode = 0;
        if (wait != WAIT_OBJECT_0 || !GetExitCodeProcess(child.hProcess, &exitCode) || exitCode != 0) {
            std::printf("error=child_exit wait=%lu code=%lu\n", wait, exitCode); rc = 1;
        }
        if (!CloseHandle(child.hThread)) rc = 1;
        if (!CloseHandle(child.hProcess)) rc = 1;
    }
    if (cloneMonitor) {
        DWORD wait = WaitForSingleObject(cloneMonitor, 2000);
        std::printf("cleanup clone_wait_after_child=%lu\n", wait);
        if (wait == WAIT_FAILED) rc = 1;
        BOOL closed = CloseHandle(cloneMonitor);
        std::printf("cleanup clone_monitor_close=%d\n", closed != FALSE);
        if (!closed) rc = 1;
    }
    if (job) { BOOL closed = CloseHandle(job); std::printf("cleanup job_close=%d\n", closed != FALSE); if (!closed) rc = 1; }
    if (ready && !CloseHandle(ready)) rc = 1;
    if (stop && !CloseHandle(stop)) rc = 1;
    std::printf("cleanup result=%d\n", rc);
    return rc;
}
}
int wmain(int argc, wchar_t** argv) {
    if (argc == 2 && std::wcscmp(argv[1], L"synthetic-parent") == 0) return parent(false);
    if (argc == 2 && std::wcscmp(argv[1], L"synthetic-job-parent") == 0) return parent(true);
    if (argc == 4 && std::wcscmp(argv[1], L"synthetic-child") == 0) {
        wchar_t* end1 = nullptr; wchar_t* end2 = nullptr;
        unsigned long long a = std::wcstoull(argv[2], &end1, 10), b = std::wcstoull(argv[3], &end2, 10);
        if (!a || !b || !end1 || *end1 || !end2 || *end2) return 2;
        return static_cast<int>(synthetic_outer(reinterpret_cast<HANDLE>(static_cast<uintptr_t>(a)), reinterpret_cast<HANDLE>(static_cast<uintptr_t>(b))));
    }
    std::puts("usage: synthetic-parent | synthetic-job-parent"); return 2;
}
