"""Print bounded host-context provenance from installed PE files; no calls."""
from pathlib import Path
import capstone
import pefile

FILES = {
    Path(r"C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe"): {
        "service-context-query": (0x3752332, 0x375236E),
        "service-lookup": (0x3AB0B90, 0x3AB0C1E),
        "lookup-factory-dispatch": (0x3B8F7D0, 0x3B8F7F5),
        "mproject-registration": (0x146DBA0, 0x146DBDC),
        "mproject-factory": (0x279D950, 0x279D986),
        "mproject-context-getter": (0x279DC30, 0x279DC48),
    },
    Path(r"C:\Program Files\Steinberg\Cubase 16\Components\Filters\dawproject.dll"): {
        "service-host-initialization": (0x1CD30, 0x1CDEA),
        "host-project-initialization": (0x1E0BC, 0x1E142),
        "package-resource-path": (0x41EF1, 0x41FA8),
    },
}


def main():
    decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    for path, ranges in FILES.items():
        pe = pefile.PE(str(path), fast_load=True)
        expected = 0x6ADF121B if path.name.lower() == "cubase 16.exe" else 0x69E0F9BD
        if pe.FILE_HEADER.Machine != 0x8664 or pe.FILE_HEADER.TimeDateStamp != expected:
            raise SystemExit("Unexpected executable build; fixed offsets are invalid.")
        base = pe.OPTIONAL_HEADER.ImageBase
        print(f"\n{path.name}, timestamp={pe.FILE_HEADER.TimeDateStamp:#x}")
        for name, (start, end) in ranges.items():
            print(f"\n{name} {start:#x}..{end:#x}")
            for ins in decoder.disasm(pe.get_data(start, end-start), base+start):
                print(f"{ins.address-base:#x} {ins.mnemonic} {ins.op_str}")


if __name__ == "__main__":
    main()
