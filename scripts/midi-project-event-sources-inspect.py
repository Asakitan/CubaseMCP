"""Disk-only, bounded Cubase project event source disassembly."""
from pathlib import Path
import capstone
import pefile

PATH = Path(r"C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe")
RANGES = {
    "independent-removal-caller": (0x1CF4AB3, 0x1CF4ACB),
    "independent-removal-gate": (0x279E390, 0x279E3ED),
    "independent-removal-notify": (0x279E446, 0x279E4B5),
    "independent-removal-root-clear": (0x279E51D, 0x279E5C2),
    "activate-project-command": (0x1D1E1D6, 0x1D1E214),
    "root-selector-check": (0x279E640, 0x279E697),
    "old-root-notify": (0x279E755, 0x279E7AA),
    "new-root-notify": (0x279E95E, 0x279E9AB),
    "selector-caller-1": (0x1A32391, 0x1A323C6),
    "selector-caller-2": (0x1A79893, 0x1A798B7),
    "selector-caller-3": (0x1D144D0, 0x1D14503),
    "selector-caller-4": (0x1D39CE6, 0x1D39D1E),
    "selector-caller-5": (0x1D43936, 0x1D4395C),
    "selector-caller-6": (0x1D50960, 0x1D5097E),
}

def main():
    pe = pefile.PE(str(PATH), fast_load=True)
    if (pe.FILE_HEADER.Machine != 0x8664 or
        pe.FILE_HEADER.TimeDateStamp != 0x6ADF121B or
        pe.OPTIONAL_HEADER.ImageBase != 0x140000000):
        raise RuntimeError("Installed Cubase PE does not match the fixed x64 profile")
    decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    base = pe.OPTIONAL_HEADER.ImageBase
    print("ActivateProject string:", pe.get_data(0x42E0650, 16).split(b"\0")[0].decode("ascii"))
    for name, (start, end) in RANGES.items():
        print(f"\n{name} {start:#x}..{end:#x}")
        for ins in decoder.disasm(pe.get_data(start, end-start), base+start):
            print(f"{ins.address-base:#x} {ins.mnemonic} {ins.op_str}")

if __name__ == "__main__":
    main()
