"""Bounded, disk-only MIDI Remote loader disassembly for the installed host."""
import argparse
import bisect
import struct
from pathlib import Path

import capstone
import pefile

TARGETS = {
    "load_scripts": 0x264B4E0,
    "load_script_file": 0x2674FE0,
    "script_callback": 0x2619A00,
    "loader_construct": 0x2673740,
    "system_construct": 0x25E99D0,
    "system_getter": 0x262DF50,
    "script_error": 0x26749A0,
}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", choices=TARGETS, required=True)
    ap.add_argument("--module", type=Path, default=Path(
        r"C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe"))
    args = ap.parse_args()
    pe = pefile.PE(str(args.module), fast_load=True)
    section = next(s for s in pe.sections if s.Name.startswith(b".pdata"))
    data = section.get_data()
    functions = sorted(x for x in struct.iter_unpack("<III", data[:len(data)//12*12])
                       if x[0] and x[1] > x[0])
    starts = [f[0] for f in functions]
    address = TARGETS[args.target]
    begin, end, _ = functions[bisect.bisect_right(starts, address)-1]
    if not begin <= address < end:
        raise ValueError("No runtime-function range for selected target")
    base = pe.OPTIONAL_HEADER.ImageBase
    decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    decoder.detail = True
    print(f"function {begin:#x}..{end:#x}")
    for ins in decoder.disasm(pe.get_data(begin, end-begin), base+begin):
        suffix = ""
        for op in ins.operands:
            if op.type == capstone.x86.X86_OP_MEM and op.mem.base == capstone.x86.X86_REG_RIP:
                target = ins.address+ins.size+op.mem.disp-base
                try:
                    raw = pe.get_data(target, 80).split(b"\0", 1)[0]
                    if 3 <= len(raw) <= 79 and all(32 <= x < 127 for x in raw):
                        suffix = f" ; {target:#x} {raw.decode('ascii')}"
                except pefile.PEFormatError:
                    pass
        print(f"{ins.address-base:#x} {ins.mnemonic} {ins.op_str}{suffix}")

if __name__ == "__main__":
    main()
