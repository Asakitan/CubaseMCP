#pragma once

struct AutomationOptions {
    uint32_t version, mode;
    uint64_t root, track, lane, point;
    uint32_t parameterTag, expectedCount;
    double expectedStart, expectedValue, position, value;
    uint32_t offset, limit, objectId, reserved;
};
static_assert(sizeof(AutomationOptions) == 96, "Automation options layout");

bool projectAutomation(uintptr_t base, void* document) {
    result.operationStarted = false;
    AutomationOptions options{};
    if (!readExact(L"automation.bin", &options, sizeof(options)) || options.version != 2 ||
        options.mode > 5 || options.root != result.root || !options.track || options.reserved ||
        (options.mode != 5 && options.objectId) ||
        options.offset > kMaxModelItems || options.limit < 1 || options.limit > 512 || options.expectedCount > kMaxModelItems) return false;
    try {
        void* root = reinterpret_cast<void*>(result.root);
        if (!hostObject(base, root, 0x68) || *reinterpret_cast<uintptr_t*>(root) != base + 0x4471c40) return false;
        auto rootMethods = *reinterpret_cast<uintptr_t**>(root);
        void* data = reinterpret_cast<void* (__fastcall*)(void*)>(rootMethods[0x230 / 8])(root);
        std::vector<ModelItem> projectItems;
        std::unordered_set<void*> visited;
        collectModel(base, root, data, {}, projectItems, visited);
        const ModelItem* selected = nullptr;
        for (const auto& item : projectItems) if (reinterpret_cast<uintptr_t>(item.object) == options.track && item.track) { selected = &item; break; }
        if (!selected || !readable(selected->object, 0x68)) return false;
        void* node = *reinterpret_cast<void**>(static_cast<unsigned char*>(selected->object) + 0x60);
        if (!hostObject(base, node, 0x190) || *reinterpret_cast<uintptr_t*>(node) != base + 0x4209b38) return false;
        std::vector<ModelItem> automation;
        visited.clear();
        collectModel(base, selected->object, node, {}, automation, visited);
        if (options.mode == 5) {
            if (selected->locked || !options.objectId || options.objectId > 0x7fffffff || !options.parameterTag || options.lane || options.point) return false;
            void* service = hostFunction<void* (__fastcall*)(void*)>(base, 0x2458760)(document);
            if (!hostObject(base, service, 0xa0)) return false;
            int64_t objectId = options.objectId;
            void* adapter = nullptr;
            hostFunction<void* (__fastcall*)(void*, void**, void*, void*, int64_t*)>(base, 0x2459c70)
                (service, &adapter, nullptr, document, &objectId);
            if (!hostObject(base, adapter, 0x28)) return false;
            HostReference adapterOwner(adapter);
            void* owner = *reinterpret_cast<void**>(static_cast<unsigned char*>(adapter) + 0x20);
            if (!hostObject(base, owner)) return false;
            void* track = hostFunction<void* (__fastcall*)(void*, void*)>(base, 0x18a5330)(node, owner);
            if (!hostObject(base, track, 0xf0) || *reinterpret_cast<uintptr_t*>(track) != base + 0x4209798) return false;
            void* parameter = hostFunction<void* (__fastcall*)(void*, void*, void*, int64_t*, uint32_t*)>(base, 0x2454050)
                (service, nullptr, document, &objectId, &options.parameterTag);
            if (!hostObject(base, parameter)) return false;
            size_t beforeCount = 0;
            for (const auto& item : automation) if (item.type == "MAutomationTrackEvent") {
                ++beforeCount;
                if (item.parameterTag == options.parameterTag && *reinterpret_cast<void**>(static_cast<unsigned char*>(item.object) + 0x50) == track) {
                    result.error = ERROR_ALREADY_EXISTS; return false;
                }
            }
            if (beforeCount != options.expectedCount) { result.error = ERROR_REVISION_MISMATCH; return false; }
            if (now() >= request.deadline) return false;
            result.operationStarted = true;
            void* created = hostFunction<void* (__fastcall*)(void*, uint32_t, void*)>(base, 0x18a3460)(node, options.parameterTag, owner);
            result.operationReturned = true;
            auto documentMethods = *reinterpret_cast<uintptr_t**>(document);
            if (documentMethods[0x110 / 8] != base + 0x1cf7d20) return false;
            reinterpret_cast<void (__fastcall*)(void*)>(documentMethods[0x110 / 8])(document);
            automation.clear(); visited.clear();
            collectModel(base, selected->object, node, {}, automation, visited);
            const ModelItem* added = nullptr;
            size_t afterCount = 0;
            for (const auto& item : automation) if (item.type == "MAutomationTrackEvent") {
                ++afterCount;
                if (item.object == created && item.parameterTag == options.parameterTag) added = &item;
            }
            std::ostringstream text;
            text << "{\"root\":\"0x" << std::hex << result.root << "\",\"trackEventId\":\"0x" << options.track
                 << std::dec << "\",\"objectId\":" << options.objectId << ",\"parameterTag\":" << options.parameterTag
                 << ",\"beforeLaneCount\":" << beforeCount << ",\"afterLaneCount\":" << afterCount
                 << ",\"lane\":" << (added ? modelItemJson(*added) : "null")
                 << ",\"confirmed\":" << (added && afterCount == beforeCount + 1 ? "true" : "false") << '}';
            return writeModelJson(text.str());
        }
        if (options.mode != 0) {
            if (selected->locked || !options.lane || (options.mode != 3 && !options.point) || !options.parameterTag ||
                !std::isfinite(options.expectedStart) || !std::isfinite(options.expectedValue) ||
                !std::isfinite(options.value) || options.value < 0 ||
                ((options.mode == 1 || options.mode == 3) && options.value > 1) || (options.mode == 2 && options.value > 86400) ||
                (options.mode == 3 && (!std::isfinite(options.position) || options.position < 0 || options.position > 86400))) return false;
            const ModelItem* lane = nullptr;
            const ModelItem* point = nullptr;
            for (const auto& item : automation) {
                if (reinterpret_cast<uintptr_t>(item.object) == options.lane && item.type == "MAutomationTrackEvent" &&
                    item.parameterTag == options.parameterTag) lane = &item;
                if (reinterpret_cast<uintptr_t>(item.object) == options.point && item.type == "MParamEvent") point = &item;
            }
            if (!lane || lane->locked || (options.mode != 3 && (!point || point->locked || point->parentEvent != lane->object ||
                std::fabs(point->startSeconds - options.expectedStart) > 1e-8 || point->normalizedValue != options.expectedValue))) {
                result.error = ERROR_REVISION_MISMATCH; return false;
            }
            const ModelItem before = point ? *point : ModelItem{};
            void* laneData = reinterpret_cast<void* (__fastcall*)(void*)>((*reinterpret_cast<uintptr_t**>(lane->object))[0x230 / 8])(lane->object);
            if (!hostObject(base, laneData) || *reinterpret_cast<uintptr_t*>(laneData) != base + 0x4209f78) return false;
            size_t count = 0;
            for (const auto& item : automation) if (item.parentEvent == lane->object) {
                if (item.type != "MParamEvent") return false;
                ++count;
                const double wantedTime = options.mode == 3 ? options.position : options.value;
                if ((options.mode == 2 || options.mode == 3) && item.object != before.object && std::fabs(item.startSeconds - wantedTime) < 1e-8) {
                    result.error = ERROR_ALREADY_EXISTS; return false;
                }
            }
            if (count != options.expectedCount) { result.error = ERROR_REVISION_MISMATCH; return false; }
            auto dataMethods = *reinterpret_cast<uintptr_t**>(laneData);
            HostReference writeAccess(reinterpret_cast<void* (__fastcall*)(void*, uint32_t)>(dataMethods[0xe8 / 8])(laneData, 1));
            if (!hostObject(base, writeAccess.value) || now() >= request.deadline) return false;
            HostReference context(modelContext(base, lane->object));
            HostReference unlinkedPoint;
            void* changedPoint = before.object;
            if (options.mode == 2) {
                const double converted = hostFunction<double (__fastcall*)(void*, double)>(base, 0x272baf0)(context.value, before.startSeconds);
                if (!std::isfinite(converted) || std::fabs(converted - before.start) > 1e-6) return false;
                void* time = static_cast<unsigned char*>(before.object) + 0x20;
                auto timeMethods = *reinterpret_cast<uintptr_t**>(time);
                if (timeMethods[0xa8 / 8] != base + 0x2743060) return false;
                result.operationStarted = true;
                const long accepted = reinterpret_cast<long (__fastcall*)(void*, void*, double, void*)>(timeMethods[0xa8 / 8])
                    (time, context.value, options.value, nullptr);
                result.operationReturned = true;
                if (accepted != 0) { result.error = static_cast<DWORD>(accepted); return false; }
            } else if (options.mode == 1) {
                void* value = static_cast<unsigned char*>(before.object) + 0x40;
                auto valueMethods = *reinterpret_cast<uintptr_t**>(value);
                if (valueMethods[0x40 / 8] != base + 0x18852d0) return false;
                result.operationStarted = true;
                reinterpret_cast<void (__fastcall*)(void*, double)>(valueMethods[0x40 / 8])(value, options.value);
                result.operationReturned = true;
            } else {
                auto cursorMethods = *reinterpret_cast<uintptr_t**>(writeAccess.value);
                if (reinterpret_cast<uintptr_t>(cursorMethods) != base + 0x4470e90 ||
                    cursorMethods[0x100 / 8] != base + 0x274fe20 || cursorMethods[0x108 / 8] != base + 0x274f8f0) return false;
                if (options.mode == 3) {
                    const double nativePosition = hostFunction<double (__fastcall*)(void*, double)>(base, 0x272baf0)(context.value, options.position);
                    if (!std::isfinite(nativePosition)) return false;
                    void* memory = hostFunction<void* (__fastcall*)(size_t)>(base, 0x3b9b244)(0x68);
                    if (!memory) return false;
                    unlinkedPoint.value = hostFunction<void* (__fastcall*)(void*, double, float, uint8_t)>(base, 0x1883a50)
                        (memory, nativePosition, static_cast<float>(options.value), 0);
                    if (!hostObject(base, unlinkedPoint.value, 0x68) || *reinterpret_cast<uintptr_t*>(unlinkedPoint.value) != base + 0x4205e48) return false;
                    changedPoint = unlinkedPoint.value;
                    result.operationStarted = true;
                    const bool accepted = reinterpret_cast<uint8_t (__fastcall*)(void*, void*)>(cursorMethods[0x108 / 8])(writeAccess.value, changedPoint) != 0;
                    result.operationReturned = true;
                    if (!accepted) { result.error = ERROR_FUNCTION_FAILED; return false; }
                    unlinkedPoint.value = nullptr;
                } else {
                    result.operationStarted = true;
                    const bool accepted = reinterpret_cast<uint8_t (__fastcall*)(void*, void*)>(cursorMethods[0x100 / 8])(writeAccess.value, before.object) != 0;
                    result.operationReturned = true;
                    if (!accepted) { result.error = ERROR_FUNCTION_FAILED; return false; }
                    unlinkedPoint.value = before.object;
                    auto pointMethods = *reinterpret_cast<uintptr_t**>(before.object);
                    reinterpret_cast<void (__fastcall*)(void*, void*)>(pointMethods[0x260 / 8])(before.object, nullptr);
                }
            }
            hostFunction<void (__fastcall*)(void*, uint32_t)>(base, 0x272d5b0)(laneData, 3);
            writeAccess.release();
            unlinkedPoint.release();
            auto documentMethods = *reinterpret_cast<uintptr_t**>(document);
            if (documentMethods[0x110 / 8] != base + 0x1cf7d20) return false;
            reinterpret_cast<void (__fastcall*)(void*)>(documentMethods[0x110 / 8])(document);
            automation.clear(); visited.clear();
            collectModel(base, selected->object, node, {}, automation, visited);
            const ModelItem* after = nullptr;
            size_t afterCount = 0;
            for (const auto& item : automation) {
                if (item.parentEvent == reinterpret_cast<void*>(options.lane)) ++afterCount;
                if (item.object == changedPoint) after = &item;
            }
            const size_t wantedCount = options.mode == 3 ? count + 1 : options.mode == 4 ? count - 1 : count;
            bool confirmed = afterCount == wantedCount;
            if (options.mode == 4) confirmed = confirmed && !after;
            else confirmed = confirmed && after && (options.mode == 2 || std::fabs(after->normalizedValue - options.value) < 1e-6) &&
                (options.mode == 1 || std::fabs(after->startSeconds - (options.mode == 3 ? options.position : options.value)) < 1e-6);
            std::ostringstream text;
            text.imbue(std::locale::classic()); text << std::setprecision(17);
            text << "{\"root\":\"0x" << std::hex << result.root << "\",\"trackEventId\":\"0x" << options.track
                 << "\",\"laneEventId\":\"0x" << options.lane << std::dec << "\",\"parameterTag\":" << options.parameterTag
                 << ",\"beforePointCount\":" << count << ",\"afterPointCount\":" << afterCount
                 << ",\"before\":" << (before.object ? modelItemJson(before) : "null") << ",\"after\":" << (after ? modelItemJson(*after) : "null")
                 << ",\"confirmed\":" << (confirmed ? "true" : "false") << '}';
            return writeModelJson(text.str());
        }
        std::ostringstream text;
        text << "{\"root\":\"0x" << std::hex << result.root << "\",\"trackEventId\":\"0x"
             << options.track << "\",\"nodeAddress\":\"0x" << reinterpret_cast<uintptr_t>(node) << std::dec
             << "\",\"total\":" << automation.size() << ",\"offset\":" << options.offset << ",\"items\":[";
        const size_t end = (static_cast<size_t>(options.offset) + options.limit < automation.size()) ? options.offset + options.limit : automation.size();
        for (size_t index = options.offset; index < end; ++index) {
            if (index != options.offset) text << ',';
            text << modelItemJson(automation[index]);
        }
        text << "],\"nextOffset\":";
        if (end < automation.size()) text << end; else text << "null";
        text << '}';
        result.operationReturned = true;
        return writeModelJson(text.str());
    } catch (const std::exception& error) {
        result.error = ERROR_INVALID_DATA;
        writeModelJson("{\"error\":" + jsonString(error.what()) + "}");
        return false;
    }
}