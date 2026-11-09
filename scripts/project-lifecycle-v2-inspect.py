"""Read-only bounded xref and call-site evidence for project lifecycle leads.

Requires diagnostic pefile/capstone. RVAs are specific to Cubase AI 16.0.5;
output is evidence for further tracing, not a supported callable interface.
"""
import bisect
import re
import struct
from pathlib import Path

import capstone
import pefile

PATH = Path(r"C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe")
TARGETS = {
    0x4265458: "CreateNewProject",
    0x44B4AC8: "openProject",
    0x471FDF0: "CreateDocument",
    0x471FE00: "SaveDocument",
}


def main():
    pe = pefile.PE(str(PATH))
    base = pe.OPTIONAL_HEADER.ImageBase
    ranges = sorted((x.struct.BeginAddress, x.struct.EndAddress)
                    for x in pe.DIRECTORY_ENTRY_EXCEPTION)
    starts = [x[0] for x in ranges]
    cs = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    for s in pe.sections:
        if not s.Characteristics & 0x20000000:
            continue
        raw = s.get_data()
        for m in re.finditer(rb"[\x48\x4c][\x8b\x8d][\x05\x0d\x15\x1d\x25\x2d\x35\x3d]....", raw, re.DOTALL):
            site = s.VirtualAddress + m.start()
            target = site + 7 + struct.unpack_from("<i", raw, m.start() + 3)[0]
            if target not in TARGETS:
                continue
            idx = bisect.bisect_right(starts, site) - 1
            if idx < 0 or site >= ranges[idx][1]:
                continue
            begin, end = ranges[idx]
            print(f"{TARGETS[target]} target={target:#x} site={site:#x} function={begin:#x}..{end:#x}")
            code = pe.get_data(begin, min(end - begin, 65536))
            instructions = list(cs.disasm(code, base + begin))
            at = next((i for i, x in enumerate(instructions) if x.address - base == site), None)
            if at is None:
                print("  Not aligned in decoded function; candidate discarded.")
                continue
            for ins in instructions[max(0, at-12):at+18]:
                print(f"  {ins.address-base:#x} {ins.mnemonic} {ins.op_str}")
    # These are evidence for the derived application dispatch targets, not
    # callable contracts. Show the PCubaseApplication primary vtable entries.
    vtable = 0x45D07A0
    for offset in (0x168, 0x170, 0x178, 0x1C0, 0x1C8):
        target = struct.unpack("<Q", pe.get_data(vtable + offset, 8))[0] - base
        print(f"PCubaseApplication vtable+{offset:#x} -> {target:#x}")
    for target, size in ((0x15CB310, 3), (0x1D53BB0, 0x180),
                         (0x3B15E70, 0xDD), (0x3B15290, 0x160),
                         (0x3B16D30, 0x60), (0x3B7F020, 0x64),
                         (0x354E2B0, 0xC0), (0x15F69B8, 0x2E),
                         (0x36CC5F4, 0x16B), (0x36CC89E, 0x90),
                         (0x1D57900, 0xC6), (0x1D579D0, 0x200),
                         (0x1D3A220, 0x1E3), (0x15F5DE0, 5),
                         (0x363A900, 0x23), (0x363A260, 0xAE),
                         (0x3A88320, 0x40), (0x3A889A0, 0x1B),
                         (0x1CA28E0, 0x49), (0x15F5E30, 5),
                         (0x1C834E0, 0xCD), (0x1D230A0, 0x384),
                         (0x3B89C10, 0x85), (0x2DCCA80, 0x22),
                         (0x1D58532, 0x127), (0x1D58D4B, 0x99),
                         (0x3B234C0, 0x2F)):
        print(f"\nmethod {target:#x}")
        for ins in cs.disasm(pe.get_data(target, size), base + target):
            print(f"  {ins.address-base:#x} {ins.mnemonic} {ins.op_str}")


if __name__ == "__main__":
    main()
