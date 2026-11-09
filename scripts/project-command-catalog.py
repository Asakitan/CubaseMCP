"""Extract bounded disassembly and string references for project command handlers."""
import argparse
import bisect
import json
import struct
from pathlib import Path

import capstone
import pefile

HANDLERS = {
    "dispatch": 0x23730,
    "export_mix": 0x222E0,
    "create_tracks": 0x208F0,
    "transport": 0x24EB0,
    "locators": 0x24A30,
    "get_musical_track": 0x22D50,
    "response": 0x1E2D0,
    "track_response": 0x26360,
}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--module", type=Path, default=Path(
        r"C:\Program Files\Steinberg\Cubase 16\Components\projectplugin.dll"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    pe = pefile.PE(str(args.module), fast_load=True)
    pdata = next(s for s in pe.sections if s.Name.startswith(b".pdata")).get_data()
    funcs = sorted(x for x in struct.iter_unpack("<III", pdata[:len(pdata)//12*12])
                   if x[0] and x[1] > x[0])
    starts = [x[0] for x in funcs]
    decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    decoder.detail = True
    base = pe.OPTIONAL_HEADER.ImageBase
    report = {}
    for name, addr in HANDLERS.items():
        fn = funcs[bisect.bisect_right(starts, addr)-1]
        if not fn[0] <= addr < fn[1]:
            raise ValueError(f"Missing function extent: {name}")
        instructions, refs = [], []
        for ins in decoder.disasm(pe.get_data(fn[0], fn[1]-fn[0]), base+fn[0]):
            line = f"{ins.address-base:#x} {ins.mnemonic} {ins.op_str}"
            instructions.append(line)
            for op in ins.operands:
                if op.type != capstone.x86.X86_OP_MEM or op.mem.base != capstone.x86.X86_REG_RIP:
                    continue
                target = ins.address + ins.size + op.mem.disp - base
                if not 0x31F00 <= target < 0x33F00:
                    continue
                raw = pe.get_data(target, 100).split(b"\0", 1)[0]
                if len(raw) >= 3 and all(32 <= c < 127 for c in raw):
                    refs.append({"site": hex(ins.address-base), "rva": hex(target),
                                 "text": raw.decode("ascii")})
        report[name] = {"start": hex(fn[0]), "end": hex(fn[1]),
                        "references": refs, "instructions": instructions}
    with args.output.open("x", encoding="utf-8") as out:
        json.dump(report, out, indent=2)
    for name, item in report.items():
        print(name, item["start"], item["end"],
              ", ".join(dict.fromkeys(x["text"] for x in item["references"])))

if __name__ == "__main__":
    main()
