#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winver.h>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <cwchar>
#include <vector>

// Build-specific, one-shot diagnostic. DllMain performs no host or file work.
namespace {
constexpr DWORD kTimestamp = 0x6adf121b;
const unsigned char kPathIid[16] = {0xa1,0x8e,0xf3,0x0a,0xf2,0x40,0x14,0x4b,0x96,0x5b,0xf9,0x7c,0xa4,0xff,0x94,0xd1};
volatile LONG started = 0;
HINSTANCE module = nullptr;

bool readable(const void* address, size_t length) {
    MEMORY_BASIC_INFORMATION m{};
    if (!VirtualQuery(address, &m, sizeof(m)) || m.State != MEM_COMMIT ||
        (m.Protect & (PAGE_GUARD | PAGE_NOACCESS))) return false;
    const auto begin = reinterpret_cast<uintptr_t>(address);
    const auto end = reinterpret_cast<uintptr_t>(m.BaseAddress) + m.RegionSize;
    return begin <= end && length <= end - begin;
}

bool versionMatches(const wchar_t* path) {
    DWORD unused = 0;
    DWORD size = GetFileVersionInfoSizeW(path, &unused);
    if (!size || size > 1024 * 1024) return false;
    std::vector<unsigned char> data(size);
    if (!GetFileVersionInfoW(path, 0, size, data.data())) return false;
    VS_FIXEDFILEINFO* info = nullptr;
    UINT bytes = 0;
    return VerQueryValueW(data.data(), L"\\", reinterpret_cast<void**>(&info), &bytes) &&
        bytes >= sizeof(*info) && info->dwSignature == 0xfeef04bd &&
        HIWORD(info->dwFileVersionMS) == 16 && LOWORD(info->dwFileVersionMS) == 0 &&
        HIWORD(info->dwFileVersionLS) == 5;
}

struct PathProbeResult {
    bool profileMatched;
    bool openStarted;
    bool openReturned;
    long openResult;
    DWORD eventThreadId;
    bool callStarted;
    bool callReturned;
    bool objectPresent;
    bool vtableMatched;
    bool releaseAttempted;
    bool setterAttempted;
    bool setterReturned;
    bool directoryWide;
    bool filenameWide;
    bool directoryMatches;
    bool filenameMatches;
    long callResult;
    long setterResult;
    unsigned directoryLength;
    unsigned filenameLength;
    DWORD exceptionCode;
    DWORD threadId;
};

bool reportPath(const char* stage, const PathProbeResult& result, bool startRecord, bool roundTrip = false) {
    wchar_t directory[MAX_PATH];
    const DWORD length = GetModuleFileNameW(module, directory, MAX_PATH);
    if (!length || length >= MAX_PATH) return false;
    wchar_t* slash = wcsrchr(directory, L'\\');
    if (!slash) return false;
    *slash = L'\0';
    wchar_t finalPath[MAX_PATH], tempPath[MAX_PATH];
    const DWORD pid = GetCurrentProcessId();
    const wchar_t* kind = startRecord ? L"open-start" : L"open-result";
    (void)roundTrip;
    if (swprintf_s(finalPath, L"%s\\%s-%lu.json", directory, kind, pid) < 0 ||
        swprintf_s(tempPath, L"%s\\%s-%lu.tmp", directory, kind, pid) < 0) return false;
    char json[768];
    const int count = sprintf_s(json,
        "{\"processId\":%lu,\"stage\":\"%s\",\"threadId\":%lu,\"profileMatched\":%s,"
        "\"openStarted\":%s,\"openReturned\":%s,\"openResult\":%ld,\"eventThreadId\":%lu,"
        "\"callStarted\":%s,\"callReturned\":%s,\"callResult\":%ld,\"objectPresent\":%s,"
        "\"vtableMatched\":%s,\"releaseAttempted\":%s,\"setterAttempted\":%s,"
        "\"setterReturned\":%s,\"setterResult\":%ld,\"directoryWide\":%s,\"filenameWide\":%s,"
        "\"directoryLength\":%u,\"filenameLength\":%u,\"directoryMatches\":%s,\"filenameMatches\":%s,\"exceptionCode\":%lu}\n",
        pid, stage, result.threadId, result.profileMatched ? "true" : "false",
        result.openStarted ? "true" : "false", result.openReturned ? "true" : "false", result.openResult, result.eventThreadId,
        result.callStarted ? "true" : "false", result.callReturned ? "true" : "false",
        result.callResult, result.objectPresent ? "true" : "false",
        result.vtableMatched ? "true" : "false", result.releaseAttempted ? "true" : "false",
        result.setterAttempted ? "true" : "false", result.setterReturned ? "true" : "false", result.setterResult,
        result.directoryWide ? "true" : "false", result.filenameWide ? "true" : "false",
        result.directoryLength, result.filenameLength, result.directoryMatches ? "true" : "false",
        result.filenameMatches ? "true" : "false",
        result.exceptionCode);
    if (count <= 0) return false;
    HANDLE file = CreateFileW(tempPath, GENERIC_WRITE, 0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return false;
    DWORD written = 0;
    const bool ok = WriteFile(file, json, static_cast<DWORD>(count), &written, nullptr) &&
        written == static_cast<DWORD>(count) && FlushFileBuffers(file);
    CloseHandle(file);
    if (!ok || !MoveFileExW(tempPath, finalPath, MOVEFILE_WRITE_THROUGH)) {
        DeleteFileW(tempPath);
        return false;
    }
    return true;
}

struct ObserverContract { uint32_t version, pid; uint64_t creation, deadline; };
static_assert(sizeof(ObserverContract) == 24, "Unexpected observer contract layout");

bool observerActive() {
    wchar_t path[MAX_PATH];
    const DWORD length = GetModuleFileNameW(module, path, MAX_PATH);
    if (!length || length >= MAX_PATH) return false;
    wchar_t* slash = wcsrchr(path, L'\\');
    if (!slash) return false;
    *slash = L'\0';
    if (wcscat_s(path, L"\\observer-contract-72128.bin") != 0) return false;
    HANDLE file = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
    if (file == INVALID_HANDLE_VALUE) return false;
    BY_HANDLE_FILE_INFORMATION info{};
    LARGE_INTEGER size{};
    ObserverContract contract{};
    DWORD bytes = 0;
    const bool valid = GetFileInformationByHandle(file, &info) &&
        !(info.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) &&
        GetFileSizeEx(file, &size) && size.QuadPart == static_cast<LONGLONG>(sizeof(contract)) &&
        ReadFile(file, &contract, static_cast<DWORD>(sizeof(contract)), &bytes, nullptr) &&
        bytes == static_cast<DWORD>(sizeof(contract));
    CloseHandle(file);
    if (!valid || contract.version != 1 || !contract.pid || !contract.creation || !contract.deadline) return false;
    HANDLE observer = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, contract.pid);
    if (!observer) return false;
    FILETIME creation{}, exitTime{}, kernel{}, user{}, now{};
    GetSystemTimeAsFileTime(&now);
    const bool active = GetProcessTimes(observer, &creation, &exitTime, &kernel, &user) &&
        ((static_cast<uint64_t>(creation.dwHighDateTime) << 32) | creation.dwLowDateTime) == contract.creation &&
        ((static_cast<uint64_t>(now.dwHighDateTime) << 32) | now.dwLowDateTime) < contract.deadline &&
        WaitForSingleObject(observer, 0) == WAIT_TIMEOUT;
    CloseHandle(observer);
    return active;
}

bool pathFieldMatches(const unsigned char* object, size_t offset, const wchar_t* expected,
                      bool* wide, unsigned* length) {
    if (!readable(object + offset, 0x18)) return false;
    const auto data = *reinterpret_cast<const void* const*>(object + offset + 8);
    const uint32_t flags = *reinterpret_cast<const uint32_t*>(object + offset + 0x10);
    *wide = (flags & 0x40000000U) != 0;
    *length = flags & 0x3fffffffU;
    const size_t expectedLength = wcslen(expected);
    if (*length > 512 || *length != expectedLength || !data) return false;
    if (*wide) {
        const size_t bytes = static_cast<size_t>(*length) * sizeof(wchar_t);
        return readable(data, bytes) && std::memcmp(data, expected, bytes) == 0;
    }
    if (!readable(data, *length)) return false;
    const auto bytes = static_cast<const unsigned char*>(data);
    for (unsigned i = 0; i < *length; ++i)
        if (expected[i] > 0x7f || bytes[i] != static_cast<unsigned char>(expected[i])) return false;
    return true;
}

bool backgroundInputDesktop() {
    HDESK desktop = OpenInputDesktop(0, FALSE, DESKTOP_READOBJECTS);
    if (!desktop) return false;
    wchar_t name[256]{};
    DWORD needed = 0;
    const bool ok = GetUserObjectInformationW(desktop, UOI_NAME, name, sizeof(name), &needed) != FALSE &&
        name[0] != L'\0' && _wcsicmp(name, L"CubaseAI_MCP") != 0;
    CloseDesktop(desktop);
    return ok;
}

bool eventThread(uintptr_t base, DWORD* thread) {
    __try {
        auto platformGlobal = reinterpret_cast<uintptr_t*>(base + 0x5973dd0);
        auto factoryGlobal = reinterpret_cast<uintptr_t*>(base + 0x597d000);
        if (!readable(platformGlobal, sizeof(*platformGlobal)) || !readable(factoryGlobal, sizeof(*factoryGlobal))) return false;
        const uintptr_t platform = *platformGlobal, factory = *factoryGlobal;
        if (!platform || !factory || !readable(reinterpret_cast<void*>(platform + 0x10), sizeof(uintptr_t)) ||
            *reinterpret_cast<uintptr_t*>(platform + 0x10) != base + 0x4713f68 ||
            !readable(reinterpret_cast<void*>(base + 0x4713f68), 0x90) ||
            *reinterpret_cast<uintptr_t*>(base + 0x4713f68 + 0x88) != base + 0x3674c90 ||
            !readable(reinterpret_cast<void*>(factory + 8), sizeof(uintptr_t)) ||
            *reinterpret_cast<uintptr_t*>(factory + 8) != base + 0x4797908 ||
            !readable(reinterpret_cast<void*>(base + 0x4797908), 0x50) ||
            *reinterpret_cast<uintptr_t*>(base + 0x4797908 + 0x48) != base + 0x18f7d00 ||
            !readable(reinterpret_cast<void*>(factory + 0x48), 0x180) ||
            *reinterpret_cast<uintptr_t*>(factory + 0x48) != base + 0x4799968 ||
            !readable(reinterpret_cast<void*>(base + 0x4799968), 0xb8) ||
            *reinterpret_cast<uintptr_t*>(base + 0x4799968 + 0xb0) != base + 0x3935710) return false;
        const DWORD current = *reinterpret_cast<DWORD*>(factory + 0x48 + 0x178);
        if (!current || *platformGlobal != platform || *factoryGlobal != factory ||
            *reinterpret_cast<DWORD*>(factory + 0x48 + 0x178) != current) return false;
        *thread = current;
        return true;
    } __except (EXCEPTION_EXECUTE_HANDLER) { return false; }
}


bool holderAlive() {
    HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, 55324);
    if (!h) return false;
    FILETIME c{}, e{}, k{}, u{};
    const bool ok = GetProcessTimes(h, &c, &e, &k, &u) &&
        ((static_cast<uint64_t>(c.dwHighDateTime) << 32) | c.dwLowDateTime) == 134387281647304009ULL &&
        WaitForSingleObject(h, 0) == WAIT_TIMEOUT;
    CloseHandle(h); return ok;
}

bool holderJobVerified() {
    if (!holderAlive()) return false;
    HANDLE holder = OpenProcess(PROCESS_DUP_HANDLE | PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, 55324);
    HANDLE marker = CreateJobObjectW(nullptr, nullptr);
    const ULONG length = 32U * 1024U * 1024U;
    void* buffer = HeapAlloc(GetProcessHeap(), 0, length);
    if (!holder || !marker || !buffer) {
        if (buffer) HeapFree(GetProcessHeap(), 0, buffer);
        if (marker) CloseHandle(marker);
        if (holder) CloseHandle(holder);
        return false;
    }
    FILETIME holderCreation{}, holderExit{}, holderKernel{}, holderUser{};
    const bool holderIdentity = GetProcessTimes(holder, &holderCreation, &holderExit, &holderKernel, &holderUser) &&
        ((static_cast<uint64_t>(holderCreation.dwHighDateTime) << 32) | holderCreation.dwLowDateTime) == 134387281647304009ULL &&
        WaitForSingleObject(holder, 0) == WAIT_TIMEOUT;
    using NtQuery = LONG (NTAPI*)(ULONG, PVOID, ULONG, PULONG);
    HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
    auto query = ntdll ? reinterpret_cast<NtQuery>(GetProcAddress(ntdll, "NtQuerySystemInformation")) : nullptr;
    ULONG required = 0; bool verified = false;
    if (holderIdentity && query && query(64, buffer, length, &required) == 0) {
        auto bytes = static_cast<unsigned char*>(buffer);
        const uint64_t count = *reinterpret_cast<uint64_t*>(bytes);
        if (count > 0 && count <= (length - 16U) / 40U) {
            USHORT jobType = 0;
            for (uint64_t i = 0; i < count; ++i) {
                auto entry = bytes + 16U + static_cast<size_t>(i) * 40U;
                if (*reinterpret_cast<uint64_t*>(entry + 8) == GetCurrentProcessId() &&
                    *reinterpret_cast<uint64_t*>(entry + 16) == reinterpret_cast<uintptr_t>(marker)) {
                    jobType = *reinterpret_cast<USHORT*>(entry + 30); break;
                }
            }
            unsigned matches = 0;
            if (jobType) for (uint64_t i = 0; i < count; ++i) {
                auto entry = bytes + 16U + static_cast<size_t>(i) * 40U;
                if (*reinterpret_cast<uint64_t*>(entry + 8) != 55324 || *reinterpret_cast<USHORT*>(entry + 30) != jobType) continue;
                HANDLE job = nullptr;
                HANDLE source = reinterpret_cast<HANDLE>(*reinterpret_cast<uintptr_t*>(entry + 16));
                if (!DuplicateHandle(holder, source, GetCurrentProcess(), &job, JOB_OBJECT_QUERY, FALSE, 0)) continue;
                BOOL member = FALSE; JOBOBJECT_BASIC_UI_RESTRICTIONS ui{}; JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
                bool matched = IsProcessInJob(GetCurrentProcess(), job, &member) && member &&
                    QueryInformationJobObject(job, JobObjectBasicUIRestrictions, &ui, sizeof(ui), nullptr) &&
                    QueryInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits), nullptr) &&
                    ui.UIRestrictionsClass == 64 && limits.BasicLimitInformation.LimitFlags == 8192;
                if (matched) ++matches;
                if (!CloseHandle(job)) { matches = 0; break; }
            }
            verified = matches == 1 && holderAlive() && WaitForSingleObject(holder, 0) == WAIT_TIMEOUT;
        }
    }
    if (!HeapFree(GetProcessHeap(), 0, buffer)) verified = false;
    if (!CloseHandle(marker)) verified = false;
    if (!CloseHandle(holder)) verified = false;
    return verified;
}
bool firstProjectState(uintptr_t base) {
    __try {
        auto pg = reinterpret_cast<uintptr_t*>(base + 0x59110d0);
        auto ig = reinterpret_cast<uintptr_t*>(base + 0x5909af0);
        if (!readable(pg, sizeof(*pg)) || !readable(ig, sizeof(*ig))) return false;
        const uintptr_t project = *pg, informer = *ig;
        if (!project || !informer || !readable(reinterpret_cast<void*>(project), 0x100) ||
            !readable(reinterpret_cast<void*>(informer), 0x98)) return false;
        if (*reinterpret_cast<uintptr_t*>(project) != base + 0x447d378 ||
            *reinterpret_cast<uintptr_t*>(project + 0x78) != base + 0x4192350 ||
            *reinterpret_cast<uintptr_t*>(project + 0xc8) != base + 0x447d2f8 ||
            *reinterpret_cast<uintptr_t*>(informer) != base + 0x4452800 ||
            *reinterpret_cast<uintptr_t*>(informer + 0x20) != base + 0x4452900) return false;
        if (*reinterpret_cast<uint32_t*>(project + 0x88) != 0 ||
            *reinterpret_cast<uintptr_t*>(project + 0x90) != 0 ||
            *reinterpret_cast<uintptr_t*>(project + 0xf8) != 0) return false;
        uintptr_t tree = *reinterpret_cast<uintptr_t*>(informer + 0x88);
        if (!tree || *reinterpret_cast<uint64_t*>(informer + 0x90) != 0 || !readable(reinterpret_cast<void*>(tree), 0x28) ||
            *reinterpret_cast<unsigned char*>(tree + 0x19) != 1 || *reinterpret_cast<uintptr_t*>(tree + 8) != tree) return false;
        const uint32_t count = *reinterpret_cast<uint32_t*>(project + 0xd8);
        uintptr_t node = *reinterpret_cast<uintptr_t*>(project + 0xe0);
        if (!count || count > 128) return false;
        uintptr_t nodes[128]{}, nexts[128]{}, contents[128]{}; bool found = false;
        for (uint32_t i = 0; i < count; ++i) {
            if (!node || !readable(reinterpret_cast<void*>(node), 16)) return false;
            for (uint32_t j = 0; j < i; ++j) if (nodes[j] == node) return false;
            nodes[i] = node; nexts[i] = *reinterpret_cast<uintptr_t*>(node);
            contents[i] = *reinterpret_cast<uintptr_t*>(node + 8);
            if (contents[i] == informer + 0x20) found = true;
            node = nexts[i];
        }
        if (node || !found) return false;
        for (uint32_t i = 0; i < count; ++i)
            if (!readable(reinterpret_cast<void*>(nodes[i]), 16) ||
                *reinterpret_cast<uintptr_t*>(nodes[i]) != nexts[i] ||
                *reinterpret_cast<uintptr_t*>(nodes[i] + 8) != contents[i]) return false;
        return *pg == project && *ig == informer &&
            *reinterpret_cast<uintptr_t*>(project) == base + 0x447d378 &&
            *reinterpret_cast<uintptr_t*>(project + 0x78) == base + 0x4192350 &&
            *reinterpret_cast<uintptr_t*>(project + 0xc8) == base + 0x447d2f8 &&
            *reinterpret_cast<uintptr_t*>(informer) == base + 0x4452800 &&
            *reinterpret_cast<uintptr_t*>(informer + 0x20) == base + 0x4452900 &&
            *reinterpret_cast<uint32_t*>(project + 0x88) == 0 && *reinterpret_cast<uintptr_t*>(project + 0x90) == 0 &&
            *reinterpret_cast<uintptr_t*>(project + 0xf8) == 0 &&
            *reinterpret_cast<uint32_t*>(project + 0xd8) == count && *reinterpret_cast<uintptr_t*>(project + 0xe0) == nodes[0] &&
            *reinterpret_cast<uintptr_t*>(informer + 0x88) == tree && *reinterpret_cast<uint64_t*>(informer + 0x90) == 0 &&
            *reinterpret_cast<unsigned char*>(tree + 0x19) == 1 && *reinterpret_cast<uintptr_t*>(tree + 8) == tree;
    } __except (EXCEPTION_EXECUTE_HANDLER) { return false; }
}

// Fixed disposable fixture: perform one observed-shape path setup and host-open submission.
void guardedPathRoundTrip(PathProbeResult* result, uintptr_t base, void* classes) {
    __try {
        using Lookup = long (__fastcall*)(void*, const unsigned char*, void**);
        using Setter = long (__fastcall*)(void*, const wchar_t*, int32_t);
        const wchar_t* input = L"E:\\VC\\CubaseMCP\\artifacts\\live-smoke\\First Empty Probe 24.cpr";
        const wchar_t* directory = L"E:\\VC\\CubaseMCP\\artifacts\\live-smoke\\";
        const wchar_t* filename = L"First Empty Probe 24.cpr";
        auto classVtable = *reinterpret_cast<void***>(classes);
        void* object = nullptr;
        result->callStarted = true;
        result->callResult = reinterpret_cast<Lookup>(classVtable[3])(classes, kPathIid, &object);
        result->callReturned = true;
        result->objectPresent = object != nullptr;
        if (result->callResult != 0 || !object || !readable(object, sizeof(void*))) return;
        auto objectVtable = *reinterpret_cast<uintptr_t**>(object);
        auto complete = static_cast<unsigned char*>(object) - 0x10;
        if (!readable(complete, 0xe8) || !readable(objectVtable, 5 * sizeof(void*))) return;
        auto primary = *reinterpret_cast<uintptr_t**>(complete);
        result->vtableMatched = reinterpret_cast<uintptr_t>(objectVtable) == base + 0x4831d70 &&
            reinterpret_cast<uintptr_t>(primary) == base + 0x4831bc0 && readable(primary, 0x1a8) &&
            objectVtable[2] == base + 0x15c31c8 && objectVtable[4] == base + 0x3b0f4b0 &&
            primary[0x178 / sizeof(void*)] == base + 0x3b0e0e0 &&
            primary[0x180 / sizeof(void*)] == base + 0x3b0e860 &&
            primary[0x1a0 / sizeof(void*)] == base + 0x3b0ddf0;
        if (!result->vtableMatched) return;
        result->setterAttempted = true;
        result->setterResult = reinterpret_cast<Setter>(objectVtable[4])(object, input, 0);
        result->setterReturned = true;
        if (result->setterResult == 0) {
            result->directoryMatches = pathFieldMatches(complete, 0xc8, directory,
                &result->directoryWide, &result->directoryLength);
            result->filenameMatches = pathFieldMatches(complete, 0x18, filename,
                &result->filenameWide, &result->filenameLength);
        }
        // Retain the object for the process lifetime: posted ownership remains unknown.
        auto host = reinterpret_cast<void*>(base + 0x55233f8);
        if (!readable(host, sizeof(void*))) return;
        auto hostVtable = *reinterpret_cast<uintptr_t**>(host);
        if (reinterpret_cast<uintptr_t>(hostVtable) != base + 0x4737230 ||
            !readable(hostVtable, 0x20) || hostVtable[3] != base + 0x3751d40) return;
        if (!result->directoryMatches || !result->filenameMatches) return;
        DWORD before = 0;
        if (!holderJobVerified() || !firstProjectState(base) || !backgroundInputDesktop() || !observerActive() || !eventThread(base, &before) || before == result->threadId ||
            before != result->eventThreadId) return;
        if (!reportPath("open_call_ready", *result, true, true)) return;
        DWORD immediatelyBefore = 0;
        if (!holderJobVerified() || !firstProjectState(base) || !backgroundInputDesktop() || !observerActive() || !eventThread(base, &immediatelyBefore) ||
            immediatelyBefore != before || immediatelyBefore == result->threadId) return;
        result->openStarted = true;
        using Open = long (__fastcall*)(void*, void*, void*);
        result->openResult = reinterpret_cast<Open>(hostVtable[3])(host, object, nullptr);
        result->openReturned = true;
    } __except (EXCEPTION_EXECUTE_HANDLER) { result->exceptionCode = GetExceptionCode(); }
}

}

DWORD pathProbeWorkerCore(bool roundTrip) {
    PathProbeResult result{};
    result.threadId = GetCurrentThreadId();
    result.callResult = -1;
    result.setterResult = -1;
    result.openResult = -1;
    FILETIME creation{}, exitTime{}, kernel{}, user{};
    if (GetCurrentProcessId() != 72128 || !GetProcessTimes(GetCurrentProcess(), &creation, &exitTime, &kernel, &user) ||
        ((static_cast<unsigned long long>(creation.dwHighDateTime) << 32) | creation.dwLowDateTime) != 134387281655745512ULL)
        return reportPath("target_identity_mismatch", result, false, roundTrip) ? 3 : 9;
    if (!backgroundInputDesktop()) return reportPath("target_desktop_active", result, false, roundTrip) ? 3 : 9;
    wchar_t path[MAX_PATH];
    const DWORD n = GetModuleFileNameW(nullptr, path, MAX_PATH);
    const wchar_t* name = n ? wcsrchr(path, L'\\') : nullptr;
    if (!n || n >= MAX_PATH || !name || _wcsicmp(name + 1, L"Cubase 16.exe") != 0 || !versionMatches(path))
        return reportPath("host_version_mismatch", result, false, roundTrip) ? 3 : 9;
    const auto base = reinterpret_cast<uintptr_t>(GetModuleHandleW(nullptr));
    auto dos = reinterpret_cast<const IMAGE_DOS_HEADER*>(base);
    if (!readable(dos, sizeof(*dos)) || dos->e_magic != IMAGE_DOS_SIGNATURE || dos->e_lfanew < 0 || dos->e_lfanew > 0x100000)
        return reportPath("invalid_image", result, false, roundTrip) ? 4 : 9;
    auto nt = reinterpret_cast<const IMAGE_NT_HEADERS64*>(base + dos->e_lfanew);
    if (!readable(nt, sizeof(*nt)) || nt->Signature != IMAGE_NT_SIGNATURE ||
        nt->FileHeader.Machine != IMAGE_FILE_MACHINE_AMD64 || nt->FileHeader.TimeDateStamp != kTimestamp ||
        nt->OptionalHeader.Magic != IMAGE_NT_OPTIONAL_HDR64_MAGIC || nt->OptionalHeader.SizeOfImage <= 0x59a0410)
        return reportPath("build_mismatch", result, false, roundTrip) ? 4 : 9;
    auto classes = reinterpret_cast<void*>(base + 0x5523458);
    auto record = reinterpret_cast<const unsigned char*>(base + 0x59a03d0);
    auto global = reinterpret_cast<void**>(base + 0x5889af0);
    if (!readable(classes, sizeof(void*)) || !readable(record, 0x30) || !readable(global, sizeof(void*)) ||
        *reinterpret_cast<uintptr_t*>(classes) != base + 0x47373c8 ||
        !readable(reinterpret_cast<void*>(base + 0x47373c8), 4 * sizeof(void*)) ||
        (*reinterpret_cast<uintptr_t**>(classes))[3] != base + 0x3ab0b90 ||
        std::memcmp(record + 0x18, kPathIid, sizeof(kPathIid)) != 0 ||
        *reinterpret_cast<const uintptr_t*>(record + 0x28) != base + 0x3b0ed80 ||
        !*global || !readable(*global, sizeof(void*)) || *reinterpret_cast<uintptr_t*>(*global) != base + 0x483c260)
        return reportPath("profile_or_registry_mismatch", result, false, roundTrip) ? 5 : 9;
    if (roundTrip) {
        auto fileSystemGlobal = reinterpret_cast<uintptr_t*>(base + 0x5530450);
        if (!readable(fileSystemGlobal, sizeof(*fileSystemGlobal)) || *fileSystemGlobal != base + 0x59a01b0 ||
            !readable(reinterpret_cast<void*>(*fileSystemGlobal), sizeof(void*)) ||
            *reinterpret_cast<uintptr_t*>(*fileSystemGlobal) != base + 0x48313f0 ||
            !readable(reinterpret_cast<void*>(base + 0x48313f0), 0x230) ||
            reinterpret_cast<const uintptr_t*>(base + 0x48313f0)[0x228 / sizeof(void*)] != base + 0x3b09be0)
            return reportPath("filesystem_profile_mismatch", result, false, true) ? 5 : 9;
    }
    result.profileMatched = true;
    if (!eventThread(base, &result.eventThreadId))
        return reportPath("event_handler_mismatch", result, false, true) ? 5 : 9;
    if (!result.eventThreadId || result.eventThreadId == result.threadId)
        return reportPath("worker_thread_mismatch", result, false, true) ? 5 : 9;
    DWORD attr = GetFileAttributesW(L"E:\\VC\\CubaseMCP\\artifacts\\live-smoke\\First Empty Probe 24.cpr");
    if (attr == INVALID_FILE_ATTRIBUTES || (attr & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)))
        return reportPath("fixture_missing", result, false, true) ? 5 : 9;
    if (roundTrip) guardedPathRoundTrip(&result, base, classes);
    const char* stage = result.exceptionCode ? "host_exception" : !result.callReturned ? "call_incomplete" :
        result.callResult != 0 ? "lookup_failed" : !result.objectPresent ? "object_missing" :
        !result.vtableMatched ? "unexpected_object" : roundTrip && !result.setterReturned ? "setter_incomplete" :
        roundTrip && result.setterResult != 0 ? "setter_failed" : roundTrip && !(result.directoryMatches && result.filenameMatches) ? "path_mismatch" :
        !result.openStarted ? "open_not_started" : !result.openReturned ? "open_return_unknown" : "open_returned_submission_only";
    return reportPath(stage, result, false, roundTrip) ? 0 : 9;
}

DWORD WINAPI pathRoundTripWorker(void*) { return pathProbeWorkerCore(true); }

extern "C" __declspec(dllexport) DWORD WINAPI StartFirstProjectOpen24(void*) {
    if (InterlockedCompareExchange(&started, 1, 0) != 0) return 2;
    HMODULE pinned = nullptr;
    if (!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_PIN,
        reinterpret_cast<LPCWSTR>(&StartFirstProjectOpen24), &pinned)) return 1;
    HANDLE thread = CreateThread(nullptr, 0, pathRoundTripWorker, nullptr, 0, nullptr);
    if (!thread) return 1;
    CloseHandle(thread);
    return 0;
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) module = instance;
    return TRUE;
}
