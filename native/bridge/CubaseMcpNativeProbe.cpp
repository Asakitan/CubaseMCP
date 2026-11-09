#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winver.h>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <cwchar>
#include <vector>
#include <string>
#include <new>
#include "ProjectHostAbi.h"

// Build-specific, one-shot diagnostic. DllMain performs no host or file work.
// The callback is the observed direct-call subset, not a vendor interface declaration.
namespace {
constexpr uintptr_t kContainer = 0x599cba0;
constexpr uintptr_t kHost = 0x58d1780;
constexpr uintptr_t kContainerVtable = 0x48274f0;
constexpr uintptr_t kHostVtable = 0x4305018;
constexpr uintptr_t kDispatcher = 0x5890930;
constexpr DWORD kTimestamp = 0x6adf121b;
const unsigned char kIid[16] = {0xf1,0x79,0x58,0x57,0x70,0xb2,0xbf,0x48,0x82,0x1d,0xbe,0x11,0x9c,0xd3,0x83,0x5f};
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

bool report(const char* stage, long queryResult, bool profileMatched, bool hostMatch,
            bool submitted = false, uint64_t requestId = 0, uint64_t callbackId = 0,
            DWORD callbackThread = 0, int requestReturn = 0, const char* response = nullptr) {
    wchar_t finalPath[MAX_PATH];
    wchar_t tempPath[MAX_PATH];
    const DWORD pid = GetCurrentProcessId();
    wchar_t directory[MAX_PATH];
    DWORD lengthPath = GetModuleFileNameW(module, directory, MAX_PATH);
    if (!lengthPath || lengthPath >= MAX_PATH) return false;
    wchar_t* slash = wcsrchr(directory, L'\\');
    if (!slash) return false;
    *slash = L'\0';
    if (swprintf_s(finalPath, L"%s\\result-%lu.json", directory, pid) < 0 ||
        swprintf_s(tempPath, L"%s\\result-%lu.tmp", directory, pid) < 0) return false;
    char header[768];
    const int length = sprintf_s(header,
        "{\"processId\":%lu,\"executable\":%s,\"profileMatched\":%s,"
        "\"stage\":\"%s\",\"queryResult\":%ld,\"hostMatch\":%s,"
        "\"requestSubmitted\":%s,\"requestId\":%llu,\"callbackId\":%llu,\"callbackThreadId\":%lu,\"requestReturn\":%d",
        pid, profileMatched ? "\"Cubase 16.exe\"" : "null", profileMatched ? "true" : "false", stage,
        queryResult, hostMatch ? "true" : "false",
        submitted ? "true" : "false", static_cast<unsigned long long>(requestId),
        static_cast<unsigned long long>(callbackId), callbackThread, requestReturn);
    if (length <= 0) return false;
    std::string json(header, static_cast<size_t>(length));
    json += response ? ",\"error\":null" : ",\"error\":\"" + std::string(stage) + "\"";
    if (response) {
        json += ",\"responseText\":\"";
        for (const unsigned char* p = reinterpret_cast<const unsigned char*>(response); *p; ++p) {
            if (*p == '"' || *p == '\\') { json += '\\'; json += static_cast<char>(*p); }
            else if (*p < 0x20) { char escaped[7]; sprintf_s(escaped, "\\u%04x", static_cast<unsigned>(*p)); json += escaped; }
            else json += static_cast<char>(*p);
        }
        json += '"';
    }
    json += "}\n";
    HANDLE file = CreateFileW(tempPath, GENERIC_WRITE, 0, nullptr, CREATE_NEW,
        FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return false;
    DWORD written = 0;
    const bool ok = WriteFile(file, json.data(), static_cast<DWORD>(json.size()), &written, nullptr) &&
        written == static_cast<DWORD>(json.size()) && FlushFileBuffers(file);
    CloseHandle(file);
    if (!ok || !MoveFileExW(tempPath, finalPath, MOVEFILE_WRITE_THROUGH)) {
        DeleteFileW(tempPath);
        return false;
    }
    return true;
}

struct PathProbeResult {
    bool profileMatched;
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
    const wchar_t* kind = roundTrip ? (startRecord ? L"roundtrip-start" : L"roundtrip-result") :
        (startRecord ? L"path-start" : L"path-result");
    if (swprintf_s(finalPath, L"%s\\%s-%lu.json", directory, kind, pid) < 0 ||
        swprintf_s(tempPath, L"%s\\%s-%lu.tmp", directory, kind, pid) < 0) return false;
    char json[768];
    const int count = sprintf_s(json,
        "{\"processId\":%lu,\"stage\":\"%s\",\"threadId\":%lu,\"profileMatched\":%s,"
        "\"callStarted\":%s,\"callReturned\":%s,\"callResult\":%ld,\"objectPresent\":%s,"
        "\"vtableMatched\":%s,\"releaseAttempted\":%s,\"setterAttempted\":%s,"
        "\"setterReturned\":%s,\"setterResult\":%ld,\"directoryWide\":%s,\"filenameWide\":%s,"
        "\"directoryLength\":%u,\"filenameLength\":%u,\"directoryMatches\":%s,\"filenameMatches\":%s,\"exceptionCode\":%lu}\n",
        pid, stage, result.threadId, result.profileMatched ? "true" : "false",
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

// Fixed fixture only: mutate one temporary path object, inspect its own fields,
// and release it. No project path, host-open method, UI or file operation is requested.
void guardedPathRoundTrip(PathProbeResult* result, uintptr_t base, void* classes) {
    __try {
        using Lookup = long (__fastcall*)(void*, const unsigned char*, void**);
        using Setter = long (__fastcall*)(void*, const wchar_t*, int32_t);
        using Release = unsigned long (__fastcall*)(void*);
        const wchar_t* input = L"E:\\VC\\CubaseMCP\\artifacts\\live-smoke\\\u8def\u5f84\u6d4b\u8bd5.cpr";
        const wchar_t* directory = L"E:\\VC\\CubaseMCP\\artifacts\\live-smoke\\";
        const wchar_t* filename = L"\u8def\u5f84\u6d4b\u8bd5.cpr";
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
        result->releaseAttempted = true;
        reinterpret_cast<Release>(objectVtable[2])(object);
    } __except (EXCEPTION_EXECUTE_HANDLER) { result->exceptionCode = GetExceptionCode(); }
}

// One fixed service lookup; only a newly constructed path object may be released.
// No path setter, project method, message dispatch or UI operation is performed.
void guardedPathLookup(PathProbeResult* result, uintptr_t base, void* classes) {
    __try {
        using Lookup = long (__fastcall*)(void*, const unsigned char*, void**);
        using Release = unsigned long (__fastcall*)(void*);
        auto vtable = *reinterpret_cast<void***>(classes);
        auto lookup = reinterpret_cast<Lookup>(vtable[3]);
        void* object = nullptr;
        result->callStarted = true;
        result->callResult = lookup(classes, kPathIid, &object);
        result->callReturned = true;
        result->objectPresent = object != nullptr;
        if (object && readable(object, sizeof(void*))) {
            auto objectVtable = *reinterpret_cast<uintptr_t**>(object);
            result->vtableMatched = reinterpret_cast<uintptr_t>(objectVtable) == base + 0x4831d70 &&
                readable(objectVtable, 3 * sizeof(void*)) && objectVtable[2] == base + 0x15c31c8;
            if (result->vtableMatched) {
                result->releaseAttempted = true;
                reinterpret_cast<Release>(objectVtable[2])(object);
            }
        }
    } __except (EXCEPTION_EXECUTE_HANDLER) { result->exceptionCode = GetExceptionCode(); }
}

struct Callback;
struct CallbackVtable {
    long (*query)(Callback*, const void*, void**);
    void (*retain)(Callback*);
    void (*release)(Callback*);
    void (*begin)(Callback*, uint64_t);
    void (*result)(Callback*, uint64_t, const char* const*);
    void (*error)(Callback*, uint64_t);
};
struct Callback {
    const CallbackVtable* vtable;
    volatile LONG refs;
    volatile LONG terminal;
    HANDLE event;
    uint64_t id;
    DWORD thread;
    int outcome; // 1=response, 2=host error, 3=invalid or oversized response
    char data[1024 * 1024 + 1];
};
long callbackQuery(Callback*, const void*, void** out) {
    if (out) *out = nullptr;
    return static_cast<long>(0x80004002UL);
}
void callbackRetain(Callback* c) { InterlockedIncrement(&c->refs); }
void callbackRelease(Callback* c) {
    if (InterlockedDecrement(&c->refs) == 0) { CloseHandle(c->event); delete c; }
}
void callbackBegin(Callback*, uint64_t) {}
// Copies while the response remains borrowed; a bad pointer or missing terminator fails closed.
bool copyResponse(char* dest, const char* const* source) {
    __try {
        if (!source || !*source) return false;
        for (size_t i = 0; i <= 1024 * 1024; ++i) {
            const char ch = (*source)[i];
            if (!ch) { dest[i] = 0; return true; }
            if (i == 1024 * 1024) return false;
            dest[i] = ch;
        }
    } __except (EXCEPTION_EXECUTE_HANDLER) { return false; }
    return false;
}
void callbackResult(Callback* c, uint64_t id, const char* const* source) {
    if (InterlockedCompareExchange(&c->terminal, 1, 0) != 0) return;
    c->id = id; c->thread = GetCurrentThreadId();
    c->outcome = copyResponse(c->data, source) ? 1 : 3;
    SetEvent(c->event);
}
void callbackError(Callback* c, uint64_t id) {
    if (InterlockedCompareExchange(&c->terminal, 1, 0) != 0) return;
    c->id = id; c->thread = GetCurrentThreadId(); c->outcome = 2;
    SetEvent(c->event);
}
const CallbackVtable kCallbackVtable = {callbackQuery, callbackRetain, callbackRelease,
    callbackBegin, callbackResult, callbackError};
}

DWORD WINAPI probeWorker(void*) {
    wchar_t path[MAX_PATH];
    const DWORD n = GetModuleFileNameW(nullptr, path, MAX_PATH);
    const wchar_t* name = n ? wcsrchr(path, L'\\') : nullptr;
    if (!n || n >= MAX_PATH || !name || _wcsicmp(name + 1, L"Cubase 16.exe") != 0 || !versionMatches(path)) {
        return report("host_version_mismatch", -1, false, false) ? 3 : 9;
    }
    const auto base = reinterpret_cast<uintptr_t>(GetModuleHandleW(nullptr));
    auto dos = reinterpret_cast<const IMAGE_DOS_HEADER*>(base);
    if (!readable(dos, sizeof(*dos)) || dos->e_magic != IMAGE_DOS_SIGNATURE || dos->e_lfanew < 0 || dos->e_lfanew > 0x100000) {
        return report("invalid_image", -1, false, false) ? 4 : 9;
    }
    auto nt = reinterpret_cast<const IMAGE_NT_HEADERS64*>(base + dos->e_lfanew);
    if (!readable(nt, sizeof(*nt)) || nt->Signature != IMAGE_NT_SIGNATURE ||
        nt->FileHeader.Machine != IMAGE_FILE_MACHINE_AMD64 || nt->FileHeader.TimeDateStamp != kTimestamp ||
        nt->OptionalHeader.Magic != IMAGE_NT_OPTIONAL_HDR64_MAGIC || nt->OptionalHeader.SizeOfImage <= kContainer + sizeof(void*)) {
        return report("build_mismatch", -1, false, false) ? 4 : 9;
    }
    auto container = reinterpret_cast<void*>(base + kContainer);
    auto host = reinterpret_cast<void*>(base + kHost);
    if (!readable(container, sizeof(void*)) || !readable(host, sizeof(void*)) ||
        *reinterpret_cast<uintptr_t*>(container) != base + kContainerVtable ||
        *reinterpret_cast<uintptr_t*>(host) != base + kHostVtable ||
        !readable(reinterpret_cast<void*>(base + kContainerVtable), sizeof(void*)) ||
        !readable(reinterpret_cast<void*>(base + kHostVtable), 4 * sizeof(void*))) {
        return report("vtable_mismatch", -1, false, false) ? 5 : 9;
    }
    using Query = long (__fastcall*)(void*, const unsigned char*, void**);
    using Release = unsigned long (__fastcall*)(void*);
    auto query = reinterpret_cast<Query>((*reinterpret_cast<void***>(container))[0]);
    void* result = nullptr;
    long rc = query(container, kIid, &result);
    const bool match = rc == 0 && result == host;
    if (!match) return report("query_mismatch", rc, true, false) ? 6 : 9;
    auto release = reinterpret_cast<Release>((*reinterpret_cast<void***>(result))[2]);
    if (!readable(reinterpret_cast<void*>(base + kDispatcher), sizeof(void*)) ||
        !*reinterpret_cast<void**>(base + kDispatcher)) {
        release(result);
        return report("dispatcher_absent", rc, true, true) ? 7 : 9;
    }
    Callback* callback = new (std::nothrow) Callback{};
    if (!callback) { release(result); return report("allocation_failed", rc, true, true) ? 8 : 9; }
    callback->vtable = &kCallbackVtable; callback->refs = 1;
    callback->event = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (!callback->event) { delete callback; release(result); return report("event_failed", rc, true, true) ? 8 : 9; }
    const char* payload = "{\"payload_version\":\"2026.10.01\",\"command\":\"GetMusicalTrack\",\"type\":\"Tempo\"}";
    uint64_t requestId = 0;
    using Request = cubase_project_host_observed::RequestSlot;
    auto request = reinterpret_cast<Request>((*reinterpret_cast<void***>(result))[3]);
    int resultCode = request(result, payload,
        reinterpret_cast<cubase_project_host_observed::RequestCallback*>(callback), requestId);
    DWORD wait = WaitForSingleObject(callback->event, 20000);
    const bool complete = wait == WAIT_OBJECT_0;
    const bool correlated = complete && requestId == callback->id;
    const char* stage = !complete ? (wait == WAIT_TIMEOUT ? "timeout" : "wait_failed") :
        !correlated ? "callback_id_mismatch" : callback->outcome == 1 ? "response" :
        callback->outcome == 2 ? "host_error_callback" : "invalid_response";
    const char* response = correlated && callback->outcome == 1 ? callback->data : nullptr;
    bool written = report(stage, rc, true, true, true, requestId,
        complete ? callback->id : 0, complete ? callback->thread : 0, resultCode, response);
    callbackRelease(callback);
    release(result);
    return written ? 0 : 9;
}

DWORD pathProbeWorkerCore(bool roundTrip) {
    PathProbeResult result{};
    result.threadId = GetCurrentThreadId();
    result.callResult = -1;
    result.setterResult = -1;
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
    if (!reportPath("started", result, true, roundTrip)) return 9;
    if (roundTrip) guardedPathRoundTrip(&result, base, classes);
    else guardedPathLookup(&result, base, classes);
    const char* stage = result.exceptionCode ? "host_exception" : !result.callReturned ? "call_incomplete" :
        result.callResult != 0 ? "lookup_failed" : !result.objectPresent ? "object_missing" :
        !result.vtableMatched ? "unexpected_object" : roundTrip && !result.setterReturned ? "setter_incomplete" :
        roundTrip && result.setterResult != 0 ? "setter_failed" : roundTrip && !(result.directoryMatches && result.filenameMatches) ? "path_mismatch" :
        !result.releaseAttempted ? "release_not_attempted" : roundTrip ? "roundtrip_matched" : "release_returned";
    return reportPath(stage, result, false, roundTrip) ? 0 : 9;
}

DWORD WINAPI pathProbeWorker(void*) { return pathProbeWorkerCore(false); }
DWORD WINAPI pathRoundTripWorker(void*) { return pathProbeWorkerCore(true); }

extern "C" __declspec(dllexport) DWORD WINAPI StartProbe(void*) {
    if (InterlockedCompareExchange(&started, 1, 0) != 0) return 2;
    HMODULE pinned = nullptr;
    if (!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_PIN,
        reinterpret_cast<LPCWSTR>(&StartProbe), &pinned)) return 1;
    HANDLE thread = CreateThread(nullptr, 0, probeWorker, nullptr, 0, nullptr);
    if (!thread) return 1;
    CloseHandle(thread);
    return 0; // Worker launched, not project success.
}

extern "C" __declspec(dllexport) DWORD WINAPI StartPathProbe(void*) {
    if (InterlockedCompareExchange(&started, 1, 0) != 0) return 2;
    HMODULE pinned = nullptr;
    if (!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_PIN,
        reinterpret_cast<LPCWSTR>(&StartPathProbe), &pinned)) return 1;
    HANDLE thread = CreateThread(nullptr, 0, pathProbeWorker, nullptr, 0, nullptr);
    if (!thread) return 1;
    CloseHandle(thread);
    return 0;
}

extern "C" __declspec(dllexport) DWORD WINAPI StartPathRoundTripProbe(void*) {
    if (InterlockedCompareExchange(&started, 1, 0) != 0) return 2;
    HMODULE pinned = nullptr;
    if (!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_PIN,
        reinterpret_cast<LPCWSTR>(&StartPathRoundTripProbe), &pinned)) return 1;
    HANDLE thread = CreateThread(nullptr, 0, pathRoundTripWorker, nullptr, 0, nullptr);
    if (!thread) return 1;
    CloseHandle(thread);
    return 0;
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) module = instance;
    return TRUE;
}
