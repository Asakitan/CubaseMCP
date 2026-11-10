#pragma once

struct RoutingOptions {
    uint32_t version, mode;
    uint64_t root;
    int64_t objectId;
    uint32_t tag, reserved;
    int32_t expected, target;
    wchar_t targetName[256];
};
static_assert(sizeof(RoutingOptions) == 552, "Routing options layout");

struct RoutingChoice {
    int32_t id;
    std::string name, path;
    bool enabled;
};

std::string routingText(const void* value) {
    const auto bytes = static_cast<const unsigned char*>(value);
    if (!readable(bytes, 24)) throw std::runtime_error("Unreadable routing label");
    const uint32_t flags = *reinterpret_cast<const uint32_t*>(bytes + 16);
    const uint32_t length = flags & 0x3fffffffU;
    const void* text = *reinterpret_cast<const void* const*>(bytes + 8);
    if (!length) return {};
    if (!text || length > 4096 || !readable(text, static_cast<size_t>(length) * ((flags & 0x40000000U) ? 2 : 1)))
        throw std::runtime_error("Invalid routing label");
    if (!(flags & 0x40000000U)) return std::string(static_cast<const char*>(text), length);
    const int count = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, static_cast<const wchar_t*>(text),
        static_cast<int>(length), nullptr, 0, nullptr, nullptr);
    if (count <= 0) throw std::runtime_error("Invalid routing Unicode");
    std::string output(static_cast<size_t>(count), '\0');
    WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, static_cast<const wchar_t*>(text),
        static_cast<int>(length), &output[0], count, nullptr, nullptr);
    return output;
}

void routingChoices(uintptr_t base, void* menu, const std::string& parent, uint32_t depth, std::vector<RoutingChoice>& output) {
    if (depth > 8 || !hostObject(base, menu, 0xe8)) throw std::runtime_error("Invalid routing menu");
    void* state = *reinterpret_cast<void**>(static_cast<unsigned char*>(menu) + 0xe0);
    if (!state || !readable(state, 0x30)) throw std::runtime_error("Invalid routing menu state");
    void* items = *reinterpret_cast<void**>(static_cast<unsigned char*>(state) + 0x28);
    if (!items || !readable(items, 0x78)) throw std::runtime_error("Invalid routing items");
    const uint64_t count = *reinterpret_cast<uint64_t*>(static_cast<unsigned char*>(items) + 0x70) / 8;
    if (count > 2048) throw std::runtime_error("Routing choice bound exceeded");
    for (uint32_t index = 0; index < count; ++index) {
        void* item = nullptr;
        hostFunction<void* (__fastcall*)(void*, void**, uint32_t)>(base, 0x3663c60)(items, &item, index);
        if (!hostObject(base, item, 0xe0)) throw std::runtime_error("Invalid routing item");
        HostReference owner(item);
        const auto bytes = static_cast<unsigned char*>(item);
        const auto methods = *reinterpret_cast<uintptr_t**>(item);
        const std::string name = routingText(bytes + 0x20);
        const std::string path = parent.empty() ? name : parent + "/" + name;
        void* child = reinterpret_cast<void* (__fastcall*)(void*)>(methods[0xd8 / 8])(item);
        if (child) { routingChoices(base, child, path, depth + 1, output); continue; }
        const int32_t id = *reinterpret_cast<int32_t*>(bytes + 0xd8);
        const uint32_t flags = *reinterpret_cast<uint32_t*>(bytes + 0x50);
        const bool separator = reinterpret_cast<unsigned char (__fastcall*)(void*)>(methods[0xd0 / 8])(item) != 0;
        if (separator || name.empty() || id < 0 || id >= 10000) continue;
        if (output.size() >= 2048) throw std::runtime_error("Routing choice bound exceeded");
        output.push_back({id, name, path, (flags & 1) != 0 && (flags & 0x18) == 0});
    }
}

bool projectRouting(uintptr_t base, void* document) {
    result.operationStarted = false;
    RoutingOptions options{};
    if (!readExact(L"routing.bin", &options, sizeof(options)) || options.version != 2 || options.mode > 1 ||
        options.reserved || options.root != result.root || options.objectId <= 0 || options.objectId > 0x7fffffff ||
        (options.tag != 4099 && options.tag != 4101 && options.tag != 4102 && options.tag != 4007 && options.tag != 4008)) return false;
    if (options.mode == 1 && (options.expected < -1 || options.target < 0 || options.target >= 10000 ||
        !options.targetName[0] || options.targetName[255])) return false;
    try {
        void* service = hostFunction<void* (__fastcall*)(void*)>(base, 0x2458760)(document);
        if (!hostObject(base, service, 0xa0)) return false;
        void* parameter = hostFunction<void* (__fastcall*)(void*, void*, void*, int64_t*, uint32_t*)>(base, 0x2454050)
            (service, nullptr, document, &options.objectId, &options.tag);
        if (!hostObject(base, parameter, 0xb0)) return false;
        auto methods = *reinterpret_cast<uintptr_t**>(parameter);
        const std::string type = hostNarrow(reinterpret_cast<const char* (__fastcall*)(void*)>(methods[6])(parameter));
        if (type != "VSTBusValue" || methods[0x230 / 8] != base + 0x2c20be0)
            throw std::runtime_error("Unsupported routing parameter type: " + type);
        void* menu = *reinterpret_cast<void**>(static_cast<unsigned char*>(parameter) + 0x58);
        if (!hostObject(base, menu, 0xe8)) return false;
        hostFunction<void (__fastcall*)(void*)>(base, 0x2c20be0)(parameter);
        std::vector<RoutingChoice> choices;
        routingChoices(base, menu, {}, 0, choices);
        const int32_t before = *reinterpret_cast<int32_t*>(static_cast<unsigned char*>(parameter) + 0x40);
        if (options.mode == 1) {
            if (before != options.expected) { result.error = ERROR_REVISION_MISMATCH; return false; }
            bool found = false;
            for (const auto& choice : choices) if (choice.id == options.target && choice.enabled &&
                choice.name == hostWide(options.targetName)) { found = true; break; }
            if (!found) { result.error = ERROR_INVALID_PARAMETER; return false; }
            void* value = static_cast<unsigned char*>(parameter) + 0x10;
            auto valueMethods = *reinterpret_cast<uintptr_t**>(value);
            if (valueMethods[0xe8 / 8] != base + 0x3a92100 || now() >= request.deadline) return false;
            result.operationStarted = true;
            reinterpret_cast<void (__fastcall*)(void*, float, unsigned char)>(valueMethods[0xe8 / 8])
                (value, static_cast<float>(options.target), 1);
        }
        alignas(16) unsigned char display[24]{};
        hostFunction<void (__fastcall*)(void*)>(base, 0x3b7dd40)(display);
        *reinterpret_cast<uintptr_t*>(display) = base + 0x4190c98;
        reinterpret_cast<void (__fastcall*)(void*, void*)>(methods[0x208 / 8])(parameter, display);
        const std::string currentName = routingText(display);
        hostFunction<void (__fastcall*)(void*)>(base, 0x3b7dd80)(display);
        const int32_t current = *reinterpret_cast<int32_t*>(static_cast<unsigned char*>(parameter) + 0x40);
        std::ostringstream text;
        text << "{\"root\":\"0x" << std::hex << result.root << std::dec << "\",\"objectId\":" << options.objectId
             << ",\"tag\":" << options.tag << ",\"nativeType\":" << jsonString(type)
               << ",\"beforeId\":" << before << ",\"current\":{\"id\":" << current << ",\"name\":" << jsonString(currentName) << '}';
           if (options.mode == 1) text << ",\"confirmed\":" << (current == options.target ? "true" : "false");
           text << ",\"choices\":[";
        for (size_t index = 0; index < choices.size(); ++index) {
            if (index) text << ',';
            const auto& choice = choices[index];
            text << "{\"id\":" << choice.id << ",\"name\":" << jsonString(choice.name) << ",\"path\":"
                 << jsonString(choice.path) << ",\"enabled\":" << (choice.enabled ? "true" : "false") << '}';
        }
        text << "]}";
        result.operationReturned = true;
        return writeModelJson(text.str());
    } catch (const std::exception& error) {
        result.error = ERROR_INVALID_DATA;
        writeModelJson("{\"error\":" + jsonString(error.what()) + "}");
        return false;
    }
}