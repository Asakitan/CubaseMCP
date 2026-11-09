#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <processsnapshot.h>
#include <tlhelp32.h>
#include <cstdio>
#include <cwchar>
#include <cstdint>

namespace {
constexpr DWORD kPid = 24036, kTid = 59956;
constexpr ULONGLONG kProcessTime = 134387250823263004ULL;
constexpr ULONGLONG kThreadTime = 134387250823263010ULL;
constexpr wchar_t kImage[] = L"C:\\Program Files\\Steinberg\\Cubase 16\\Cubase 16.exe";
constexpr DWORD kTimestamp = 0x6adf121b;
constexpr ULONGLONG kBase = 0x140000000ULL;
ULONGLONG filetime(const FILETIME& t) { return (static_cast<ULONGLONG>(t.dwHighDateTime) << 32) | t.dwLowDateTime; }
struct Baseline { bool owned = false; bool prompt = false; };
BOOL CALLBACK inspect_window(HWND window, LPARAM parameter) {
    auto& result = *reinterpret_cast<Baseline*>(parameter);
    DWORD owner = 0;
    GetWindowThreadProcessId(window, &owner);
    if (owner != kPid) return TRUE;
    result.owned = true;
    wchar_t title[128] = {};
    if (IsWindowVisible(window) && GetWindowTextW(window, title, 128) > 0 && std::wcscmp(title, L"Cubase AI") == 0) result.prompt = true;
    return TRUE;
}
bool desktop_baseline() {
    HDESK desktop = OpenDesktopW(L"CubaseAI_MCP", 0, FALSE, DESKTOP_READOBJECTS | DESKTOP_ENUMERATE);
    if (!desktop) { std::printf("error=OpenDesktopW code=%lu\n", GetLastError()); return false; }
    Baseline baseline;
    BOOL ok = EnumDesktopWindows(desktop, inspect_window, reinterpret_cast<LPARAM>(&baseline));
    DWORD err = ok ? ERROR_SUCCESS : GetLastError();
    if (!CloseDesktop(desktop)) { std::printf("error=CloseDesktop code=%lu\n", GetLastError()); return false; }
    std::printf("baseline owned=%d visible_title=%d enumeration_error=%lu\n", baseline.owned, baseline.prompt, err);
    return ok && baseline.owned && baseline.prompt;
}
bool identity(HANDLE process, HANDLE thread) {
    FILETIME pc{}, pe{}, pk{}, pu{}, tc{}, te{}, tk{}, tu{};
    if (!GetProcessTimes(process, &pc, &pe, &pk, &pu) || !GetThreadTimes(thread, &tc, &te, &tk, &tu)) return false;
    if (filetime(pc) != kProcessTime || filetime(tc) != kThreadTime || GetProcessIdOfThread(thread) != kPid) return false;
    DWORD exitcode = 0;
    if (!GetExitCodeProcess(process, &exitcode) || exitcode != STILL_ACTIVE || !GetExitCodeThread(thread, &exitcode) || exitcode != STILL_ACTIVE) return false;
    wchar_t path[MAX_PATH] = {}; DWORD length = MAX_PATH;
    if (!QueryFullProcessImageNameW(process, 0, path, &length) || _wcsicmp(path, kImage) != 0) return false;
    HANDLE modules = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, kPid);
    if (modules == INVALID_HANDLE_VALUE) return false;
    MODULEENTRY32W m{}; m.dwSize = sizeof(m);
    bool match = Module32FirstW(modules, &m) && _wcsicmp(m.szExePath, kImage) == 0 && reinterpret_cast<ULONGLONG>(m.modBaseAddr) == kBase;
    if (!CloseHandle(modules)) match = false;
    if (!match) return false;
    IMAGE_DOS_HEADER dos{}; SIZE_T got = 0;
    if (!ReadProcessMemory(process, reinterpret_cast<const void*>(kBase), &dos, sizeof(dos), &got) || got != sizeof(dos) || dos.e_magic != IMAGE_DOS_SIGNATURE || dos.e_lfanew < 0 || dos.e_lfanew > 4096) return false;
    IMAGE_NT_HEADERS64 nt{};
    if (!ReadProcessMemory(process, reinterpret_cast<const void*>(kBase + static_cast<DWORD>(dos.e_lfanew)), &nt, sizeof(nt), &got) || got != sizeof(nt)) return false;
    return nt.Signature == IMAGE_NT_SIGNATURE && nt.FileHeader.Machine == IMAGE_FILE_MACHINE_AMD64 && nt.FileHeader.TimeDateStamp == kTimestamp && nt.OptionalHeader.Magic == IMAGE_NT_OPTIONAL_HDR64_MAGIC;
}
}
int wmain() {
    int rc = 1;
    HANDLE process = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, FALSE, kPid);
    if (!process) { std::printf("error=OpenProcess code=%lu\n", GetLastError()); return 1; }
    HANDLE thread = OpenThread(THREAD_QUERY_INFORMATION, FALSE, kTid);
    if (!thread) {
        std::printf("error=OpenThread code=%lu\n", GetLastError());
        if (!CloseHandle(process)) std::printf("error=CloseProcess code=%lu\n", GetLastError());
        return 1;
    }
    HPSS snapshot = nullptr; HPSSWALK marker = nullptr;
    do {
        if (!identity(process, thread)) { std::puts("error=identity_or_image_validation"); break; }
        if (!desktop_baseline()) { std::puts("error=private_desktop_baseline"); break; }
        DWORD status = PssCaptureSnapshot(process, static_cast<PSS_CAPTURE_FLAGS>(PSS_CAPTURE_THREADS | PSS_CAPTURE_THREAD_CONTEXT), CONTEXT_CONTROL | CONTEXT_INTEGER, &snapshot);
        if (status != ERROR_SUCCESS) { std::printf("error=PssCaptureSnapshot code=%lu\n", status); break; }
        status = PssWalkMarkerCreate(nullptr, &marker);
        if (status != ERROR_SUCCESS) { std::printf("error=PssWalkMarkerCreate code=%lu\n", status); break; }
        bool found = false;
        for (unsigned count = 0; count < 4096; ++count) {
            PSS_THREAD_ENTRY entry{};
            status = PssWalkSnapshot(snapshot, PSS_WALK_THREADS, marker, &entry, sizeof(entry));
            if (status == ERROR_NO_MORE_ITEMS) break;
            if (status != ERROR_SUCCESS) { std::printf("error=PssWalkSnapshot code=%lu\n", status); break; }
            if (entry.ProcessId != kPid || entry.ThreadId != kTid) continue;
            if (filetime(entry.CreateTime) != kThreadTime || !entry.ContextRecord || entry.SizeOfContextRecord < sizeof(CONTEXT)) { std::puts("error=thread_context_identity_or_size"); break; }
            const CONTEXT& context = *entry.ContextRecord;
            if ((context.ContextFlags & (CONTEXT_CONTROL | CONTEXT_INTEGER)) != (CONTEXT_CONTROL | CONTEXT_INTEGER)) { std::puts("error=context_flags"); break; }
            if (!identity(process, thread)) { std::puts("error=identity_changed_after_capture"); break; }
            std::printf("context pid=%lu tid=%lu capture_filetime=%llu rip=0x%llx rsp=0x%llx rbp=0x%llx\n", kPid, kTid, filetime(entry.CaptureTime), context.Rip, context.Rsp, context.Rbp);
            found = true; rc = 0; break;
        }
        if (!found) std::puts(status == ERROR_NO_MORE_ITEMS ? "error=thread_not_in_snapshot" : "error=thread_search_incomplete");
    } while (false);
    if (marker) { DWORD s = PssWalkMarkerFree(marker); if (s != ERROR_SUCCESS) { std::printf("error=PssWalkMarkerFree code=%lu\n", s); rc = 1; } }
    if (snapshot) { DWORD s = PssFreeSnapshot(GetCurrentProcess(), snapshot); if (s != ERROR_SUCCESS) { std::printf("error=PssFreeSnapshot code=%lu\n", s); rc = 1; } }
    if (!CloseHandle(thread)) { std::printf("error=CloseThread code=%lu\n", GetLastError()); rc = 1; }
    if (!CloseHandle(process)) { std::printf("error=CloseProcess code=%lu\n", GetLastError()); rc = 1; }
    return rc;
}
