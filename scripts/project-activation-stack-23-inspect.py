"""Check fixed-image predecessor calls for the recorded partial stack, without process access."""

from pathlib import Path

import capstone
import pefile


PATH = Path(r"C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe")
# return RVA, preceding call RVA, Capstone operand
FRAMES = (
    (0x1D438B5, 0x1D438B2, "r15"),
    (0x1D53D41, 0x1D53D3C, "0x1d42430"),
    (0x36CBF28, 0x36CBF21, "qword ptr [r9 + 0x178]"),
    (0x1D52E8E, 0x1D52E89, "0x36cbd50"),
    (0x3A8C3FF, 0x3A8C3F9, "qword ptr [rax + 0xb0]"),
    (0x3AAB4AE, 0x3AAB4A9, "0x3a8c220"),
    (0x36752BA, 0x36752B5, "0x3aab410"),
    (0x37B6490, 0x37B648B, "0x3675130"),
)


def main():
    pe = pefile.PE(str(PATH))
    if (pe.FILE_HEADER.Machine, pe.FILE_HEADER.TimeDateStamp, pe.OPTIONAL_HEADER.ImageBase) != (
        0x8664, 0x6ADF121B, 0x140000000
    ):
        raise RuntimeError("Unexpected Cubase image profile")
    for rva, expected in ((0x42EDEC0, b"OpenFile\0"), (0x42EDED0, b"ProjectDir\0"),
                          (0x41B2218, b"Path\0")):
        if pe.get_data(rva, len(expected)) != expected:
            raise RuntimeError(f"Unexpected action literal at {rva:#x}")
        print(f"literal {rva:#x} {expected[:-1].decode('ascii')}")
    decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    for index, (returned, call, operand) in enumerate(FRAMES, start=8):
        entry = next((item.struct for item in pe.DIRECTORY_ENTRY_EXCEPTION
                      if item.struct.BeginAddress <= call < item.struct.EndAddress), None)
        if entry is None or returned >= entry.EndAddress:
            raise RuntimeError(f"Missing containing runtime function for {call:#x}")
        instructions = decoder.disasm(pe.get_data(entry.BeginAddress, returned - entry.BeginAddress), entry.BeginAddress)
        match = next((item for item in instructions if item.address == call), None)
        if not match or match.mnemonic != "call" or match.op_str != operand or match.address + match.size != returned:
            raise RuntimeError(f"Unexpected predecessor instruction for frame {index}")
        print(f"frame={index} return={returned:#x} function={entry.BeginAddress:#x}..{entry.EndAddress:#x} "
              f"call={call:#x} bytes={match.bytes.hex()} operand={operand}")


if __name__ == "__main__":
    main()
