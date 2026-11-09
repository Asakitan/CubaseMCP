"""Disk-only bounded disassembly for the Cubase 16.0.5 MIDI detector predicate.

Requires pefile and capstone. This script never opens or modifies a process.
The fixed RVAs describe one build; they are not an externally callable API.
"""
import argparse
import runpy
import sys
from pathlib import Path

import capstone
import pefile

TARGETS = {
    "caller": 0x263B7F0,
    "prepared_execute": 0x2638280,
    "prepare_command": 0x26383D0,
    "loader_singleton": 0x2673740,
    "driver_path_lookup": 0x2672D90,
    "predicate": 0x26739A0,
    "set_singleton": 0x26735D0,
    "set_load": 0x2674AC0,
    "set_toggle": 0x2679A10,
    "set_save": 0x26762A0,
    "path_object_copy": 0x3B0ECD0,
}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["thunk"] + list(TARGETS), required=True)
    parser.add_argument("--module", type=Path, default=Path(
        r"C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe"))
    args = parser.parse_args()
    pe = pefile.PE(str(args.module), fast_load=True)
    if pe.FILE_HEADER.Machine != 0x8664 or pe.FILE_HEADER.TimeDateStamp != 0x6ADF121B:
        raise SystemExit("Unexpected executable build; do not use these RVAs.")
    if args.target == "thunk":
        decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
        base = pe.OPTIONAL_HEADER.ImageBase
        for instruction in decoder.disasm(pe.get_data(0x2672F00, 5), base + 0x2672F00):
            print(f"{instruction.address-base:#x} {instruction.mnemonic} {instruction.op_str}")
        return
    existing = runpy.run_path(str(Path(__file__).with_name("midi-device-state-inspect.py")))
    existing["main"].__globals__["FUNCTIONS"]["predicate_target"] = TARGETS[args.target]
    sys.argv = [sys.argv[0], "--function", "predicate_target", "--module", str(args.module)]
    existing["main"]()

if __name__ == "__main__":
    main()
