#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <tlhelp32.h>
#include <psapi.h>
#include <processsnapshot.h>
#include <dbghelp.h>
#include <cstdint>
#include <cstring>
#include <cstdio>
#include <cwchar>

// Fixed target only. No UI, target writes, host commands, or retry.
namespace {
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
    if (!request) { gReadFailed = true; return FALSE; }
    return bounded_read(process, request->addr, request->buf, request->bytes, request->bytesread);
}

constexpr DWORD kPid = 24036, kTid = 59956;
constexpr ULONGLONG kProcessTime = 134387250823263004ULL;
constexpr ULONGLONG kThreadTime = 134387250823263010ULL;
constexpr DWORD kPeTimestamp = 0x6adf121b;
constexpr ULONGLONG kPeBase = 0x140000000ULL;
constexpr wchar_t kImage[] = L"C:\\Program Files\\Steinberg\\Cubase 16\\Cubase 16.exe";
ULONGLONG value(FILETIME t) {
    return (static_cast<ULONGLONG>(t.dwHighDateTime) << 32) | t.dwLowDateTime;
}

volatile LONG gCancelled = 0;
BOOL WINAPI on_control(DWORD type) {
    if (type == CTRL_C_EVENT || type == CTRL_BREAK_EVENT || type == CTRL_CLOSE_EVENT) {
        InterlockedExchange(&gCancelled, 1); return TRUE;
    }
    return FALSE;
}
struct Module { DWORD64 base; DWORD size; wchar_t path[MAX_PATH]; bool loaded; };
Module gModules[512]{}; unsigned gModuleCount = 0;
bool trusted_file(const wchar_t* path, const wchar_t* systemDir) {
    const wchar_t* install = L"C:\\Program Files\\Steinberg\\Cubase 16";
    const size_t sl = std::wcslen(systemDir), il = std::wcslen(install);
    bool allowed = (_wcsnicmp(path, systemDir, sl) == 0 && path[sl] == L'\\') ||
        (_wcsnicmp(path, install, il) == 0 && path[il] == L'\\');
    if (!allowed) return false;
    HANDLE f = CreateFileW(path, 0, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        nullptr, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
    if (f == INVALID_HANDLE_VALUE) return false;
    BY_HANDLE_FILE_INFORMATION info{}; wchar_t finalPath[MAX_PATH]{};
    DWORD n = GetFinalPathNameByHandleW(f, finalPath, MAX_PATH, FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
    bool ok = GetFileInformationByHandle(f, &info) && !(info.dwFileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY)) &&
        n > 4 && n < MAX_PATH && std::wcsncmp(finalPath, L"\\\\?\\", 4) == 0 &&
        finalPath[5] == L':' && finalPath[6] == L'\\' && _wcsicmp(finalPath + 4, path) == 0;
    wchar_t root[] = {finalPath[4], L':', L'\\', L'\0'};
    if (ok) ok = GetDriveTypeW(root) == DRIVE_FIXED;
    if (!CloseHandle(f)) ok = false;
    return ok;
}
bool verify_module_pe(DWORD64 base, DWORD size, const wchar_t* path) {
    IMAGE_DOS_HEADER cloneDos{}, diskDos{}; IMAGE_NT_HEADERS64 cloneNt{}, diskNt{}; DWORD got = 0;
    if (!bounded_read(gClone, base, &cloneDos, sizeof(cloneDos), &got) || cloneDos.e_magic != IMAGE_DOS_SIGNATURE ||
        cloneDos.e_lfanew < 0 || cloneDos.e_lfanew > 4096 ||
        !bounded_read(gClone, base + static_cast<DWORD>(cloneDos.e_lfanew), &cloneNt, sizeof(cloneNt), &got)) return false;
    HANDLE file = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        nullptr, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
    if (file == INVALID_HANDLE_VALUE) return false;
    bool ok = false; LARGE_INTEGER offset{};
    do {
        if (!ReadFile(file, &diskDos, sizeof(diskDos), &got, nullptr) || got != sizeof(diskDos) ||
            diskDos.e_magic != IMAGE_DOS_SIGNATURE || diskDos.e_lfanew < 0 || diskDos.e_lfanew > 4096) break;
        offset.QuadPart = diskDos.e_lfanew;
        if (!SetFilePointerEx(file, offset, nullptr, FILE_BEGIN) ||
            !ReadFile(file, &diskNt, sizeof(diskNt), &got, nullptr) || got != sizeof(diskNt)) break;
        ok = cloneNt.Signature == IMAGE_NT_SIGNATURE && diskNt.Signature == IMAGE_NT_SIGNATURE &&
            cloneNt.FileHeader.Machine == IMAGE_FILE_MACHINE_AMD64 && diskNt.FileHeader.Machine == IMAGE_FILE_MACHINE_AMD64 &&
            cloneNt.OptionalHeader.Magic == IMAGE_NT_OPTIONAL_HDR64_MAGIC && diskNt.OptionalHeader.Magic == IMAGE_NT_OPTIONAL_HDR64_MAGIC &&
            cloneNt.FileHeader.TimeDateStamp == diskNt.FileHeader.TimeDateStamp &&
            cloneNt.OptionalHeader.SizeOfImage == size && diskNt.OptionalHeader.SizeOfImage == size;
    } while (false);
    if (!CloseHandle(file)) ok = false;
    return ok;
}
bool modules_and_image() {
    HMODULE modules[512]{}; DWORD bytes = 0;
    if (!EnumProcessModulesEx(gClone, modules, sizeof(modules), &bytes, LIST_MODULES_64BIT) ||
        !bytes || bytes > sizeof(modules)) return false;
    wchar_t systemDir[MAX_PATH]{}; if (!GetSystemDirectoryW(systemDir, MAX_PATH)) return false;
    bool mainFound = false;
    for (DWORD i = 0; i < bytes / sizeof(HMODULE); ++i) {
        wchar_t path[MAX_PATH]{}; MODULEINFO info{};
        if (!GetModuleFileNameExW(gClone, modules[i], path, MAX_PATH) ||
            !GetModuleInformation(gClone, modules[i], &info, sizeof(info))) return false;
        if (!trusted_file(path, systemDir)) continue;
        if (!verify_module_pe(reinterpret_cast<DWORD64>(info.lpBaseOfDll), info.SizeOfImage, path)) return false;
        Module& m = gModules[gModuleCount++]; m.base = reinterpret_cast<DWORD64>(info.lpBaseOfDll);
        m.size = info.SizeOfImage; if (wcscpy_s(m.path, path)) return false;
        if (_wcsicmp(path, kImage) == 0) {
            if (m.base != kPeBase) return false;
            IMAGE_DOS_HEADER dos{}; IMAGE_NT_HEADERS64 nt{}; DWORD got = 0;
            if (!bounded_read(gClone, m.base, &dos, sizeof(dos), &got) || dos.e_magic != IMAGE_DOS_SIGNATURE ||
                dos.e_lfanew < 0 || dos.e_lfanew > 4096 ||
                !bounded_read(gClone, m.base + static_cast<DWORD>(dos.e_lfanew), &nt, sizeof(nt), &got) ||
                nt.Signature != IMAGE_NT_SIGNATURE || nt.FileHeader.Machine != IMAGE_FILE_MACHINE_AMD64 ||
                nt.FileHeader.TimeDateStamp != kPeTimestamp || nt.OptionalHeader.ImageBase != kPeBase ||
                nt.OptionalHeader.SizeOfImage != m.size) return false;
            mainFound = true;
        }
    }
    return mainFound;
}
Module* find_module(DWORD64 pc) {
    for (unsigned i = 0; i < gModuleCount; ++i)
        if (pc >= gModules[i].base && pc - gModules[i].base < gModules[i].size) return &gModules[i];
    return nullptr;
}
bool image_on_disk() {
    HANDLE f = CreateFileW(kImage, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
    if (f == INVALID_HANDLE_VALUE) return false;
    BY_HANDLE_FILE_INFORMATION fileInfo{};
    IMAGE_DOS_HEADER dos{}; IMAGE_NT_HEADERS64 nt{}; DWORD count = 0; bool ok = false;
    do {
        if (!GetFileInformationByHandle(f, &fileInfo) ||
            (fileInfo.dwFileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY))) break;
        if (!ReadFile(f, &dos, sizeof(dos), &count, nullptr) || count != sizeof(dos) ||
            dos.e_magic != IMAGE_DOS_SIGNATURE || dos.e_lfanew < 0 || dos.e_lfanew > 4096) break;
        LARGE_INTEGER offset{}; offset.QuadPart = dos.e_lfanew;
        if (!SetFilePointerEx(f, offset, nullptr, FILE_BEGIN) ||
            !ReadFile(f, &nt, sizeof(nt), &count, nullptr) || count != sizeof(nt)) break;
        ok = nt.Signature == IMAGE_NT_SIGNATURE && nt.FileHeader.Machine == IMAGE_FILE_MACHINE_AMD64 &&
            nt.FileHeader.TimeDateStamp == kPeTimestamp && nt.OptionalHeader.Magic == IMAGE_NT_OPTIONAL_HDR64_MAGIC &&
            nt.OptionalHeader.ImageBase == kPeBase;
    } while (false);
    if (!CloseHandle(f)) ok = false;
    return ok;
}
}
int wmain() {
    HANDLE process = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ | PROCESS_CREATE_PROCESS | SYNCHRONIZE, FALSE, kPid);
    if (!process) { std::printf("error=open_process code=%lu\n", GetLastError()); return 1; }
    HANDLE thread = OpenThread(THREAD_QUERY_INFORMATION | SYNCHRONIZE, FALSE, kTid);
    if (!thread) { std::printf("error=open_thread code=%lu\n", GetLastError()); BOOL closed = CloseHandle(process); std::printf("cleanup process=%d\n", closed != FALSE); return 1; }
    int result = 1; HPSS snapshot = nullptr; HPSSWALK marker = nullptr; bool symbols = false;
    if (!SetConsoleCtrlHandler(on_control, TRUE)) { std::puts("error=cancel_handler"); BOOL t = CloseHandle(thread); BOOL p = CloseHandle(process); std::printf("cleanup thread=%d process=%d\n", t != FALSE, p != FALSE); return 1; }
    do {
        FILETIME pc{}, pe{}, pk{}, pu{}, tc{}, te{}, tk{}, tu{};
        DWORD procExit = 0, threadExit = 0;
        if (!GetProcessTimes(process, &pc, &pe, &pk, &pu) || value(pc) != kProcessTime ||
            !GetThreadTimes(thread, &tc, &te, &tk, &tu) || value(tc) != kThreadTime ||
            GetProcessIdOfThread(thread) != kPid || !GetExitCodeProcess(process, &procExit) ||
            !GetExitCodeThread(thread, &threadExit) || procExit != STILL_ACTIVE || threadExit != STILL_ACTIVE) {
            std::puts("error=identity_or_liveness"); break;
        }
        wchar_t path[MAX_PATH]{}; DWORD pathLength = MAX_PATH;
        if (!QueryFullProcessImageNameW(process, 0, path, &pathLength) || _wcsicmp(path, kImage) != 0 || !image_on_disk()) {
            std::puts("error=image_identity"); break;
        }
        MEMORYSTATUSEX memory{}; memory.dwLength = sizeof(memory);
        PROCESS_MEMORY_COUNTERS_EX pm{}; pm.cb = sizeof(pm);
        if (!GlobalMemoryStatusEx(&memory) || !GetProcessMemoryInfo(process, reinterpret_cast<PROCESS_MEMORY_COUNTERS*>(&pm), sizeof(pm))) {
            std::puts("error=memory_query"); break;
        }
        std::printf("preflight available_physical=%llu available_pagefile=%llu private_bytes=%llu\n",
            memory.ullAvailPhys, memory.ullAvailPageFile, static_cast<unsigned long long>(pm.PrivateUsage));
        BOOL inJob = FALSE;
        if (!IsProcessInJob(process, nullptr, &inJob)) { std::printf("error=job_query code=%lu\n", GetLastError()); break; }
        std::printf("preflight target_in_job=%d\n", inJob != FALSE);
        HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
        if (snap == INVALID_HANDLE_VALUE) { std::puts("error=thread_inventory"); break; }
        THREADENTRY32 entry{}; entry.dwSize = sizeof(entry); unsigned count = 0; bool found = false;
        BOOL ok = Thread32First(snap, &entry);
        DWORD enumerationError = ok ? ERROR_SUCCESS : GetLastError();
        while (ok) {
            if (entry.th32OwnerProcessID == kPid) { ++count; if (entry.th32ThreadID == kTid) found = true; }
            ok = Thread32Next(snap, &entry);
            if (!ok) enumerationError = GetLastError();
        }
        BOOL snapshotClosed = CloseHandle(snap);
        if (enumerationError != ERROR_NO_MORE_FILES || !snapshotClosed || !found) {
            std::puts("error=thread_inventory_incomplete"); break;
        }
        std::printf("preflight target_threads=%u selected_present=%d\n", count, found);
        constexpr ULONGLONG gib = 1024ULL * 1024ULL * 1024ULL;
        if (memory.ullAvailPhys < 8 * gib || memory.ullAvailPageFile < 8 * gib || pm.PrivateUsage > 2 * gib || count > 768 || gCancelled) {
            std::puts("error=preflight_threshold_or_cancel"); break;
        }
        std::puts("preflight limits_are_not_capture_caps job_policy_external_review_required=1");
        FILETIME pc2{}, pe2{}, pk2{}, pu2{}, tc2{}, te2{}, tk2{}, tu2{};
        if (!GetProcessTimes(process, &pc2, &pe2, &pk2, &pu2) || value(pc2) != kProcessTime ||
            !GetThreadTimes(thread, &tc2, &te2, &tk2, &tu2) || value(tc2) != kThreadTime ||
            GetProcessIdOfThread(thread) != kPid || WaitForSingleObject(process, 0) != WAIT_TIMEOUT ||
            WaitForSingleObject(thread, 0) != WAIT_TIMEOUT || gCancelled) { std::puts("error=pre_capture_identity"); break; }
        LARGE_INTEGER frequency{}, start{}, end{};
        if (!QueryPerformanceFrequency(&frequency) || !QueryPerformanceCounter(&start)) { std::puts("error=clock"); break; }
        DWORD status = PssCaptureSnapshot(process, static_cast<PSS_CAPTURE_FLAGS>(PSS_CAPTURE_VA_CLONE |
            PSS_CAPTURE_THREADS | PSS_CAPTURE_THREAD_CONTEXT), CONTEXT_CONTROL | CONTEXT_INTEGER, &snapshot);
        BOOL timed = QueryPerformanceCounter(&end);
        if (timed && frequency.QuadPart > 0) std::printf("capture elapsed_ms=%.3f status=%lu\n",
            1000.0 * static_cast<double>(end.QuadPart - start.QuadPart) / frequency.QuadPart, status);
        if (status != ERROR_SUCCESS || !timed || gCancelled) { std::puts("error=capture_or_cancel"); break; }
        PSS_VA_CLONE_INFORMATION clone{};
        status = PssQuerySnapshot(snapshot, PSS_QUERY_VA_CLONE_INFORMATION, &clone, sizeof(clone));
        if (status || !clone.VaCloneHandle) { std::printf("error=clone_query code=%lu\n", status); break; }
        gClone = clone.VaCloneHandle;
        DWORD clonePid = GetProcessId(gClone);
        if (!clonePid || clonePid == kPid) { std::puts("error=clone_pid"); break; }
        HANDLE monitor = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, clonePid);
        if (!monitor) { std::printf("clone_monitor open=0 code=%lu\n", GetLastError()); break; }
        FILETIME created{}, exited{}, kernel{}, user{};
        BOOL identity = GetProcessId(monitor) == clonePid && GetProcessTimes(monitor, &created, &exited, &kernel, &user);
        DWORD monitorError = identity ? ERROR_SUCCESS : GetLastError();
        if (identity) std::printf("clone_identity pid=%lu creation_filetime=%llu\n", clonePid, value(created));
        else std::printf("clone_monitor identity=0 code=%lu\n", monitorError);
        BOOL monitorClosed = CloseHandle(monitor);
        std::printf("cleanup clone_monitor_close=%d\n", monitorClosed != FALSE);
        if (!identity || !monitorClosed) break;
        status = PssWalkMarkerCreate(nullptr, &marker);
        if (status) { std::printf("error=marker_create code=%lu\n", status); break; }
        CONTEXT context{}; bool foundContext = false;
        for (unsigned i = 0; i < 768; ++i) {
            PSS_THREAD_ENTRY e{}; status = PssWalkSnapshot(snapshot, PSS_WALK_THREADS, marker, &e, sizeof(e));
            if (status) break;
            if (e.ProcessId != kPid || e.ThreadId != kTid) continue;
            if (value(e.CreateTime) != kThreadTime || !e.ContextRecord || e.SizeOfContextRecord < sizeof(CONTEXT) ||
                (e.ContextRecord->ContextFlags & (CONTEXT_CONTROL | CONTEXT_INTEGER)) != (CONTEXT_CONTROL | CONTEXT_INTEGER)) break;
            context = *e.ContextRecord; foundContext = true; break;
        }
        if (!foundContext || gCancelled || !modules_and_image()) { std::puts("error=context_or_clone_modules"); break; }
        wchar_t localPath[MAX_PATH]{}; if (!GetSystemDirectoryW(localPath, MAX_PATH)) break;
        DWORD opts = SYMOPT_DEFERRED_LOADS | SYMOPT_NO_PROMPTS | SYMOPT_SECURE | SYMOPT_IGNORE_CVREC |
            SYMOPT_IGNORE_NT_SYMPATH | SYMOPT_NO_IMAGE_SEARCH | SYMOPT_NO_UNQUALIFIED_LOADS | SYMOPT_DISABLE_SYMSRV_AUTODETECT;
        SymSetOptions(opts); if ((SymGetOptions() & opts) != opts) { std::puts("error=symbol_options"); break; }
        if (!SymInitializeW(gClone, localPath, FALSE)) { std::puts("error=symbol_initialize"); break; }
        symbols = true;
        if (!SymRegisterCallback64(gClone, symbol_callback, 0)) { std::puts("error=symbol_callback"); break; }
        STACKFRAME64 frame{}; frame.AddrPC.Offset = context.Rip; frame.AddrPC.Mode = AddrModeFlat;
        frame.AddrFrame.Offset = context.Rbp; frame.AddrFrame.Mode = AddrModeFlat;
        frame.AddrStack.Offset = context.Rsp; frame.AddrStack.Mode = AddrModeFlat;
        DWORD64 prevPc = context.Rip, prevSp = context.Rsp; unsigned accepted = 0; bool echo = false;
        const char* reason = "frame_limit";
        if (!find_module(prevPc)) { std::puts("error=unknown_initial_module"); break; }
        for (unsigned i = 0; i < kMaxFrames && !gCancelled; ++i) {
            Module* current = find_module(prevPc);
            if (!current) { reason = "unknown_module"; break; }
            if (!current->loaded) {
                const wchar_t* currentName = std::wcsrchr(current->path, L'\\');
                currentName = currentName ? currentName + 1 : current->path;
                if (!SymLoadModuleExW(gClone, nullptr, current->path, nullptr, current->base, current->size, nullptr, 0) || gReadFailed) {
                    std::printf("module_load_failure module=%ls state=partial read_failure=%d\n", currentName, gReadFailed);
                    reason = "module_load_failed"; break;
                }
                current->loaded = true;
            }
            if (!StackWalk64(IMAGE_FILE_MACHINE_AMD64, gClone, thread, &frame, &context,
                bounded_read, SymFunctionTableAccess64, SymGetModuleBase64, nullptr)) { reason = gReadFailed ? "read_failure" : "walk_stopped"; break; }
            if (gReadFailed || gCancelled) { reason = gReadFailed ? "read_failure" : "cancelled"; break; }
            if (i == 0 && prevPc && prevSp && frame.AddrPC.Offset == prevPc && frame.AddrStack.Offset == prevSp) { echo = true; continue; }
            if (!frame.AddrPC.Offset || frame.AddrStack.Offset <= prevSp) { reason = "invalid_progress"; break; }
            const Module* module = find_module(frame.AddrPC.Offset);
            if (!module) { reason = "unknown_module"; break; }
            MEMORY_BASIC_INFORMATION region{};
            if (!VirtualQueryEx(gClone, reinterpret_cast<LPCVOID>(frame.AddrPC.Offset), &region, sizeof(region))) {
                reason = "frame_mapping_query_failed"; break;
            }
            const char* mapping = region.Type == MEM_IMAGE ? "image" : region.Type == MEM_MAPPED ? "mapped" :
                region.Type == MEM_PRIVATE ? "private" : "unknown";
            if (region.State != MEM_COMMIT || region.Type != MEM_IMAGE) { reason = "unsupported_frame_mapping"; break; }
            const wchar_t* name = std::wcsrchr(module->path, L'\\'); name = name ? name + 1 : module->path;
            std::printf("frame index=%u module=%ls rva=0x%llx mapping=%s metadata=clone_disk_pe_headers\n",
                accepted, name, frame.AddrPC.Offset - module->base, mapping);
            prevPc = frame.AddrPC.Offset; prevSp = frame.AddrStack.Offset; ++accepted;
        }
        if (gCancelled) reason = "cancelled";
        std::printf("walk state=partial stop=%s accepted=%u echo=%d read_failure=%d cancelled=%ld\n", reason, accepted, echo, gReadFailed, gCancelled);
        // Truncation or missing metadata is never a completed stack.
        result = 1;
    } while (false);
    std::printf("result state=partial read_failure=%d cancelled=%ld\n", gReadFailed, gCancelled);
    if (symbols) { BOOL ok = SymCleanup(gClone); std::printf("cleanup symbols=%d\n", ok != FALSE); if (!ok) result = 1; }
    if (marker) { DWORD code = PssWalkMarkerFree(marker); std::printf("cleanup marker=%lu\n", code); if (code) result = 1; }
    if (snapshot) { DWORD code = PssFreeSnapshot(GetCurrentProcess(), snapshot); std::printf("cleanup snapshot=%lu\n", code); if (code) result = 1; }
    BOOL threadClosed = CloseHandle(thread); std::printf("cleanup thread=%d\n", threadClosed != FALSE);
    BOOL processClosed = CloseHandle(process); std::printf("cleanup process=%d\n", processClosed != FALSE);
    if (!threadClosed || !processClosed) result = 1;
    return result;
}
