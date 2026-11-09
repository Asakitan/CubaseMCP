"""Print bounded static evidence for Cubase AI 16.0.5 component admission.

Reads the executable on disk only. Requires pefile and capstone. No process
connection, component loading, initialization, or feature state modification.
"""
from pathlib import Path
import capstone
import pefile

PATH = Path(r"C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe")
RANGES = {
    "component-checker-query": (0x1ABCD10, 0x1ABCD89),
    "component-checker-getter": (0x1D3A030, 0x1D3A0C9),
    "checker-data-source": (0x2F36F62, 0x2F36F85),
    "checker-check": (0x39B36D0, 0x39B377D),
    "checker-set-data": (0x39B3780, 0x39B378D),
    "host-component-lookup": (0x1DD04C2, 0x1DD04FB),
    "manager-lookup": (0x3AA5D80, 0x3AA5DC0),
}


def main():
    pe = pefile.PE(str(PATH), fast_load=True)
    base = pe.OPTIONAL_HEADER.ImageBase
    cs = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    for name, (start, end) in RANGES.items():
        print(f"\n{name} {start:#x}..{end:#x}")
        for ins in cs.disasm(pe.get_data(start, end - start), base + start):
            print(f"{ins.address-base:#x} {ins.mnemonic} {ins.op_str}")


if __name__ == "__main__":
    main()
