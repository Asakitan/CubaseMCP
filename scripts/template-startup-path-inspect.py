"""Print build-profiled, file-only OpenFile action argument evidence."""
from pathlib import Path
import capstone
import pefile
P = Path(r"C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe")
p = pefile.PE(str(P), fast_load=True)
if (p.FILE_HEADER.Machine != 0x8664 or p.FILE_HEADER.TimeDateStamp != 0x6ADF121B
        or p.OPTIONAL_HEADER.ImageBase != 0x140000000):
    raise RuntimeError("Unexpected executable profile")
for rva, value in [(0x42EDEC0, b"OpenFile\0"), (0x41B2218, b"Path\0"), (0x42EDED0, b"ProjectDir\0")]:
    if p.get_data(rva, len(value)) != value:
        raise RuntimeError(f"Unexpected literal at {rva:#x}")
    print(f"{rva:#x}: {value!r}")
cs = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
b = p.OPTIONAL_HEADER.ImageBase
p.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_EXCEPTION"]])
begins = {entry.struct.BeginAddress for entry in p.DIRECTORY_ENTRY_EXCEPTION}
for start, end in [(0x2900AA0, 0x2900C00), (0x1D53BB0, 0x1D53C7F)]:
    if start not in begins:
        raise RuntimeError(f"Missing runtime-function begin at {start:#x}")
    print(f"\n{start:#x}..{end:#x}")
    for i in cs.disasm(p.get_data(start, end-start), b+start):
        print(f"{i.address-b:#x} {i.mnemonic} {i.op_str}")
