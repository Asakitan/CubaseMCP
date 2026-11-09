"""Bounded static lifecycle-dispatch evidence; reads the installed PE only."""
from pathlib import Path
import capstone
import pefile

PATH = Path(r"C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe")
RANGES = {
    "dispatcher-setup": (0x15E7BB0, 0x15E7C29),
    "dispatcher-install": (0x39B3890, 0x39B39AB),
    "dispatcher-shared-object": (0x39B3790, 0x39B383E),
    "dispatcher-constructor": (0x39B3E50, 0x39B3F12),
    "project-request-dispatch": (0x1DD071C, 0x1DD0785),
    "save-existing-dispatch": (0x36CC5F4, 0x36CC6C0),
    "save-existing-call": (0x36CC89E, 0x36CC8FA),
    "save-arrangement-dispatch": (0x1D57900, 0x1D579C6),
    "save-file-open": (0x1D5839B, 0x1D583E1),
    "save-error-and-return": (0x1D58D4B, 0x1D58DE7),
}


def main():
    pe = pefile.PE(str(PATH), fast_load=True)
    if (
        pe.FILE_HEADER.Machine != 0x8664
        or pe.FILE_HEADER.TimeDateStamp != 0x6ADF121B
        or pe.OPTIONAL_HEADER.ImageBase != 0x140000000
    ):
        raise RuntimeError("Installed Cubase PE does not match the fixed x64 profile")
    cs = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    base = pe.OPTIONAL_HEADER.ImageBase
    print(f"timestamp={pe.FILE_HEADER.TimeDateStamp:#x}")
    for name, (start, end) in RANGES.items():
        print(f"\n{name} {start:#x}..{end:#x}")
        for ins in cs.disasm(pe.get_data(start, end-start), base+start):
            print(f"{ins.address-base:#x} {ins.mnemonic} {ins.op_str}")


if __name__ == "__main__":
    main()
