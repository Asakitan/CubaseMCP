#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winver.h>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <cwchar>
#include <vector>

// Fixed-build primary create/open/save-as operations for an owned Cubase process.
// No instruction patches, license changes, foreground calls or input synthesis.
namespace {
struct Identity {
    uint32_t version, targetPid;
    uint64_t targetCreation;
    uint32_t holderPid, operation;
    uint64_t holderCreation, deadline, nonce;
    wchar_t projectPath[512], expectedPath[512];
};
static_assert(sizeof(Identity) == 2096, "Identity layout");
Identity request{};
HINSTANCE module = nullptr;
HHOOK hook = nullptr;
HANDLE finished = nullptr;
volatile LONG started = 0, fired = 0;
constexpr UINT message = WM_APP + 0x529;
wchar_t directory[512]{}, folderParent[512]{}, folderName[512]{}, fileName[512]{};
const wchar_t* destination = request.projectPath;
constexpr unsigned char pathIid[16] = {0xa1,0x8e,0xf3,0x0a,0xf2,0x40,0x14,0x4b,0x96,0x5b,0xf9,0x7c,0xa4,0xff,0x94,0xd1};

#include "OwnedHostSupport.h"

uint64_t now() {
    FILETIME value{}; GetSystemTimeAsFileTime(&value);
    return (static_cast<uint64_t>(value.dwHighDateTime) << 32) | value.dwLowDateTime;
}

bool sibling(const wchar_t* name, wchar_t* result, size_t count) {
    const DWORD n = GetModuleFileNameW(module, result, static_cast<DWORD>(count));
    if (!n || n >= count) return false;
    wchar_t* slash = wcsrchr(result, L'\\'); if (!slash) return false;
    *(slash + 1) = 0;
    return wcscat_s(result, count, name) == 0;
}

bool readExact(const wchar_t* name, void* output, DWORD length) {
    wchar_t path[MAX_PATH]{}; if (!sibling(name, path, MAX_PATH)) return false;
    HANDLE file = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
    if (file == INVALID_HANDLE_VALUE) return false;
    BY_HANDLE_FILE_INFORMATION info{}; LARGE_INTEGER size{}; DWORD read = 0;
    const bool ok = GetFileInformationByHandle(file, &info) &&
        !(info.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) &&
        GetFileSizeEx(file, &size) && size.QuadPart == length &&
        ReadFile(file, output, length, &read, nullptr) && read == length;
    CloseHandle(file); return ok;
}

struct Result {
    DWORD thread = 0, eventThread = 0, exception = 0, error = 0, checkpoint = 0, pathStage = 0;
    bool operationStarted = false, operationReturned = false, saveStarted = false, saveReturned = false, succeeded = false;
    unsigned char saveValue = 0;
    uintptr_t document = 0, root = 0;
} result;

bool report(const wchar_t* leaf, const char* stage) {
    wchar_t path[MAX_PATH]{}, temporary[MAX_PATH]{};
    if (!sibling(leaf, path, MAX_PATH) || swprintf_s(temporary, L"%s.tmp", path) < 0) return false;
    HANDLE file = CreateFileW(temporary, GENERIC_WRITE, 0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return false;
    char text[900]{};
    const int n = sprintf_s(text,
        "{\"stage\":\"%s\",\"operation\":%u,\"succeeded\":%s,\"pid\":%lu,\"thread\":%lu,\"eventThread\":%lu,\"exception\":%lu,\"error\":%lu,"
        "\"checkpoint\":%lu,\"pathStage\":%lu,\"operationStarted\":%s,\"operationReturned\":%s,\"saveStarted\":%s,\"saveReturned\":%s,\"saveValue\":%u,"
        "\"document\":\"0x%llx\",\"root\":\"0x%llx\"}\n",
        stage, request.operation, result.succeeded ? "true" : "false", GetCurrentProcessId(), result.thread, result.eventThread, result.exception, result.error, result.checkpoint, result.pathStage,
        result.operationStarted ? "true" : "false", result.operationReturned ? "true" : "false",
        result.saveStarted ? "true" : "false", result.saveReturned ? "true" : "false", result.saveValue,
        static_cast<unsigned long long>(result.document), static_cast<unsigned long long>(result.root));
    DWORD written = 0;
    const bool ok = n > 0 && WriteFile(file, text, static_cast<DWORD>(n), &written, nullptr) &&
        written == static_cast<DWORD>(n) && FlushFileBuffers(file);
    CloseHandle(file);
    return ok && MoveFileExW(temporary, path, MOVEFILE_WRITE_THROUGH);
}

bool profile(uintptr_t base) {
    FILETIME c{}, e{}, k{}, u{};
    if (request.version != 3 || request.operation < 1 || request.operation > 3 || request.targetPid != GetCurrentProcessId() ||
        !GetProcessTimes(GetCurrentProcess(), &c, &e, &k, &u) ||
        ((static_cast<uint64_t>(c.dwHighDateTime) << 32) | c.dwLowDateTime) != request.targetCreation ||
        now() >= request.deadline || !request.nonce) return false;
    wchar_t executable[MAX_PATH]{};
    if (!GetModuleFileNameW(nullptr, executable, MAX_PATH) ||
        _wcsicmp(executable, L"C:\\Program Files\\Steinberg\\Cubase 16\\Cubase 16.exe") || !versionMatches(executable)) return false;
    auto dos = reinterpret_cast<const IMAGE_DOS_HEADER*>(base);
    if (!readable(dos, sizeof(*dos)) || dos->e_magic != IMAGE_DOS_SIGNATURE || dos->e_lfanew < 0 || dos->e_lfanew > 0x100000) return false;
    auto nt = reinterpret_cast<const IMAGE_NT_HEADERS64*>(base + dos->e_lfanew);
    return readable(nt, sizeof(*nt)) && nt->Signature == IMAGE_NT_SIGNATURE && nt->FileHeader.TimeDateStamp == 0x6adf121b &&
        nt->FileHeader.Machine == IMAGE_FILE_MACHINE_AMD64 && nt->OptionalHeader.SizeOfImage > 0x59a0410;
}

void* makePath(uintptr_t base, const wchar_t* input, const wchar_t* parent, const wchar_t* name) {
    result.pathStage = 1;
    auto classes = reinterpret_cast<void*>(base + 0x5523458);
    if (!readable(classes, sizeof(void*)) || *reinterpret_cast<uintptr_t*>(classes) != base + 0x47373c8) return nullptr;
    auto methods = *reinterpret_cast<uintptr_t**>(classes);
    if (methods[3] != base + 0x3ab0b90) return nullptr;
    using Lookup = long (__fastcall*)(void*, const unsigned char*, void**);
    using Setter = long (__fastcall*)(void*, const wchar_t*, int32_t);
    void* object = nullptr;
    result.pathStage = 2;
    if (reinterpret_cast<Lookup>(methods[3])(classes, pathIid, &object) != 0 || !object || !readable(object, 8)) return nullptr;
    auto secondary = *reinterpret_cast<uintptr_t**>(object);
    auto complete = static_cast<unsigned char*>(object) - 0x10;
    result.pathStage = 3;
    if (!readable(complete, 0xe8) || reinterpret_cast<uintptr_t>(secondary) != base + 0x4831d70 ||
        *reinterpret_cast<uintptr_t*>(complete) != base + 0x4831bc0 || secondary[4] != base + 0x3b0f4b0) return nullptr;
    result.pathStage = 4;
    if (reinterpret_cast<Setter>(secondary[4])(object, input, 0) != 0) return nullptr;
    bool wide = false; unsigned length = 0;
    result.pathStage = 5;
    if (!pathFieldMatches(complete, 0xc8, parent, &wide, &length)) return nullptr;
    result.pathStage = 6;
    if (!pathFieldMatches(complete, 0x18, name, &wide, &length)) return nullptr;
    result.pathStage = 7;
    // Retained for this fixed experiment's process lifetime; host retention is not assumed.
    return complete;
}

void* currentDocument(uintptr_t base, void* application, uintptr_t* methods) {
    if (methods[0x1c0 / 8] != base + 0x1d3a220) return nullptr;
    using Current = void* (__fastcall*)(void*);
    void* document = reinterpret_cast<Current>(methods[0x1c0 / 8])(application);
    if (!document || !readable(document, 0x110) || *reinterpret_cast<uintptr_t*>(document) != base + 0x42d96c0) return nullptr;
    const uintptr_t root = *reinterpret_cast<uintptr_t*>(static_cast<unsigned char*>(document) + 0x108);
    const uintptr_t project = *reinterpret_cast<uintptr_t*>(base + 0x59110d0);
    if (!root || !project || !readable(reinterpret_cast<void*>(project + 0xf8), 8) || *reinterpret_cast<uintptr_t*>(project + 0xf8) != root) return nullptr;
    result.document = reinterpret_cast<uintptr_t>(document); result.root = root;
    return document;
}

bool documentPathMatches(void* document, const wchar_t* expected) {
    wchar_t prefix[512]{}, name[512]{};
    if (wcslen(expected) >= 511 || wcscpy_s(prefix, expected) != 0) return false;
    wchar_t* slash = wcsrchr(prefix, L'\\');
    if (!slash || wcscpy_s(name, slash + 1) != 0) return false;
    *(slash + 1) = 0;
    auto methods = *reinterpret_cast<uintptr_t**>(document);
    using Path = void* (__fastcall*)(void*);
    auto path = static_cast<unsigned char*>(reinterpret_cast<Path>(methods[0xe0 / 8])(document));
    bool wide = false; unsigned length = 0;
    return path && readable(path, 0xe8) && pathFieldMatches(path, 0xc8, prefix, &wide, &length) && pathFieldMatches(path, 0x18, name, &wide, &length);
}

void createOnEventThread() {
    result.thread = GetCurrentThreadId();
    const uintptr_t base = reinterpret_cast<uintptr_t>(GetModuleHandleW(nullptr));
    __try {
        result.checkpoint = 1; DWORD event = 0;
        if (!profile(base) || !holderJobVerified() || !backgroundInputDesktop() ||
            (request.operation != 3 && !firstProjectState(base)) || !eventThread(base, &event) || event != result.thread || event != result.eventThread) return;
        result.checkpoint = 2;
        const DWORD attributes = GetFileAttributesW(directory), fileAttributes = GetFileAttributesW(destination);
        if (attributes == INVALID_FILE_ATTRIBUTES || !(attributes & FILE_ATTRIBUTE_DIRECTORY) || (attributes & FILE_ATTRIBUTE_REPARSE_POINT)) return;
        if (request.operation == 2) {
            if (fileAttributes == INVALID_FILE_ATTRIBUTES || (fileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT))) return;
        } else if (fileAttributes != INVALID_FILE_ATTRIBUTES || GetLastError() != ERROR_FILE_NOT_FOUND) return;
        result.checkpoint = 3;
        auto applicationGlobal = reinterpret_cast<uintptr_t*>(base + 0x5972e30);
        if (!readable(applicationGlobal, 8)) return;
        void* application = reinterpret_cast<void*>(*applicationGlobal);
        if (!application || !readable(application, 8)) return;
        auto methods = *reinterpret_cast<uintptr_t**>(application);
        if (reinterpret_cast<uintptr_t>(methods) != base + 0x45d07a0 || methods[0x1c8 / 8] != base + 0x1d57900) return;
        result.checkpoint = 4;
        void* folder = makePath(base, directory, folderParent, folderName);
        if (!folder) return;
        result.checkpoint = 5;
        void* file = makePath(base, destination, directory, fileName);
        if (!file || now() >= request.deadline) return;
        void* document = nullptr;
        if (request.operation == 3) {
            document = currentDocument(base, application, methods);
            if (!document || request.expectedPath[511] != 0 || !documentPathMatches(document, request.expectedPath)) return;
        }
        result.checkpoint = 6;
        if (!report(L"operation-start.json", "event_thread_admitted")) return;
        result.operationStarted = true;
        if (request.operation == 1) {
            using Create = void* (__fastcall*)(void*, void*, unsigned char, unsigned char);
            document = reinterpret_cast<Create>(base + 0x1d50920)(application, folder, 1, 0);
            if (!document) return;
        } else if (request.operation == 2) {
            auto host = reinterpret_cast<void*>(base + 0x55233f8);
            auto hostMethods = *reinterpret_cast<uintptr_t**>(host);
            if (reinterpret_cast<uintptr_t>(hostMethods) != base + 0x4737230 || hostMethods[3] != base + 0x3751d40) return;
            using Open = long (__fastcall*)(void*, void*, void*);
            const long opened = reinterpret_cast<Open>(hostMethods[3])(host, static_cast<unsigned char*>(file) + 0x10, static_cast<unsigned char*>(folder) + 0x10);
            if (opened != 0) return;
        }
        result.operationReturned = true; result.checkpoint = 7;
        document = currentDocument(base, application, methods);
        if (!document || now() >= request.deadline) return;
        result.checkpoint = 8;
        if (request.operation != 2) {
            auto documentMethods = *reinterpret_cast<uintptr_t**>(document);
            if (documentMethods[0xd8 / 8] != base + 0x1cfee50) return;
            // Match the native Save dispatcher: bind the document's path first,
            // then save through that bound path. A third-argument file alone
            // writes a copy without establishing the document identity.
            using BindPath = void (__fastcall*)(void*, void*);
            reinterpret_cast<BindPath>(documentMethods[0xd8 / 8])(document, file);
            if (!documentPathMatches(document, destination)) return;
            using Save = unsigned char (__fastcall*)(void*, void*, void*);
            result.saveStarted = true;
            result.saveValue = reinterpret_cast<Save>(methods[0x1c8 / 8])(application, document, nullptr);
            result.saveReturned = true;
            if (!result.saveValue) return;
        }
        if (!documentPathMatches(document, destination)) return;
        result.checkpoint = 9; result.succeeded = true;
    } __except (EXCEPTION_EXECUTE_HANDLER) { result.exception = GetExceptionCode(); }
}

LRESULT CALLBACK onMessage(int code, WPARAM removed, LPARAM argument) {
    if (code >= 0 && removed == PM_REMOVE) {
        auto item = reinterpret_cast<MSG*>(argument);
        if (item && item->message == message && item->wParam == static_cast<WPARAM>(request.nonce) &&
            InterlockedCompareExchange(&fired, 1, 0) == 0) {
            item->message = WM_NULL; item->wParam = 0; item->lParam = 0;
            if (hook) { UnhookWindowsHookEx(hook); hook = nullptr; }
            createOnEventThread();
            report(L"create-result.json", result.exception ? "host_exception" : result.succeeded ? "operation_succeeded" :
                result.operationStarted ? "creation_incomplete" : "not_started");
            SetEvent(finished);
        }
    }
    return CallNextHookEx(nullptr, code, removed, argument);
}

bool preparePaths() {
    if (request.projectPath[511] != 0 || wcslen(destination) < 5 || destination[1] != L':' || destination[2] != L'\\') return false;
    if (wcscpy_s(directory, destination) != 0) return false;
    wchar_t* slash = wcsrchr(directory, L'\\');
    if (!slash || slash <= directory + 2 || wcscpy_s(fileName, slash + 1) != 0 || fileName[0] == 0) return false;
    *(slash + 1) = 0;
    if (wcscpy_s(folderParent, directory) != 0) return false;
    const size_t n = wcslen(folderParent); folderParent[n - 1] = 0;
    slash = wcsrchr(folderParent, L'\\');
    if (!slash || wcscpy_s(folderName, slash + 1) != 0 || folderName[0] == 0) return false;
    *(slash + 1) = 0;
    return true;
}

DWORD WINAPI worker(void*) {
    if (!readExact(L"request.bin", &request, sizeof(request)) || !preparePaths()) { report(L"create-result.json", "request_invalid"); return 1; }
    const uintptr_t base = reinterpret_cast<uintptr_t>(GetModuleHandleW(nullptr));
    if (!profile(base) || !eventThread(base, &result.eventThread) || (request.operation != 3 && !firstProjectState(base)) ||
        !holderJobVerified() || !backgroundInputDesktop()) {
        report(L"create-result.json", "preflight_failed"); return 1;
    }
    finished = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (!finished) { result.error = GetLastError(); report(L"create-result.json", "event_failed"); return 1; }
    hook = SetWindowsHookExW(WH_GETMESSAGE, onMessage, module, result.eventThread);
    if (!hook) { result.error = GetLastError(); report(L"create-result.json", "hook_failed"); CloseHandle(finished); return 1; }
    if (!PostThreadMessageW(result.eventThread, message, static_cast<WPARAM>(request.nonce), 0)) {
        result.error = GetLastError(); UnhookWindowsHookEx(hook); hook = nullptr;
        report(L"create-result.json", "post_failed"); CloseHandle(finished); return 1;
    }
    if (WaitForSingleObject(finished, 20000) == WAIT_TIMEOUT) {
        if (InterlockedCompareExchange(&fired, 2, 0) == 0) {
            UnhookWindowsHookEx(hook); hook = nullptr; report(L"create-result.json", "dispatch_expired_not_started");
            CloseHandle(finished);
        }
        // If host code is executing, retain the event/module for the eventual callback.
        return 2;
    }
    CloseHandle(finished); finished = nullptr; return 0;
}
}

extern "C" __declspec(dllexport) DWORD WINAPI StartProjectCreate(void*) {
    if (InterlockedCompareExchange(&started, 1, 0) != 0) return 2;
    HMODULE pinned = nullptr;
    if (!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_PIN,
        reinterpret_cast<LPCWSTR>(&StartProjectCreate), &pinned)) return 1;
    HANDLE thread = CreateThread(nullptr, 0, worker, nullptr, 0, nullptr);
    if (!thread) return 1;
    CloseHandle(thread); return 0;
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) module = instance;
    return TRUE;
}
