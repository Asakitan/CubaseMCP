"""Bounded static disassembly of registry/context methods in the installed host."""
import argparse
from pathlib import Path

import capstone
import pefile


RANGES = {
    "register": (0x3AA3230, 0x3AA3283),
    "singleton": (0x3AA5890, 0x3AA593F),
    "register_item": (0x3AD8100, 0x3AD8157),
    "container_query": (0x3AA8620, 0x3AA86A0),
    "vst_query": (0x201AB00, 0x201ABB6),
    "manager_constructor": (0x3A9FFA0, 0x3AA008F),
    "host_query": (0x1DD03E0, 0x1DD0477),
    "module_factory": (0x3ABA9A0, 0x3ABAA77),
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--module", type=Path, default=Path(
        r"C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe"))
    parser.add_argument("--range", choices=RANGES, required=True)
    args = parser.parse_args()
    pe = pefile.PE(str(args.module), fast_load=True)
    begin, end = RANGES[args.range]
    image_base = pe.OPTIONAL_HEADER.ImageBase
    decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    for instruction in decoder.disasm(pe.get_data(begin, end - begin), image_base + begin):
        print(f"{instruction.address - image_base:#x} {instruction.mnemonic} {instruction.op_str}")


if __name__ == "__main__":
    main()
