"""Bounded on-disk MIDI Remote detection disassembly for Cubase 16.0.5."""
import argparse
import runpy
import sys
from pathlib import Path
import pefile

TARGETS = {
    "schedule": 0x2623970,
    "detection_callback": 0x26004F0,
    "host_environment_constructor": 0x301B6B0,
    "host_input_constructor": 0x301C7D0,
    "host_output_constructor": 0x301C9E0,
    "input_pair_helper": 0x25BB870,
    "output_pair_helper": 0x25BB9F0,
    "candidate_match": 0x25DBC10,
    "prepared_execution": 0x2638280,
}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=TARGETS, required=True)
    parser.add_argument("--module", type=Path, default=Path(
        r"C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe"))
    args = parser.parse_args()
    pe = pefile.PE(str(args.module), fast_load=True)
    if pe.FILE_HEADER.Machine != 0x8664 or pe.FILE_HEADER.TimeDateStamp != 0x6ADF121B:
        raise SystemExit("Unexpected executable build; fixed offsets are invalid.")
    module = runpy.run_path(str(Path(__file__).with_name("midi-device-state-inspect.py")))
    module["main"].__globals__["FUNCTIONS"]["ports_target"] = TARGETS[args.target]
    sys.argv = [sys.argv[0], "--function", "ports_target", "--module", str(args.module)]
    module["main"]()

if __name__ == "__main__":
    main()
