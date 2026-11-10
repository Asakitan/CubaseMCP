"""Bounded, file-only x64 function inspection of the fixed Cubase host.

Examples:
  python scripts/inspect-host-functions31.py --callers 0x213e410
  python scripts/inspect-host-functions31.py --disasm 0x1a7fa30 --limit 100
No process access or binary modifications are performed.
"""
import argparse
import bisect
import json
import struct
from pathlib import Path

import capstone
import pefile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--module', type=Path, default=Path(r'C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe'))
    parser.add_argument('--callers', nargs='*', default=[])
    parser.add_argument('--disasm', nargs='*', default=[])
    parser.add_argument('--limit', type=int, default=160)
    parser.add_argument('--context', type=int, default=0)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if not 1 <= args.limit <= 2000:
        parser.error('--limit must be 1..2000')
    if not 0 <= args.context <= 16:
        parser.error('--context must be 0..16')
    if args.output and args.output.exists():
        parser.error('output already exists')
    pe = pefile.PE(str(args.module), fast_load=True)
    if pe.FILE_HEADER.Machine != 0x8664:
        parser.error('an x64 image is required')
    pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_EXCEPTION']])
    base = pe.OPTIONAL_HEADER.ImageBase
    functions = sorted((e.struct.BeginAddress, e.struct.EndAddress) for e in getattr(pe, 'DIRECTORY_ENTRY_EXCEPTION', []))
    starts = [f[0] for f in functions]

    def containing(rva):
        index = bisect.bisect_right(starts, rva) - 1
        return functions[index] if index >= 0 and functions[index][0] <= rva < functions[index][1] else None

    disassembler = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    disassembler.detail = True
    decoded = {}

    def instructions(bounds):
        if bounds not in decoded:
            start, end = bounds
            if not 0 < end - start <= 512 * 1024:
                raise ValueError('runtime function exceeds the diagnostic bound')
            section = pe.get_section_by_rva(start)
            if section is None or end > section.VirtualAddress + section.SizeOfRawData:
                raise ValueError('runtime function is not wholly file backed')
            decoded[bounds] = list(disassembler.disasm(pe.get_data(start, end - start), base + start))
        return decoded[bounds]

    targets = {int(value, 0) for value in args.callers}
    candidates = {}
    for section in pe.sections:
        if not targets or not section.Characteristics & 0x20000000:
            continue
        data = section.get_data()
        for opcode in (b'\xe8', b'\xe9'):
            position = 0
            while True:
                position = data.find(opcode, position)
                if position < 0 or position + 5 > len(data):
                    break
                site = section.VirtualAddress + position
                target = site + 5 + struct.unpack_from('<i', data, position + 1)[0]
                if target in targets:
                    bounds = containing(site)
                    if bounds:
                        candidates.setdefault(bounds, set()).add(site)
                position += 1
    callers = []
    for bounds, sites in sorted(candidates.items()):
        decoded_instructions = instructions(bounds)
        for instruction_index, ins in enumerate(decoded_instructions):
            rva = ins.address - base
            if rva not in sites or ins.mnemonic not in ('call', 'jmp') or not ins.operands:
                continue
            operand = ins.operands[0]
            if operand.type != capstone.x86_const.X86_OP_IMM or operand.imm - base not in targets:
                continue
            caller = {'site': hex(rva), 'target': hex(operand.imm - base),
                      'function': hex(bounds[0]), 'size': bounds[1] - bounds[0]}
            if args.context:
                context = decoded_instructions[max(0, instruction_index - args.context):
                                               instruction_index + args.context + 1]
                caller['instructions'] = [f'{nearby.address-base:#x} {nearby.mnemonic} {nearby.op_str}'
                                          for nearby in context]
            callers.append(caller)
    listings = []
    for value in args.disasm:
        address = int(value, 0)
        bounds = containing(address)
        if not bounds:
            listings.append({'requested': hex(address), 'error': 'no runtime-function boundary'})
            continue
        selected = [i for i in instructions(bounds) if i.address - base >= address]
        listings.append({'requested': hex(address), 'function': hex(bounds[0]), 'end': hex(bounds[1]),
                         'truncated': len(selected) > args.limit,
                         'instructions': [f'{i.address-base:#x} {i.mnemonic} {i.op_str}' for i in selected[:args.limit]]})
    result = {'module': str(args.module), 'timestamp': hex(pe.FILE_HEADER.TimeDateStamp),
              'imageBase': hex(base), 'callers': callers[:args.limit], 'callersTruncated': len(callers) > args.limit,
              'listings': listings}
    text = json.dumps(result, indent=2)
    if args.output:
        with args.output.open('x', encoding='utf-8') as output:
            output.write(text + '\n')
    print(text)


if __name__ == '__main__':
    main()