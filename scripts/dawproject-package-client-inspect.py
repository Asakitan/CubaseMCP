"""Print bounded static package/client evidence; no module or process calls."""
from pathlib import Path
import capstone
import pefile

PATH = Path(r"C:\Program Files\Steinberg\Cubase 16\Components\Filters\dawproject.dll")
RANGES = {
    "package-construction": (0x424CF, 0x42516),
    "package-object-ctor": (0x41550, 0x415A1),
    "package-object-destructor": (0x415B0, 0x415F7),
    "package-project-getter": (0xF0A0, 0xF0A5),
    "client-destination-use": (0x41EB8, 0x41FA8),
    "directory-create": (0x945D6, 0x94614),
}


def main():
    pe = pefile.PE(str(PATH), fast_load=True)
    if pe.FILE_HEADER.Machine != 0x8664 or pe.FILE_HEADER.TimeDateStamp != 0x69E0F9BD:
        raise SystemExit("Unexpected DAWproject filter build; fixed offsets are invalid.")
    decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    base = pe.OPTIONAL_HEADER.ImageBase
    print(f"timestamp={pe.FILE_HEADER.TimeDateStamp:#x}")
    for name, (start, end) in RANGES.items():
        print(f"\n{name} {start:#x}..{end:#x}")
        for ins in decoder.disasm(pe.get_data(start, end-start), base+start):
            print(f"{ins.address-base:#x} {ins.mnemonic} {ins.op_str}")


if __name__ == "__main__":
    main()
