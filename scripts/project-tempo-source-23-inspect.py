"""Inspect the fixed installed DAWproject parser-to-tempo data flow on disk only."""

from pathlib import Path
import struct

import capstone
import pefile


PATH = Path(r"C:\Program Files\Steinberg\Cubase 16\Components\Filters\dawproject.dll")
WINDOWS = (
    (0x41B10, 0x41D00, 0x41D4A),
    (0x41B10, 0x424CF, 0x42516),
    (0x4DB70, 0x4DE18, 0x4DF49),
    (0x4DB70, 0x4E0F0, 0x4E195),
    (0x43240, 0x43240, 0x432A3),
    (0x43ED0, 0x43ED0, 0x43F13),
    (0x45BE0, 0x45BE0, 0x45C21),
    (0x1F710, 0x1F9D3, 0x1FA16),
    (0x39200, 0x39200, 0x39258),
)
LEAVES = {
    0x456F0: bytes.fromhex("48 8b 51 58 33 c9 48 85 d2 48 8d 82 b8 00 00 00 48 0f 44 c1 c3"),
    0x435B0: bytes.fromhex("f2 0f 11 49 08 c3"),
    0x3B4E0: bytes.fromhex("f2 0f 10 41 08 c3"),
}


def main():
    pe = pefile.PE(str(PATH))
    if (pe.FILE_HEADER.Machine, pe.FILE_HEADER.TimeDateStamp, pe.OPTIONAL_HEADER.ImageBase) != (
        0x8664, 0x69E0F9BD, 0x180000000
    ):
        raise RuntimeError("Unexpected DAWproject filter profile")
    for rva, expected in ((0x1076F8, b"Transport\0"), (0x100B70, b"Tempo\0"),
                          (0x107704, b"value\0"), (0x10770C, b"min\0"), (0x107710, b"max\0")):
        if pe.get_data(rva, len(expected)) != expected:
            raise RuntimeError(f"Unexpected literal at {rva:#x}")
        print(f"literal {rva:#x} {expected[:-1].decode('ascii')}")
    for rva, expected in ((0x1064E0, 120.0), (0x101CB8, 10.0), (0x101CC8, 300.0)):
        actual = struct.unpack("<d", pe.get_data(rva, 8))[0]
        if actual != expected:
            raise RuntimeError(f"Unexpected floating-point constant at {rva:#x}")
        print(f"constant {rva:#x} {actual}")
    for vtable, offset, name in ((0x105690, 0, b".?AVDPParameter@Steinberg@@"),
                                 (0x105708, 0x10, b".?AVDPParameter@Steinberg@@"),
                                 (0x105740, 0xB8, b".?AVDPParameter@Steinberg@@"),
                                 (0x105DA0, 0x10, b".?AVDPProject@Steinberg@@")):
        col = pe.get_qword_at_rva(vtable - 8) - pe.OPTIONAL_HEADER.ImageBase
        signature, actual_offset, _, type_rva, _, self_rva = struct.unpack("<6I", pe.get_data(col, 24))
        actual_name = pe.get_data(type_rva + 16, len(name) + 1)
        if (signature, actual_offset, self_rva, actual_name) != (1, offset, col, name + b"\0"):
            raise RuntimeError(f"Unexpected RTTI at vtable {vtable:#x}")
        print(f"rtti {vtable:#x} offset={offset:#x} {name.decode('ascii')}")
    for vtable, slot, target in ((0x105740, 0x20, 0x3B4E0), (0x105740, 0x58, 0x435B0),
                                  (0x105DA0, 0x38, 0x456F0)):
        if pe.get_qword_at_rva(vtable + slot) - pe.OPTIONAL_HEADER.ImageBase != target:
            raise RuntimeError(f"Unexpected vtable slot at {vtable + slot:#x}")
        print(f"vtable {vtable:#x}+{slot:#x} -> {target:#x}")
    for address, expected in LEAVES.items():
        if pe.get_data(address, len(expected)) != expected:
            raise RuntimeError(f"Unexpected leaf bytes at {address:#x}")
    decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    print(f"profile machine=0x8664 timestamp=0x69e0f9bd image_base={pe.OPTIONAL_HEADER.ImageBase:#x}")
    for function, start, end in WINDOWS:
        entry = next((item.struct for item in pe.DIRECTORY_ENTRY_EXCEPTION
                      if item.struct.BeginAddress == function), None)
        if entry is None or not (function <= start < end <= entry.EndAddress):
            raise RuntimeError(f"Unexpected runtime function bounds for {function:#x}")
        print(f"\nfunction {function:#x}, window {start:#x}..{end:#x}")
        for instruction in decoder.disasm(pe.get_data(function, end - function), function):
            if start <= instruction.address < end:
                print(f"{instruction.address:#x} {instruction.bytes.hex()} {instruction.mnemonic} {instruction.op_str}")
    for address, expected in LEAVES.items():
        print(f"\nleaf {address:#x}")
        for instruction in decoder.disasm(expected, address):
            print(f"{instruction.address:#x} {instruction.bytes.hex()} {instruction.mnemonic} {instruction.op_str}")


if __name__ == "__main__":
    main()
