"""Bounded, on-disk ActivateProject provenance; starts decoding at PE function begins."""
from pathlib import Path
import struct
import pefile
import capstone

PATH = Path(r"C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe")
RANGES = {
    "arrange-controller": (0x1D1E0C0, 0x1D1E220, ((0x1D1E1D6, 0x1D1E214),)),
    "remote-wheel-constructor": (0x1DDAC80, 0x1DDB575, ((0x1DDB502, 0x1DDB575),)),
    "remote-wheel-handler": (0x1DDE420, 0x1DDE7B8, ((0x1DDE5D1, 0x1DDE622), (0x1DDE6FA, 0x1DDE78D))),
    "remote-wheel-subobject": (0x1DDE820, 0x1DDE878, ((0x1DDE820, 0x1DDE878),)),
    "queue-helper": (0x3A8C770, 0x3A8C8CC, ((0x3A8C83E, 0x3A8C8B6),)),
}

def main():
    pe = pefile.PE(str(PATH))
    base = pe.OPTIONAL_HEADER.ImageBase
    if (pe.FILE_HEADER.Machine, pe.FILE_HEADER.TimeDateStamp, base) != (0x8664, 0x6ADF121B, 0x140000000):
        raise RuntimeError("Installed Cubase PE does not match the fixed x64 profile")
    begins = {e.struct.BeginAddress for e in pe.DIRECTORY_ENTRY_EXCEPTION}
    cs = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    for name, (start, end, spans) in RANGES.items():
        if start not in begins:
            raise RuntimeError(f"{name}: start is not a PE runtime-function begin")
        print(f"\n{name}: decode from {start:#x}")
        for ins in cs.disasm(pe.get_data(start, end-start), base+start):
            addr = ins.address-base
            if any(a <= addr < b for a, b in spans):
                print(f"{addr:#x} {ins.mnemonic} {ins.op_str}")
    for table, slot in ((0x42DDFD8, 0xB0), (0x43076A8, 0xB0), (0x4307940, 0x18)):
        ptr = struct.unpack('<Q', pe.get_data(table+slot, 8))[0]-base
        col = struct.unpack('<Q', pe.get_data(table-8, 8))[0]-base
        sig, _, _, type_rva, _, self_rva = struct.unpack('<6I', pe.get_data(col, 24))
        if sig != 1 or self_rva != col:
            raise RuntimeError("Unexpected RTTI locator")
        name = pe.get_data(type_rva+16, 128).split(b'\0')[0].decode('ascii')
        print(f"table={table:#x} slot={slot:#x} target={ptr:#x} RTTI={name}")
    print("literal:", pe.get_data(0x42E0650, 16).split(b'\0')[0].decode('ascii'))

if __name__ == '__main__':
    main()
