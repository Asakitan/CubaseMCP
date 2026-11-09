"""Read-only, build-specific selector call-site inspection; no process access."""
from pathlib import Path
import capstone
import pefile

PATH = Path(r"C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe")
RANGES = {
    "constructed-document-selection": (0x1D50920, 0x1D509B4),
    "selection-with-current-comparison": (0x1D1449C, 0x1D14503),
    "import-selection-success-path": (0x1D39C76, 0x1D39D2C),
    "document-root-selection": (0x1A797C0, 0x1A798B7),
    "selector-equality-fast-path": (0x279E640, 0x279E680),
}

def main():
    pe = pefile.PE(str(PATH), fast_load=True)
    if (pe.FILE_HEADER.Machine, pe.FILE_HEADER.TimeDateStamp, pe.OPTIONAL_HEADER.ImageBase) != (0x8664, 0x6ADF121B, 0x140000000):
        raise RuntimeError("Installed Cubase PE does not match the fixed x64 profile")
    cs = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    base = pe.OPTIONAL_HEADER.ImageBase
    print(f"timestamp={pe.FILE_HEADER.TimeDateStamp:#x}")
    for name, (start, end) in RANGES.items():
        print(f"\n{name} {start:#x}..{end:#x}")
        for ins in cs.disasm(pe.get_data(start, end - start), base + start):
            print(f"{ins.address - base:#x} {ins.mnemonic} {ins.op_str}")

if __name__ == "__main__":
    main()
