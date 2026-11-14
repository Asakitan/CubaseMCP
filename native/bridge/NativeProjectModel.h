#pragma once
constexpr uint32_t kMaxModelItems = 131072;
struct ModelOptions { uint32_t version, offset, limit, flags; };
struct EventEditOptions {
    uint32_t version, field, pathCount, reserved;
    uint64_t root;
    uint32_t path[8];
    double expectedStart, expectedDuration, value;
    wchar_t expectedName[256];
    char expectedType[32];
    uint64_t eventId;
    uint32_t expectedPitch, expectedVelocity, expectedChannel, reservedNote;
    double expectedVelocityNormalized;
};
static_assert(sizeof(EventEditOptions) == 656, "Event edit options layout");

struct HostReference {
    void* value = nullptr;
    explicit HostReference(void* object = nullptr) : value(object) {}
    HostReference(const HostReference&) = delete;
    HostReference& operator=(const HostReference&) = delete;
    void release() {
        if (value) { auto object = value; value = nullptr; reinterpret_cast<void (__fastcall*)(void*)>((*reinterpret_cast<uintptr_t**>(object))[2])(object); }
    }
    ~HostReference() { release(); }
};

void* modelContext(uintptr_t base, void* parent) {
    void* context = nullptr;
    hostFunction<void* (__fastcall*)(void**, void*)>(base, 0x2732170)(&context, parent);
    if (!hostObject(base, context, 0x100) || *reinterpret_cast<uintptr_t*>(context) != base + 0x446e330)
        throw std::runtime_error("Unexpected host edit context");
    auto parentMethods = *reinterpret_cast<uintptr_t**>(parent);
    void* timeBase = reinterpret_cast<void* (__fastcall*)(void*)>(parentMethods[0x248 / 8])(parent);
    if (!timeBase || !readable(timeBase, 24) ||
        ((*static_cast<int32_t*>(timeBase) == 0 || *static_cast<int32_t*>(timeBase) == 17) &&
            (!*reinterpret_cast<void**>(static_cast<unsigned char*>(timeBase) + 8) ||
             !*reinterpret_cast<void**>(static_cast<unsigned char*>(timeBase) + 16)))) {
        HostReference invalid(context);
        throw std::runtime_error("Parent event time base is unavailable");
    }
    for (size_t offset : {0x58, 0x88, 0xb8}) {
        void* contextBase = static_cast<unsigned char*>(context) + offset;
        hostFunction<void (__fastcall*)(void*)>(base, 0x2b22a00)(contextBase);
        hostFunction<void* (__fastcall*)(void*, void*)>(base, 0x2b226c0)(contextBase, timeBase);
    }
    return context;
}

struct ModelItem {
    void* object = nullptr;
    void* parentData = nullptr;
    void* parentEvent = nullptr;
    std::vector<uint32_t> path;
    std::string type, name;
    double start = 0, duration = 0;
    double startSeconds = 0, durationSeconds = 0;
    int32_t timeBase = -1;
    bool track = false, locked = false;
    uint32_t pitch = 0, velocity = 0, channel = 0;
    uint32_t parameterTag = 0;
    double velocityNormalized = 0;
    double normalizedValue = 0;
};

std::string jsonString(const std::string& value) {
    std::string out = "\"";
    for (unsigned char ch : value) {
        if (ch == '\\' || ch == '"') { out += '\\'; out += static_cast<char>(ch); }
        else if (ch < 0x20) { char escaped[7]{}; sprintf_s(escaped, "\\u%04x", static_cast<unsigned>(ch)); out += escaped; }
        else out += static_cast<char>(ch);
    }
    return out + '"';
}

std::string hostNarrow(const char* text) {
    if (!text) return {};
    size_t length = 0;
    while (length <= 512) {
        if ((length == 0 || (reinterpret_cast<uintptr_t>(text + length) & 0xfff) == 0) && !readable(text + length, 1))
            throw std::runtime_error("Unreadable host text");
        if (!text[length]) return std::string(text, length);
        ++length;
    }
    throw std::runtime_error("Host type exceeds the text bound");
}

std::string hostWide(const wchar_t* text) {
    if (!text) return {};
    size_t length = 0;
    while (length <= 1024) {
        const auto address = reinterpret_cast<uintptr_t>(text + length);
        if ((length == 0 || (address & 0xfff) < sizeof(wchar_t) || (address & 0xfff) > 0x1000 - sizeof(wchar_t)) &&
            !readable(text + length, sizeof(wchar_t)))
            throw std::runtime_error("Unreadable host name");
        if (!text[length]) break;
        ++length;
    }
    if (length > 1024) throw std::runtime_error("Host name exceeds the text bound");
    if (!length) return {};
    const int count = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, text, static_cast<int>(length), nullptr, 0, nullptr, nullptr);
    if (count <= 0) throw std::runtime_error("Invalid host Unicode name");
    std::string value(static_cast<size_t>(count), '\0');
    if (WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, text, static_cast<int>(length), &value[0], count, nullptr, nullptr) != count)
        throw std::runtime_error("Host name conversion failed");
    return value;
}

void collectModel(uintptr_t base, void* parentEvent, void* data, const std::vector<uint32_t>& parentPath,
                  std::vector<ModelItem>& items, std::unordered_set<void*>& visited) {
    if (!hostObject(base, data) || parentPath.size() > 8) throw std::runtime_error("Invalid event container");
    auto dataMethods = *reinterpret_cast<uintptr_t**>(data);
    void* cursor = reinterpret_cast<void* (__fastcall*)(void*, uint32_t)>(dataMethods[0xe8 / 8])(data, 0);
    if (!hostObject(base, cursor)) throw std::runtime_error("Host event cursor is absent");
    HostReference cursorOwner(cursor);
    auto cursorMethods = *reinterpret_cast<uintptr_t**>(cursor);
    HostReference context(modelContext(base, parentEvent));
    try {
        for (uint32_t index = 0; index < kMaxModelItems; ++index) {
            void* event = reinterpret_cast<void* (__fastcall*)(void*)>(cursorMethods[0xc8 / 8])(cursor);
            if (!event) return;
            if (!hostObject(base, event, 0x68) || items.size() >= kMaxModelItems) throw std::runtime_error("Event discovery bound exceeded");
            if (!visited.insert(event).second) throw std::runtime_error("Cycle or duplicate in event tree");
            auto methods = *reinterpret_cast<uintptr_t**>(event);
            ModelItem item;
            item.object = event; item.parentData = data; item.parentEvent = parentEvent; item.path = parentPath; item.path.push_back(index);
            item.type = hostNarrow(reinterpret_cast<const char* (__fastcall*)(void*)>(methods[6])(event));
            item.name = hostWide(reinterpret_cast<const wchar_t* (__fastcall*)(void*)>(methods[0x1b8 / 8])(event));
            item.start = reinterpret_cast<double (__fastcall*)(void*)>(methods[0xd8 / 8])(event);
            item.duration = reinterpret_cast<double (__fastcall*)(void*)>(methods[0xe8 / 8])(event);
            item.startSeconds = hostFunction<double (__fastcall*)(void*, void*)>(base, 0x2729cb0)(context.value, event);
            item.durationSeconds = hostFunction<double (__fastcall*)(void*, void*)>(base, 0x2729b90)(context.value, event);
            item.track = reinterpret_cast<unsigned char (__fastcall*)(void*, const char*, unsigned char)>(methods[7])
                (event, reinterpret_cast<const char*>(base + 0x41a7a00), 1) != 0;
            item.locked = reinterpret_cast<unsigned char (__fastcall*)(void*)>(methods[0x2d0 / 8])(event) != 0;
            void* time = reinterpret_cast<void* (__fastcall*)(void*)>(methods[0x248 / 8])(event);
            if (time && readable(time, 4)) item.timeBase = *static_cast<int32_t*>(time);
            if (item.type == "MMidiNote") {
                if (!hostObject(base, event, 0x78) || *reinterpret_cast<uintptr_t*>(event) != base + 0x43d7fe8)
                    throw std::runtime_error("Unexpected MIDI note layout");
                void* midi = static_cast<unsigned char*>(event) + 0x40;
                auto midiMethods = *reinterpret_cast<uintptr_t**>(midi);
                if (reinterpret_cast<uintptr_t>(midiMethods) != base + 0x43d84d0 ||
                    midiMethods[4] != base + 0x168b090 || midiMethods[6] != base + 0x1f40320 || midiMethods[8] != base + 0x22411f0)
                    throw std::runtime_error("Unexpected MIDI note accessors");
                item.channel = reinterpret_cast<uint8_t (__fastcall*)(void*)>(midiMethods[4])(midi);
                item.pitch = reinterpret_cast<uint16_t (__fastcall*)(void*)>(midiMethods[6])(midi);
                item.velocity = reinterpret_cast<uint8_t (__fastcall*)(void*)>(midiMethods[8])(midi);
                item.velocityNormalized = *reinterpret_cast<double*>(static_cast<unsigned char*>(event) + 0x68);
                if (!std::isfinite(item.velocityNormalized)) throw std::runtime_error("Invalid MIDI note velocity");
            }
            if (item.type == "MParamEvent") {
                if (*reinterpret_cast<uintptr_t*>(event) != base + 0x4205e48)
                    throw std::runtime_error("Unexpected automation point layout");
                void* value = static_cast<unsigned char*>(event) + 0x40;
                auto valueMethods = *reinterpret_cast<uintptr_t**>(value);
                if (reinterpret_cast<uintptr_t>(valueMethods) != base + 0x4206300 || valueMethods[7] != base + 0x18844c0)
                    throw std::runtime_error("Unexpected automation value accessor");
                item.normalizedValue = reinterpret_cast<double (__fastcall*)(void*)>(valueMethods[7])(value);
                if (!std::isfinite(item.normalizedValue) || item.normalizedValue < 0 || item.normalizedValue > 1)
                    throw std::runtime_error("Invalid automation point value");
            }
            items.push_back(item);
            if (item.type == "MAutomationTrackEvent") {
                if (!readable(static_cast<unsigned char*>(event) + 0x1b8, 4)) throw std::runtime_error("Invalid automation track tag");
                items.back().parameterTag = *reinterpret_cast<uint32_t*>(static_cast<unsigned char*>(event) + 0x1b8);
            }
            if (item.track || item.type == "MMidiPartEvent" || item.type == "MAutomationTrackEvent") {
                void* children = reinterpret_cast<void* (__fastcall*)(void*)>(methods[0x230 / 8])(event);
                if (children) collectModel(base, event, children, item.path, items, visited);
            }
        }
        throw std::runtime_error("Event cursor did not terminate within the bound");
    } catch (...) {
        throw;
    }
}

bool writeModelJson(const std::string& text) {
    if (text.size() > 8 * 1024 * 1024) return false;
    wchar_t path[MAX_PATH]{};
    if (!sibling(L"model.json", path, MAX_PATH)) return false;
    HANDLE file = CreateFileW(path, GENERIC_WRITE, 0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return false;
    DWORD written = 0;
    const bool ok = WriteFile(file, text.data(), static_cast<DWORD>(text.size()), &written, nullptr) &&
        written == text.size() && FlushFileBuffers(file);
    CloseHandle(file);
    return ok;
}

std::string modelItemJson(const ModelItem& item) {
    std::ostringstream text;
    text.imbue(std::locale::classic()); text << std::setprecision(17) << "{\"path\":[";
    for (size_t p = 0; p < item.path.size(); ++p) { if (p) text << ','; text << item.path[p]; }
        text << "],\"eventId\":\"0x" << std::hex << reinterpret_cast<uintptr_t>(item.object) << std::dec
            << "\",\"type\":" << jsonString(item.type) << ",\"name\":" << jsonString(item.name)
         << ",\"track\":" << (item.track ? "true" : "false") << ",\"locked\":" << (item.locked ? "true" : "false")
         << ",\"timeBaseCode\":" << item.timeBase;
    const char* names[] = {"startNative", "durationNative", "startSeconds", "durationSeconds"};
    const double values[] = {item.start, item.duration, item.startSeconds, item.durationSeconds};
    for (size_t i = 0; i < 4; ++i) {
        if (item.type == "MParamEvent" && (i == 1 || i == 3)) continue;
        text << ",\"" << names[i] << "\":";
        if (std::isfinite(values[i])) text << values[i]; else text << "null";
    }
    if (item.type == "MMidiNote") text << ",\"pitch\":" << item.pitch << ",\"velocity\":" << item.velocity
        << ",\"channel\":" << item.channel << ",\"velocityNormalized\":" << item.velocityNormalized;
    if (item.type == "MAutomationTrackEvent") text << ",\"parameterTag\":" << item.parameterTag;
    if (item.type == "MParamEvent") text << ",\"normalizedValue\":" << item.normalizedValue;
    text << '}'; return text.str();
}

bool snapshotProjectModel(uintptr_t base) {
    ModelOptions options{};
    if (!readExact(L"model-options.bin", &options, sizeof(options)) || options.version != 1 ||
        options.limit < 1 || options.limit > 512 || options.offset > kMaxModelItems || options.flags != 0) return false;
    try {
        auto root = reinterpret_cast<void*>(result.root);
        if (!hostObject(base, root, 0x68) || *reinterpret_cast<uintptr_t*>(root) != base + 0x4471c40) return false;
        auto methods = *reinterpret_cast<uintptr_t**>(root);
        void* data = reinterpret_cast<void* (__fastcall*)(void*)>(methods[0x230 / 8])(root);
        std::vector<ModelItem> items;
        std::unordered_set<void*> visited;
        collectModel(base, root, data, {}, items, visited);
        std::ostringstream text;
        text.imbue(std::locale::classic());
        text << std::setprecision(17) << "{\"root\":\"0x" << std::hex << result.root << std::dec
             << "\",\"total\":" << items.size() << ",\"offset\":" << options.offset << ",\"items\":[";
        const size_t end = (static_cast<size_t>(options.offset) + options.limit < items.size()) ? options.offset + options.limit : items.size();
        for (size_t i = options.offset; i < end; ++i) {
            if (i != options.offset) text << ',';
              text << modelItemJson(items[i]);
        }
        text << "],\"nextOffset\":";
        if (end < items.size()) text << end; else text << "null";
        text << '}';
        return writeModelJson(text.str());
    } catch (const std::exception& error) {
        result.error = ERROR_INVALID_DATA;
        writeModelJson("{\"error\":" + jsonString(error.what()) + "}");
        return false;
    }
}

bool editProjectEvent(uintptr_t base, void* document) {
    result.operationStarted = false;
    EventEditOptions options{};
    if (!readExact(L"event-edit.bin", &options, sizeof(options)) || options.version != 2 || options.reserved != 0 || options.reservedNote != 0 ||
        options.field < 1 || options.field > 4 || options.pathCount < 2 || options.pathCount > 8 || options.root != result.root ||
        options.expectedName[255] || options.expectedType[31] || !std::isfinite(options.value) || options.value < 0 ||
        options.value > 86400 || (options.field == 2 && options.value == 0) ||
        !std::isfinite(options.expectedStart) || !std::isfinite(options.expectedDuration)) return false;
    try {
        void* root = reinterpret_cast<void*>(result.root);
        if (!hostObject(base, root, 0x68) || *reinterpret_cast<uintptr_t*>(root) != base + 0x4471c40) return false;
        auto rootMethods = *reinterpret_cast<uintptr_t**>(root);
        void* data = reinterpret_cast<void* (__fastcall*)(void*)>(rootMethods[0x230 / 8])(root);
        std::vector<ModelItem> items;
        std::unordered_set<void*> visited;
        collectModel(base, root, data, {}, items, visited);
        const std::vector<uint32_t> wanted(options.path, options.path + options.pathCount);
        const ModelItem* selected = nullptr;
        for (const auto& item : items) if (item.path == wanted) { selected = &item; break; }
        if (!selected || selected->track || selected->locked ||
            (selected->type != "MAudioEvent" && selected->type != "MAudioPartEvent" && selected->type != "MMidiPartEvent" && selected->type != "MMidiNote") ||
            selected->type != options.expectedType || selected->name != hostWide(options.expectedName) ||
            (options.eventId && reinterpret_cast<uintptr_t>(selected->object) != options.eventId) ||
            std::fabs(selected->startSeconds - options.expectedStart) > 1e-8 ||
            std::fabs(selected->durationSeconds - options.expectedDuration) > 1e-8) {
            result.error = ERROR_REVISION_MISMATCH; return false;
        }
        const ModelItem before = *selected;
        for (const auto& ancestor : items) {
            if (!ancestor.locked || ancestor.path.size() > wanted.size()) continue;
            bool matches = true;
            for (size_t index = 0; index < ancestor.path.size(); ++index) if (ancestor.path[index] != wanted[index]) matches = false;
            if (matches) { result.error = ERROR_ACCESS_DENIED; return false; }
        }
        if (before.type == "MMidiNote") {
            if (!options.eventId || options.pathCount < 3 || before.pitch != options.expectedPitch ||
                before.velocity != options.expectedVelocity || before.channel != options.expectedChannel ||
                !std::isfinite(options.expectedVelocityNormalized) || before.velocityNormalized != options.expectedVelocityNormalized) {
                result.error = ERROR_REVISION_MISMATCH; return false;
            }
        } else if (options.field >= 3) { result.error = ERROR_NOT_SUPPORTED; return false; }
        if (options.field >= 3 && (options.value > 127 || std::floor(options.value) != options.value ||
            (options.field == 4 && options.value == 0))) return false;
        if (options.field == 2 && before.type == "MAudioEvent" && options.value > before.durationSeconds) {
            result.error = ERROR_NOT_SUPPORTED; return false; // trimming, not stretching/looping past the source
        }
        HostReference context(modelContext(base, before.parentEvent));
        if (options.field <= 2) {
            const double roundTrip = options.field == 1
                ? hostFunction<double (__fastcall*)(void*, double)>(base, 0x272baf0)(context.value, before.startSeconds)
                : hostFunction<double (__fastcall*)(void*, void*, double)>(base, 0x2728660)(context.value, before.object, before.durationSeconds);
            const double original = options.field == 1 ? before.start : before.duration;
            if (!std::isfinite(roundTrip) || std::fabs(roundTrip - original) > 1e-6) {
                result.error = ERROR_INVALID_DATA; return false;
            }
        }
        auto dataMethods = *reinterpret_cast<uintptr_t**>(before.parentData);
        HostReference writeAccess(reinterpret_cast<void* (__fastcall*)(void*, uint32_t)>(dataMethods[0xe8 / 8])(before.parentData, 1));
        if (!hostObject(base, writeAccess.value) || now() >= request.deadline) return false;
        auto objectInterface = static_cast<unsigned char*>(before.object) + (options.field <= 2 ? 0x20 : 0x40);
        auto methods = *reinterpret_cast<uintptr_t**>(objectInterface);
        const size_t setterSlots[] = {0xa8, 0xb8, 0x38, 0x48};
        const uintptr_t setterRvas[] = {0x2743060, 0x27427a0, 0x2240b60, 0x2240ce0};
        const uintptr_t setter = methods[setterSlots[options.field - 1] / 8];
        if (setter != base + setterRvas[options.field - 1]) return false;
        result.operationStarted = true;
        const long accepted = options.field <= 2
            ? reinterpret_cast<long (__fastcall*)(void*, void*, double, void*)>(setter)(objectInterface, context.value, options.value, nullptr)
            : reinterpret_cast<long (__fastcall*)(void*, void*, uint32_t, void*)>(setter)(objectInterface, context.value, static_cast<uint32_t>(options.value), nullptr);
        result.operationReturned = true;
        if (accepted != 0) { result.error = static_cast<DWORD>(accepted); return false; }
        hostFunction<void (__fastcall*)(void*, uint32_t)>(base, 0x272d5b0)(before.parentData, 3);
        writeAccess.release();
        auto documentMethods = *reinterpret_cast<uintptr_t**>(document);
        if (documentMethods[0x110 / 8] != base + 0x1cf7d20) return false;
        reinterpret_cast<void (__fastcall*)(void*)>(documentMethods[0x110 / 8])(document);
        items.clear(); visited.clear();
        collectModel(base, root, data, {}, items, visited);
        for (const auto& after : items) if (after.object == before.object) {
            const double observed = options.field == 1 ? after.startSeconds : options.field == 2 ? after.durationSeconds
                : options.field == 3 ? static_cast<double>(after.pitch) : static_cast<double>(after.velocity);
            const bool confirmed = std::isfinite(observed) && std::fabs(observed - options.value) < 0.002;
            std::ostringstream text; text.imbue(std::locale::classic()); text << std::setprecision(17);
            text << "{\"root\":\"0x" << std::hex << result.root << std::dec << "\",\"before\":" << modelItemJson(before)
                 << ",\"after\":" << modelItemJson(after) << (options.field <= 2 ? ",\"requestedSeconds\":" : ",\"requestedValue\":") << options.value
                 << ",\"confirmed\":" << (confirmed ? "true" : "false") << '}';
            return writeModelJson(text.str());
        }
        return false;
    } catch (const std::exception& error) {
        result.error = ERROR_INVALID_DATA;
        writeModelJson("{\"error\":" + jsonString(error.what()) + "}");
        return false;
    }
}

struct ChannelCreateOptions {
    uint32_t version, kind;
    uint64_t root;
    wchar_t name[256];
};
static_assert(sizeof(ChannelCreateOptions) == 528, "Channel create options layout");

bool createEmptyNativeTrack(uintptr_t base, void* root, void* parent, uint32_t kind, const wchar_t* name) {
    void* track = nullptr;
    uintptr_t table = 0;
    if (kind == 1 || kind == 3) {
        track = hostFunction<void* (__fastcall*)(void*)>(base, kind == 1 ? 0x225f780 : 0x1ae6140)(root);
        table = kind == 1 ? 0x425d0b8 : 0x425d948;
    } else if (kind == 4) {
        void* memory = hostFunction<void* (__fastcall*)(size_t)>(base, 0x3b9b244)(0x1f0);
        if (!memory) return false;
        track = hostFunction<void* (__fastcall*)(void*, void*, const char*)>(base, 0x27c04b0)(memory, root, nullptr);
        table = 0x4482f80;
        hostFunction<void (__fastcall*)(void*, void*)>(base, 0x27832c0)(track, root);
    }
    if (!hostObject(base, track, 0x1b0) || *reinterpret_cast<uintptr_t*>(track) != base + table) return false;
    auto methods = *reinterpret_cast<uintptr_t**>(track);
    reinterpret_cast<void (__fastcall*)(void*, const wchar_t*)>(methods[0x1b0 / 8])(track, name);
    reinterpret_cast<void (__fastcall*)(void*, void*)>(methods[0x1f8 / 8])(track, root);
    return hostFunction<uint64_t (__fastcall*)(void*, void*, uint32_t)>(base, 0x2776ba0)(track, parent, 0x7fff) != 0;
}

bool attachMixerDevice(uintptr_t base, void* document, void* root, void* channel, uint32_t factoryType, const wchar_t* name) {
    result.checkpoint = 90;
    const uint32_t kind = hostFunction<uint32_t (__fastcall*)(void*)>(base, 0x2797c40)(channel);
    if (!kind || kind > 10) return false;
    alignas(16) unsigned char identifier[80]{};
    hostFunction<void* (__fastcall*)(void*, const char*, uint32_t)>(base, 0x2991610)
        (identifier, reinterpret_cast<const char*>(base + 0x425c1e0), factoryType);
    void* memory = hostFunction<void* (__fastcall*)(size_t)>(base, 0x3b9b244)(0x1b8);
    void* track = memory ? hostFunction<void* (__fastcall*)(void*, void*, void*, uint32_t, uint32_t)>(base, 0x27975f0)
        (memory, root, identifier, kind, 1) : nullptr;
    hostFunction<void (__fastcall*)(void*)>(base, 0x29916f0)(identifier);
    if (!hostObject(base, track, 0x1b8) || *reinterpret_cast<uintptr_t*>(track) != base + 0x447c3d0) return false;
    result.checkpoint = 91;
    auto trackMethods = *reinterpret_cast<uintptr_t**>(track);
    void* connection = reinterpret_cast<void* (__fastcall*)(void*)>(trackMethods[0x448 / 8])(track);
    if (!hostObject(base, connection, 0xd0) || *reinterpret_cast<uintptr_t*>(connection) != base + 0x41dc610) return false;
    auto connectionMethods = *reinterpret_cast<uintptr_t**>(connection);
    if (connectionMethods[0xd0 / 8] != base + 0x27744a0 || connectionMethods[0xe0 / 8] != base + 0x1c80010 ||
        connectionMethods[0xe8 / 8] != base + 0x174a190) return false;
    auto connectionState = reinterpret_cast<uint16_t* (__fastcall*)(void*)>(connectionMethods[0xe8 / 8])(connection);
    if (!connectionState || !readable(connectionState, sizeof(uint16_t))) return false;
    *connectionState = 2;
    result.checkpoint = 92;
    if (!reinterpret_cast<uint8_t (__fastcall*)(void*, void*)>(connectionMethods[0xd0 / 8])(connection, channel)) return false;
    result.checkpoint = 93;
    hostFunction<void (__fastcall*)(void*, void*)>(base, 0x27832c0)(track, root);
    reinterpret_cast<void (__fastcall*)(void*, const wchar_t*)>(trackMethods[0x1b0 / 8])(track, name);
    void* parent = hostFunction<void* (__fastcall*)(void*, uint32_t, void*, void*)>(base, 0x1cf8960)
        (document, kind, nullptr, channel);
    if (!hostObject(base, parent)) return false;
    result.checkpoint = 94;
    const bool inserted = hostFunction<uint64_t (__fastcall*)(void*, void*, uint32_t)>(base, 0x2776ba0)(track, parent, 0x7fff) != 0;
    result.checkpoint = 95;
    *connectionState = 1;
    return inserted && reinterpret_cast<void* (__fastcall*)(void*)>(connectionMethods[0xe0 / 8])(connection) == channel;
}

bool createMixerTrack(uintptr_t base, void* document) {
    result.operationStarted = false;
    ChannelCreateOptions options{};
    if (!readExact(L"track-create.bin", &options, sizeof(options)) || options.version != 1 ||
        (options.kind != 1 && options.kind != 2 && options.kind != 3 && options.kind != 4 && options.kind != 6) || options.root != result.root ||
        !options.name[0] || options.name[255]) return false;
    try {
        void* root = reinterpret_cast<void*>(result.root);
        if (!hostObject(base, root, 0x68) || *reinterpret_cast<uintptr_t*>(root) != base + 0x4471c40) return false;
        auto rootMethods = *reinterpret_cast<uintptr_t**>(root);
        void* data = reinterpret_cast<void* (__fastcall*)(void*)>(rootMethods[0x230 / 8])(root);
        if (!hostObject(base, data) || *reinterpret_cast<uintptr_t*>(data) != base + 0x4479f30) return false;
        auto mixer = *reinterpret_cast<void**>(base + 0x5943ad0);
        if (!hostObject(base, mixer, 0xc80)) return false;
        std::vector<ModelItem> before;
        std::unordered_set<void*> beforeVisited;
        collectModel(base, root, data, {}, before, beforeVisited);
        if (before.size() >= kMaxModelItems - 1 || now() >= request.deadline) return false;

        result.operationStarted = true;
        void* channel = nullptr;
        if (options.kind == 1 || options.kind == 3 || options.kind == 4) {
            if (!createEmptyNativeTrack(base, root, data, options.kind, options.name)) return false;
        } else {
            channel = hostFunction<void* (__fastcall*)(void*, uint32_t)>(base, 0x2c4a540)(nullptr, options.kind == 2 ? 4 : 5);
            if (!hostObject(base, channel)) return false;
            const uintptr_t expectedTable = options.kind == 2 ? 0x4569538 : 0x4567ae0;
            const uintptr_t expectedSetter = options.kind == 2 ? 0x2c60af0 : 0x2998960;
            auto channelMethods = *reinterpret_cast<uintptr_t**>(channel);
            if (reinterpret_cast<uintptr_t>(channelMethods) != base + expectedTable ||
                channelMethods[0x150 / 8] != base + expectedSetter) return false;
            reinterpret_cast<void (__fastcall*)(void*, const wchar_t*)>(channelMethods[0x150 / 8])(channel, options.name);
            if (!attachMixerDevice(base, document, root, channel, options.kind == 2 ? 4 : 5, options.name)) return false;
        }
        auto documentMethods = *reinterpret_cast<uintptr_t**>(document);
        if (documentMethods[0x110 / 8] != base + 0x1cf7d20) return false;
        reinterpret_cast<void (__fastcall*)(void*)>(documentMethods[0x110 / 8])(document);
        result.operationReturned = true;

        std::vector<ModelItem> after;
        std::unordered_set<void*> afterVisited;
        collectModel(base, root, data, {}, after, afterVisited);
        std::ostringstream text;
        text << "{\"root\":\"0x" << std::hex << result.root << "\",\"channelAddress\":\"0x"
             << reinterpret_cast<uintptr_t>(channel) << std::dec << "\",\"kind\":\""
             << (options.kind == 1 ? "midi" : options.kind == 2 ? "group" : options.kind == 3 ? "instrument" : options.kind == 4 ? "folder" : "fx") << "\",\"requestedName\":" << jsonString(hostWide(options.name))
             << ",\"attachedCount\":1,\"beforeCount\":" << before.size()
             << ",\"afterCount\":" << after.size() << ",\"added\":[";
        bool first = true;
        for (const auto& item : after) {
            if (beforeVisited.count(item.object)) continue;
            if (!first) text << ',';
            text << modelItemJson(item);
            first = false;
        }
        text << "]}";
        return writeModelJson(text.str());
    } catch (const std::exception& error) {
        result.error = ERROR_INVALID_DATA;
        writeModelJson("{\"error\":" + jsonString(error.what()) + "}");
        return false;
    }
}
