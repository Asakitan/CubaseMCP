#pragma once
// Existing fixed-build read-only ownership/readiness checks, parameterized by the immutable request.
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
    HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, request.holderPid);
    if (!h) return false;
    FILETIME c{}, e{}, k{}, u{};
    const bool ok = GetProcessTimes(h, &c, &e, &k, &u) &&
        ((static_cast<uint64_t>(c.dwHighDateTime) << 32) | c.dwLowDateTime) == request.holderCreation &&
        WaitForSingleObject(h, 0) == WAIT_TIMEOUT;
    CloseHandle(h); return ok;
}

bool holderJobVerified() {
    if (!holderAlive()) return false;
    HANDLE holder = OpenProcess(PROCESS_DUP_HANDLE | PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, request.holderPid);
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
        ((static_cast<uint64_t>(holderCreation.dwHighDateTime) << 32) | holderCreation.dwLowDateTime) == request.holderCreation &&
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
                if (*reinterpret_cast<uint64_t*>(entry + 8) != request.holderPid || *reinterpret_cast<USHORT*>(entry + 30) != jobType) continue;
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
