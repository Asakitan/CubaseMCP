"""Read-only static helper: locate a literal string in an installed PE image and list the
RIP-relative code references to it together with the containing runtime function.

The image is only read from disk with pefile; nothing is loaded, executed or modified.
Usage: python scripts/find-string-refs.py <pe path> <string> [--wide|--ascii] [--max N] [--exact]
"""
import bisect
import json
import struct
import sys

import pefile


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = {a for a in sys.argv[1:] if a.startswith('--')}
    if len(args) < 2:
        raise SystemExit(__doc__)
    path, needle = args[0], args[1]
    limit = 40
    if '--max' in sys.argv:
        limit = int(sys.argv[sys.argv.index('--max') + 1])
        args = [a for a in args if a != str(limit)]
    exact = '--exact' in flags
    pe = pefile.PE(path, fast_load=True)
    pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_EXCEPTION']])
    data = pe.__data__
    patterns = []
    if '--wide' not in flags:
        patterns.append(('ascii', needle.encode('utf-8') + (b'\x00' if exact else b'')))
    if '--ascii' not in flags:
        patterns.append(('utf16', needle.encode('utf-16-le') + (b'\x00\x00' if exact else b'')))
    targets = {}
    for kind, pattern in patterns:
        start = 0
        while True:
            index = data.find(pattern, start)
            if index < 0:
                break
            start = index + 1
            if exact:
                unit = 1 if kind == 'ascii' else 2
                if index >= unit and data[index - unit:index] != b'\x00' * unit:
                    continue
            try:
                rva = pe.get_rva_from_offset(index)
            except Exception:
                continue
            targets[rva] = kind
    functions = sorted((entry.struct.BeginAddress, entry.struct.EndAddress) for entry in getattr(pe, 'DIRECTORY_ENTRY_EXCEPTION', []))
    starts = [item[0] for item in functions]

    def containing(rva):
        position = bisect.bisect_right(starts, rva) - 1
        if position >= 0 and functions[position][0] <= rva < functions[position][1]:
            return functions[position]
        return None

    result = {'image': path, 'timestamp': hex(pe.FILE_HEADER.TimeDateStamp), 'needle': needle, 'strings': [], 'references': []}
    for rva, kind in sorted(targets.items()):
        result['strings'].append({'rva': hex(rva), 'encoding': kind})
    if targets:
        for section in pe.sections:
            if not section.Characteristics & 0x20000000:
                continue
            base = section.VirtualAddress
            code = section.get_data()
            view = memoryview(code)
            # lea r64, [rip+disp32] : 48/4C 8D modrm(00 reg 101) disp32 ; also mov r64,[rip+disp] is not a string load
            position = 0
            end = len(code) - 7
            while position < end and len(result['references']) < limit * 4:
                position = code.find(b'\x8d', position)
                if position < 0 or position >= end:
                    break
                prefix = code[position - 1] if position else 0
                modrm = code[position + 1]
                if prefix in (0x48, 0x4c) and (modrm & 0xc7) == 0x05:
                    disp = struct.unpack_from('<i', view, position + 2)[0]
                    target = base + position + 6 + disp
                    if target in targets:
                        instruction = base + position - 1
                        function = containing(instruction)
                        result['references'].append({'instruction': hex(instruction), 'string': hex(target), 'encoding': targets[target],
                            'function': hex(function[0]) if function else None,
                            'functionSize': function[1] - function[0] if function else None})
                position += 1
    result['references'] = result['references'][:limit]
    # Indirect use: a data slot that stores the string address, read by RIP-relative mov/lea/cmp.
    base_address = pe.OPTIONAL_HEADER.ImageBase
    slots = {}
    for rva in targets:
        needle_pointer = struct.pack('<Q', base_address + rva)
        start = 0
        while True:
            index = data.find(needle_pointer, start)
            if index < 0:
                break
            start = index + 1
            try:
                slots[pe.get_rva_from_offset(index)] = rva
            except Exception:
                continue
    result['pointerSlots'] = [{'slot': hex(slot), 'string': hex(target)} for slot, target in sorted(slots.items())]
    result['slotReferences'] = []
    if slots:
        for section in pe.sections:
            if not section.Characteristics & 0x20000000:
                continue
            base = section.VirtualAddress
            code = section.get_data()
            view = memoryview(code)
            end = len(code) - 7
            for opcode in (bytes([0x8b]), bytes([0x8d]), bytes([0x3b]), bytes([0x39])):
                position = 0
                while position < end and len(result['slotReferences']) < limit * 2:
                    position = code.find(opcode, position)
                    if position < 0 or position >= end:
                        break
                    prefix = code[position - 1] if position else 0
                    modrm = code[position + 1]
                    if prefix in (0x48, 0x4c) and (modrm & 0xc7) == 0x05:
                        disp = struct.unpack_from('<i', view, position + 2)[0]
                        target = base + position + 6 + disp
                        if target in slots:
                            instruction = base + position - 1
                            function = containing(instruction)
                            result['slotReferences'].append({'instruction': hex(instruction), 'slot': hex(target),
                                'function': hex(function[0]) if function else None,
                                'functionSize': function[1] - function[0] if function else None})
                    position += 1
    print(json.dumps(result, indent=1))


if __name__ == '__main__':
    main()
