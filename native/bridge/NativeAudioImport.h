#pragma once
// Recovered from PArrangeController's import branch (0x1d1e0c0), after file selection.
struct AudioImportOptions {
    void* trackMap;
    unsigned char flags[8];
    const char* descriptorClass;
    uint64_t reserved[2];
};
static_assert(sizeof(AudioImportOptions) == 0x28, "Host audio import option layout");

bool importAudioFile(uintptr_t base, void* file, void* document) {
    result.operationStarted = false;
    result.importStage = 11;
    auto manager = *reinterpret_cast<void**>(base + 0x5973480);
    if (!hostObject(base, manager, 0x108) ||
        *reinterpret_cast<uintptr_t*>(static_cast<unsigned char*>(manager) + 0xe0) != base + 0x4192350) return false;
    uintptr_t node = *reinterpret_cast<uintptr_t*>(static_cast<unsigned char*>(manager) + 0xf8);
    uintptr_t visited[128]{};
    unsigned visitedCount = 0;
    void* controller = nullptr;
    while (node) {
        if (visitedCount == 128 || !readable(reinterpret_cast<void*>(node), 16)) return false;
        for (unsigned i = 0; i < visitedCount; ++i) if (visited[i] == node) return false;
        visited[visitedCount++] = node;
        void* window = *reinterpret_cast<void**>(node + 8);
        if (hostObject(base, window, 0x50) && *reinterpret_cast<uintptr_t*>(window) == base + 0x41ecf60) {
            // PArrangeController is a child of the window's multi-view controller, not a window.
            void* candidate = hostFunction<void* (__fastcall*)(void*)>(base, 0x1d18510)(window);
            if (hostObject(base, candidate, 0x1b0) &&
                *reinterpret_cast<void**>(static_cast<unsigned char*>(candidate) + 0x1a8) == document) {
                if (controller && controller != candidate) return false;
                controller = candidate;
            }
        }
        node = *reinterpret_cast<uintptr_t*>(node);
    }
    result.nativeController = reinterpret_cast<uintptr_t>(controller);
    if (!hostObject(base, controller, 0x1b0)) return false;
    auto methods = *reinterpret_cast<uintptr_t**>(controller);
    if (methods[0xb0 / 8] != base + 0x1d1e0c0 ||
        *reinterpret_cast<void**>(static_cast<unsigned char*>(controller) + 0x1a8) != document) return false;
    result.importStage = 12;
    void* root = reinterpret_cast<void*>(result.root);
    if (!hostObject(base, root, 0x180) || *reinterpret_cast<uintptr_t*>(root) != base + 0x4471c40) return false;
    void* pool = hostFunction<void* (__fastcall*)(void*)>(base, 0x2758900)(root);
    if (!hostObject(base, pool, 0x100)) return false;
    // Verify the same arranger view that the host will address before importing any media.
    void* trackView = hostFunction<void* (__fastcall*)(void*)>(base, 0x1d19150)(controller);
    if (!hostObject(base, trackView)) return false;

    alignas(16) unsigned char paths[0x28]{};
    hostFunction<void* (__fastcall*)(void*)>(base, 0x3a873d0)(paths);
    *reinterpret_cast<uintptr_t*>(paths) = base + 0x4192350;
    *reinterpret_cast<uint16_t*>(paths + 0x14) = 2;
    hostFunction<void (__fastcall*)(void*, void*)>(base, 0x3a87ff0)(paths, file);
    uintptr_t clips[3]{};
    AudioImportOptions options{};
    options.flags[6] = 5;
    options.descriptorClass = reinterpret_cast<const char*>(base + 0x4191358); // PAudioClip
    bool imported = false;
    __try {
        result.importStage = 13;
        if (now() >= request.deadline) return false;
        result.operationStarted = true;
        result.importStarted = true;
        const unsigned char accepted = hostFunction<unsigned char (__fastcall*)(void*, void*, unsigned char, void*, void*)>(base, 0x27fb960)
            (pool, paths, 1, clips, &options);
        if (!accepted || clips[1] < clips[0] || clips[1] - clips[0] > 64 * 0x18 ||
            !readable(reinterpret_cast<void*>(clips[0]), clips[1] - clips[0])) return false;
        void* first = hostFunction<void* (__fastcall*)(void*)>(base, 0x27e62e0)(clips);
        if (!hostObject(base, first)) return false;
        result.audioClips = static_cast<DWORD>((clips[1] - clips[0]) / 0x18);
        result.importStage = 14;
        // A single explicit source needs no lineup prompt. These are command options, not global preferences.
        options.flags[3] = 0; // AskLineUpFiles
        options.flags[4] = 0; // LineUpFiles
        hostFunction<void (__fastcall*)(void*, void*, unsigned char, void*)>(base, 0x1d1b840)(controller, clips, 0, &options);
        result.importReturned = true;
        result.importValue = 1;
        result.importStage = 15;
        imported = true;
    } __finally {
        hostFunction<void (__fastcall*)(void*)>(base, 0x1a624e0)(clips);
        hostFunction<void (__fastcall*)(void*)>(base, 0x3a883c0)(paths);
    }
    return imported;
}