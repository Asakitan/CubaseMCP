"""Bounded static disassembly of the installed DAWproject filter.

Reads PE bytes only; requires pefile and capstone. Does not invoke the filter,
connect to Cubase, open projects or create extraction files.
"""
from pathlib import Path
import capstone
import pefile

PATH = Path(r"C:\Program Files\Steinberg\Cubase 16\Components\Filters\dawproject.dll")
RANGES = {
    "package-manager-factory": (0x1AF50, 0x1AF89),
    "package-manager-ctor": (0x41720, 0x41750),
    "service-entry": (0x1C7C0, 0x1C970),
    "service-path-to-package": (0x1CB54, 0x1CBCE),
    "client-and-path-setup": (0x1C970, 0x1CB54),
    "package-client-constructor": (0x42E40, 0x42EB0),
    "package-client-path-lookup": (0x43050, 0x430C9),
    "package-calls-client": (0x41F06, 0x41F32),
    "package-open-head": (0x41B10, 0x41C40),
    "package-project-xml": (0x41C40, 0x41D1F),
    "package-open-tail": (0x42658, 0x426D3),
    "host-project-ctor": (0x1E000, 0x1E1BD),
    "import-head": (0x1F710, 0x1F856),
}


def main():
    pe = pefile.PE(str(PATH), fast_load=True)
    if pe.FILE_HEADER.Machine != 0x8664 or pe.FILE_HEADER.TimeDateStamp != 0x69E0F9BD:
        raise SystemExit("Unexpected DAWproject filter build; fixed offsets are invalid.")
    cs = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    base = pe.OPTIONAL_HEADER.ImageBase
    print(f"PE timestamp={pe.FILE_HEADER.TimeDateStamp:#x} image_base={base:#x}")
    for name, (start, end) in RANGES.items():
        print(f"\n{name} {start:#x}..{end:#x}")
        for ins in cs.disasm(pe.get_data(start, end - start), base + start):
            print(f"{ins.address-base:#x} {ins.mnemonic} {ins.op_str}")


if __name__ == "__main__":
    main()
