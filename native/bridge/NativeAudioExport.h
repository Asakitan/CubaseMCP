#pragma once
// Cubase 16.0.5.174: the same NonUI controller used by SKIAudioExport (RVA 0x1a7fa70).
// All controller values belong to this temporary instance. Its +0x1f9 flag prevents saving UI preferences.
struct AudioExportOptions {
    uint32_t version, sampleRate, bitDepth, floatingPoint;
};
static_assert(sizeof(AudioExportOptions) == 16, "Audio export options layout");

template<class Function> Function hostFunction(uintptr_t base, uintptr_t rva) {
    return reinterpret_cast<Function>(base + rva);
}

bool hostObject(uintptr_t base, const void* object, size_t length = 8) {
    if (!object || !readable(object, length)) return false;
    const uintptr_t table = *static_cast<const uintptr_t*>(object);
    return table >= base + 0x4000000 && table < base + 0x5900000 && readable(reinterpret_cast<void*>(table), 8);
}

bool exportAudioFile(uintptr_t base, void* file) {
    AudioExportOptions options{};
    result.exportStage = 1;
    if (!readExact(L"audio-export.bin", &options, sizeof(options)) || options.version != 1 ||
        options.sampleRate < 8000 || options.sampleRate > 192000 ||
        (options.bitDepth != 16 && options.bitDepth != 24 && options.bitDepth != 32) || options.floatingPoint > 1 ||
        (options.floatingPoint && options.bitDepth != 32)) return false;
    using Void = void (__fastcall*)(void*);
    using GetValue = void* (__fastcall*)(void*, uint32_t);
    using SetIndex = void (__fastcall*)(void*, uint32_t, int32_t);
    using GetIndex = int32_t (__fastcall*)(void*, uint32_t);
    using Construct = void* (__fastcall*)(void*, void*, unsigned char);
    using ClassIs = unsigned char (__fastcall*)(void*, const void*, unsigned char);
    using GetText = long (__fastcall*)(void*, wchar_t*);
    using SetText = void (__fastcall*)(void*, const wchar_t*);
    using String = void* (__fastcall*)(void*, const wchar_t*, int32_t, unsigned char);
    using Vector = uintptr_t* (__fastcall*)();
    auto value = hostFunction<GetValue>(base, 0x36460b0);
    auto setIndex = hostFunction<SetIndex>(base, 0x36473d0);
    auto getIndex = hostFunction<GetIndex>(base, 0x3646050);

    alignas(16) unsigned char controller[0x2c8]{};
    bool constructed = false, rendered = false;
    __try {
        result.exportStage = 2;
        hostFunction<Construct>(base, 0x1a80360)(controller, nullptr, 1);
        constructed = true;
        if (*reinterpret_cast<uintptr_t*>(controller) != base + 0x4267870 || controller[0x1f9] != 1 ||
            !hostObject(base, *reinterpret_cast<void**>(controller + 0xf8)) ||
            !hostObject(base, *reinterpret_cast<void**>(controller + 0x268))) return false;

        // A fresh NonUI controller does not inherit the UI's selected output. The host's own
        // default-mixdown path resolves the main VSTOutputChannel with this getter.
        auto mixer = *reinterpret_cast<void**>(base + 0x5943ad0);
        if (!hostObject(base, mixer, 0xb38)) return false;
        void* output = hostFunction<void* (__fastcall*)(void*)>(base, 0x2c75c70)(mixer);
        if (!hostObject(base, output)) return false;
        auto outputMethods = *reinterpret_cast<uintptr_t**>(output);
        if (!reinterpret_cast<ClassIs>(outputMethods[7])(output, reinterpret_cast<void*>(base + 0x42fbb08), 1)) return false;
        void* busController = *reinterpret_cast<void**>(controller + 0xf8);
        hostFunction<void (__fastcall*)(void*, int32_t)>(base, 0x1a5fbb0)(busController, 0);
        hostFunction<void (__fastcall*)(void*, void*)>(base, 0x1a5fba0)(busController, output);
        hostFunction<void (__fastcall*)(void*, void*)>(base, 0x1a5fca0)(busController, output);

        auto descriptor = static_cast<unsigned char*>(file) + 0x10;
        auto pathMethods = *reinterpret_cast<uintptr_t**>(descriptor);
        if (reinterpret_cast<uintptr_t>(pathMethods) != base + 0x4831d70 ||
            pathMethods[6] != base + 0x3b17080 || pathMethods[7] != base + 0x3b17390 ||
            pathMethods[11] != base + 0x3b170c0) return false;
        wchar_t name[1024]{}, parent[1024]{};
        result.exportStage = 3;
        if (reinterpret_cast<GetText>(pathMethods[6])(descriptor, name) != 0 ||
            reinterpret_cast<GetText>(pathMethods[7])(descriptor, parent) != 0 || !name[0] || !parent[0]) return false;
        void* nameValue = value(controller, 4);
        if (!hostObject(base, nameValue, 0x18)) return false;
        auto nameMethods = *reinterpret_cast<uintptr_t**>(nameValue);
        if (!reinterpret_cast<ClassIs>(nameMethods[7])(nameValue, reinterpret_cast<void*>(base + 0x419a160), 1)) return false;
        auto stringValue = static_cast<unsigned char*>(nameValue) + 0x10;
        auto stringMethods = *reinterpret_cast<uintptr_t**>(stringValue);
        reinterpret_cast<SetText>(stringMethods[4])(stringValue, name);

        // Mirror SKIAudioExport: explicit directory on its export-settings model, not the global chooser.
        alignas(16) unsigned char folderText[0x18]{};
        hostFunction<String>(base, 0x3b7dc60)(folderText, parent, -1, 1);
        auto model = *reinterpret_cast<void**>(controller + 0x268);
        hostFunction<void (__fastcall*)(void*, void*)>(base, 0x1a7dff0)(model, folderText); // consumes the String
        hostFunction<void (__fastcall*)(void*, uint32_t)>(base, 0x1a7df30)(model, 0);

        result.exportStage = 4;
        unsigned char rawFormat[0x4c]{};
        if (reinterpret_cast<long (__fastcall*)(void*, void*)>(pathMethods[11])(descriptor, rawFormat) != 0) return false;
        alignas(16) unsigned char format[0x90]{};
        hostFunction<void* (__fastcall*)(void*, const void*, uint32_t, const void*, const void*, const void*, uint32_t)>(base, 0x3b14d40)
            (format, nullptr, 0, nullptr, nullptr, nullptr, 0);
        hostFunction<void (__fastcall*)(void*, void*)>(base, 0x3b18840)(rawFormat, format);
        const bool formatFound = hostFunction<unsigned char (__fastcall*)(void*, void*)>(base, 0x1a74d80)(controller, format) != 0;
        hostFunction<Void>(base, 0x3b155f0)(format);
        if (!formatFound) return false;

        result.exportStage = 5;
        auto rates = hostFunction<Vector>(base, 0x16a3e60)();
        if (!readable(rates, 24) || rates[1] < rates[0] || rates[1] - rates[0] > 128 * 0x18 ||
            !readable(reinterpret_cast<void*>(rates[0]), rates[1] - rates[0])) return false;
        int rateIndex = -1;
        for (uintptr_t row = rates[0], index = 0; row < rates[1]; row += 0x18, ++index)
            if (*reinterpret_cast<double*>(row + 8) == options.sampleRate) { rateIndex = static_cast<int>(index); break; }
        if (rateIndex < 0) return false;
        setIndex(controller, 8, rateIndex);
        if (getIndex(controller, 8) != rateIndex) return false;

        auto depths = hostFunction<Vector>(base, 0x1a75270)();
        if (!readable(depths, 24) || depths[1] < depths[0] || depths[1] - depths[0] > 32 * 0x20 ||
            !readable(reinterpret_cast<void*>(depths[0]), depths[1] - depths[0])) return false;
        int depthIndex = -1;
        for (uintptr_t row = depths[0], index = 0; row < depths[1]; row += 0x20, ++index) {
            if (*reinterpret_cast<uint32_t*>(row + 0x10) == (options.floatingPoint ? 2U : 1U) &&
                *reinterpret_cast<uint32_t*>(row + 0x14) == options.bitDepth) { depthIndex = static_cast<int>(index); break; }
        }
        if (depthIndex < 0) return false;
        setIndex(controller, 9, depthIndex);
        if (getIndex(controller, 9) != depthIndex) return false;
        setIndex(controller, 0xb, 0); // offline
        setIndex(controller, 0xc, 0); // no display updates
        setIndex(controller, 7, 0);   // no retained UI
        setIndex(controller, 0x16, 0); // one bus, not batch export
        setIndex(controller, 0x1a, 0); // locator range, not cycle markers or arranger chains

        result.exportStage = 6;
        void* settings = nullptr;
        hostFunction<void* (__fastcall*)(void*, void**, uintptr_t, uintptr_t)>(base, 0x1a6b1b0)(controller, &settings, 0, 0);
        if (!settings || !readable(settings, 0x1a0)) return false;
        using Predicate = unsigned char (__fastcall*)(void*);
        result.exportValidation = (hostFunction<Predicate>(base, 0x1a7ea10)(settings) ? 1U : 0U) |
            (hostFunction<Predicate>(base, 0x1a7f940)(settings) ? 0U : 2U) |
            (hostFunction<Predicate>(base, 0x1a7ea50)(settings) ? 4U : 0U) |
            (hostFunction<Predicate>(base, 0x1a7ea80)(settings) ? 8U : 0U);
        const bool valid = result.exportValidation == 0;
        // Same intrusive release sequence as the controller's host caller; no foreign allocator.
        if (InterlockedDecrement(reinterpret_cast<volatile LONG*>(static_cast<unsigned char*>(settings) + 0x10)) == 0) {
            auto methods = *reinterpret_cast<uintptr_t**>(settings);
            reinterpret_cast<Void>(methods[0])(settings);
            *reinterpret_cast<LONG*>(static_cast<unsigned char*>(settings) + 0x10) = -1000;
            auto virtualBase = *reinterpret_cast<int32_t**>(static_cast<unsigned char*>(settings) + 8);
            auto destructorObject = static_cast<unsigned char*>(settings) + 8 + virtualBase[1];
            reinterpret_cast<void (__fastcall*)(void*, uint32_t)>((*reinterpret_cast<uintptr_t**>(destructorObject))[0])(destructorObject, 1);
        }
        if (!valid || now() >= request.deadline || GetFileAttributesW(destination) != INVALID_FILE_ATTRIBUTES) return false;
        result.exportStage = 7;
        result.exportStarted = true;
        hostFunction<void (__fastcall*)(void*, int32_t)>(base, 0x1a6bd30)(controller, 1);
        result.exportReturned = true;
        result.exportStage = 8;
        WIN32_FILE_ATTRIBUTE_DATA info{};
        rendered = GetFileAttributesExW(destination, GetFileExInfoStandard, &info) &&
            !(info.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) &&
            (info.nFileSizeHigh != 0 || info.nFileSizeLow > 44);
    } __finally {
        if (constructed) hostFunction<Void>(base, 0x1a806d0)(controller);
    }
    return rendered;
}