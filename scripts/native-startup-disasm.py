"""Print selected static Cubase startup decision and path routines."""
import argparse
from pathlib import Path

import capstone
import pefile

RANGES = {
    "decision": (0x1D55453, 0x1D554D6),
    "markers": (0x3AC5810, 0x3AC590E),
    "marker_path": (0x3B0E120, 0x3B0E3F2),
    "modifier_keys": (0x39354D0, 0x393554A),
}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--range", choices=RANGES, required=True)
    parser.add_argument("--module", type=Path, default=Path(
        r"C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe"))
    args = parser.parse_args()
    pe = pefile.PE(str(args.module), fast_load=True)
    begin, end = RANGES[args.range]
    base = pe.OPTIONAL_HEADER.ImageBase
    decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    for ins in decoder.disasm(pe.get_data(begin, end - begin), base + begin):
        print(f"{ins.address - base:#x} {ins.mnemonic} {ins.op_str}")

if __name__ == "__main__":
    main()
