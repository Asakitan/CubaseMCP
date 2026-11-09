"""Inspect build-specific project-save alert resolution without opening a process."""
from pathlib import Path
import capstone
import pefile

PATH = Path(r"C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe")
RANGES = {
    "save-error-alert-call": (0x1D566E0, 0x1D56760),
    "alert-default-factory": (0x3AD5EE0, 0x3AD6045),
    "alert-provider-getter": (0x3AD6050, 0x3AD6155),
    "null-alert-method": (0x3AD6690, 0x3AD66E0),
}


def main():
    pe = pefile.PE(str(PATH), fast_load=True)
    if (pe.FILE_HEADER.Machine, pe.FILE_HEADER.TimeDateStamp, pe.OPTIONAL_HEADER.ImageBase) != (
        0x8664, 0x6ADF121B, 0x140000000
    ):
        raise RuntimeError("Installed Cubase PE does not match the fixed x64 profile")
    name = pe.get_data(0x5521C58, 15).split(b"\0", 1)[0]
    if name != b"Alert::IDialog":
        raise RuntimeError("Expected alert interface name was not found")
    print("Interface:", name.decode("ascii"))
    decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    base = pe.OPTIONAL_HEADER.ImageBase
    for label, (start, end) in RANGES.items():
        print(f"\n{label} {start:#x}..{end:#x}")
        for instruction in decoder.disasm(pe.get_data(start, end - start), base + start):
            print(f"{instruction.address - base:#x} {instruction.mnemonic} {instruction.op_str}")


if __name__ == "__main__":
    main()
