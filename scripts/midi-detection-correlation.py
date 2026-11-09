"""Print bounded on-disk disassembly for the Cubase MIDI correlation paths."""
import argparse
import runpy
import sys
from pathlib import Path
import pefile

TARGETS = {
    "scanner_filter": 0x25AFFF0,
    "scanner_notification": 0x25AF030,
    "idle_gate": 0x25AF940,
    "registry_refresh": 0x25B0A40,
    "observer_registration": 0x25AECD0,
    "port_adapter": 0x2635D80,
    "name_match": 0x25DBC10,
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
    module["main"].__globals__["FUNCTIONS"]["correlation"] = TARGETS[args.target]
    sys.argv = [sys.argv[0], "--function", "correlation", "--module", str(args.module)]
    module["main"]()

if __name__ == "__main__":
    main()
