"""Inspect the fixed save-preflight alert branch without loading Cubase."""
from pathlib import Path
import capstone
import pefile

PATH = Path(r"C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe")
RANGES = {
    "arrangement-save": (0x1D579D0, 0x1D583E1,
                         ((0x1D57FA5, 0x1D581C0), (0x1D5839B, 0x1D583E1))),
}

def main():
    pe = pefile.PE(str(PATH), fast_load=True)
    if (pe.FILE_HEADER.Machine != 0x8664 or pe.FILE_HEADER.TimeDateStamp != 0x6ADF121B
            or pe.OPTIONAL_HEADER.ImageBase != 0x140000000):
        raise RuntimeError("Installed Cubase PE does not match the fixed x64 profile")
    base = pe.OPTIONAL_HEADER.ImageBase
    pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_EXCEPTION"]])
    begins = {entry.struct.BeginAddress for entry in pe.DIRECTORY_ENTRY_EXCEPTION}
    cs = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    for name, (start, end, spans) in RANGES.items():
        if start not in begins:
            raise RuntimeError(f"{name}: missing runtime-function begin")
        print(f"\n{name} (decode from {start:#x})")
        for ins in cs.disasm(pe.get_data(start, end-start), base+start):
            address = ins.address-base
            if any(lo <= address < hi for lo, hi in spans):
                print(f"{address:#x} {ins.mnemonic} {ins.op_str}")

if __name__ == "__main__":
    main()
