#pragma once

struct PluginUnloadOptions {
    uint32_t version, reserved;
    uint64_t root;
    int64_t objectId;
};
static_assert(sizeof(PluginUnloadOptions) == 24, "Plugin unload options layout");

bool unloadProjectPlugin(uintptr_t base, void* document) {
    result.operationStarted = false;
    PluginUnloadOptions options{};
    if (!readExact(L"plugin-unload.bin", &options, sizeof(options)) || options.version != 1 ||
        options.reserved || options.root != result.root || options.objectId <= 0 || options.objectId > 0x7fffffff) return false;
    try {
        void* service = hostFunction<void* (__fastcall*)(void*)>(base, 0x2458760)(document);
        if (!hostObject(base, service, 0xa0)) return false;
        void* adapter = nullptr;
        hostFunction<void* (__fastcall*)(void*, void**, void*, void*, int64_t*)>(base, 0x2459c70)
            (service, &adapter, nullptr, document, &options.objectId);
        if (!hostObject(base, adapter, 0x28)) return false;
        HostReference adapterOwner(adapter);
        void* slot = *reinterpret_cast<void**>(static_cast<unsigned char*>(adapter) + 0x20);
        if (!hostObject(base, slot)) return false;
        auto methods = *reinterpret_cast<uintptr_t**>(slot);
        if (!reinterpret_cast<unsigned char (__fastcall*)(void*, const void*, unsigned char)>(methods[7])
            (slot, reinterpret_cast<const void*>(base + 0x41a9cc8), 1)) return false;
        const std::string type = hostNarrow(reinterpret_cast<const char* (__fastcall*)(void*)>(methods[6])(slot));
        alignas(16) unsigned char change[48]{};
        hostFunction<void* (__fastcall*)(void*)>(base, 0x3b93ff0)(change);
        *reinterpret_cast<uint32_t*>(change + 0x18) = 0x01010001;
        if (now() >= request.deadline) return false;
        result.operationStarted = true;
        void* returned = reinterpret_cast<void* (__fastcall*)(void*, void*)>(methods[0x450 / 8])(slot, change);
        result.operationReturned = true;
        auto documentMethods = *reinterpret_cast<uintptr_t**>(document);
        reinterpret_cast<void (__fastcall*)(void*)>(documentMethods[0x110 / 8])(document);
        std::ostringstream text;
        text << "{\"root\":\"0x" << std::hex << result.root << "\",\"returnedAddress\":\"0x"
             << reinterpret_cast<uintptr_t>(returned) << std::dec << "\",\"objectId\":" << options.objectId
             << ",\"nativeType\":" << jsonString(type) << '}';
        return writeModelJson(text.str());
    } catch (const std::exception& error) {
        result.error = ERROR_INVALID_DATA;
        writeModelJson("{\"error\":" + jsonString(error.what()) + "}");
        return false;
    }
}