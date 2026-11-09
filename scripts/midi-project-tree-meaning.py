"""Print bounded on-disk disassembly of project informer consumers."""
import argparse
import runpy
import sys
from pathlib import Path
import pefile

TARGETS = {"insert": 0x25B17F0, "remove": 0x25B1A30,
           "remove_other": 0x25B1B50, "invalidate": 0x25AFA20,
           "idle": 0x25AF940}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", required=True, choices=TARGETS)
    parser.add_argument("--module", type=Path, default=Path(
        r"C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe"))
    args = parser.parse_args()
    pe = pefile.PE(str(args.module), fast_load=True)
    if pe.FILE_HEADER.Machine != 0x8664 or pe.FILE_HEADER.TimeDateStamp != 0x6ADF121B:
        raise SystemExit("Unexpected executable build; fixed offsets are invalid.")
    module = runpy.run_path(str(Path(__file__).with_name("midi-device-state-inspect.py")))
    module["main"].__globals__["FUNCTIONS"]["project_tree"] = TARGETS[args.target]
    sys.argv = [sys.argv[0], "--function", "project_tree", "--module", str(args.module)]
    module["main"]()

if __name__ == "__main__":
    main()
