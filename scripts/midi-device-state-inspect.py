"""Bounded disk-only disassembly of MIDI Remote device-model functions."""
import argparse
import bisect
import struct
from pathlib import Path
import capstone
import pefile

FUNCTIONS = {
    "driver_constructor": 0x302DFB0,
    "instance_constructor": 0x3016B60,
    "instance_creator": 0x313C6C0,
    "instance_creator_caller": 0x263B7F0,
    "instance_port_first": 0x3140050,
    "instance_port_second": 0x3140450,
    "instance_port_first_factory": 0x2FF1990,
    "instance_port_second_factory": 0x2FF1D40,
    "system_root_constructor": 0x25E99D0,
    "system_root_load": 0x264B4E0,
    "driver_serialization": 0x31F2430,
    "driver_list_serialization": 0x31F53E0,
    "domain_model_create": 0x30172F0,
    "domain_model_getter": 0x30B3E40,
    "detection_unit_constructor": 0x3016490,
    "detection_pair_constructor": 0x3015F20,
    "input_filter_constructor": 0x30149D0,
    "output_filter_constructor": 0x3015440,
}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--function", choices=FUNCTIONS, required=True)
    ap.add_argument("--module", type=Path, default=Path(
        r"C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe"))
    args = ap.parse_args()
    pe = pefile.PE(str(args.module), fast_load=True)
    data = next(s for s in pe.sections if s.Name.startswith(b".pdata")).get_data()
    funcs = sorted(x for x in struct.iter_unpack("<III", data[:len(data)//12*12])
                   if x[0] and x[1] > x[0])
    starts = [x[0] for x in funcs]
    target = FUNCTIONS[args.function]
    begin, end, _ = funcs[bisect.bisect_right(starts, target)-1]
    if not begin <= target < end:
        raise ValueError("No bounded runtime-function range")
    base = pe.OPTIONAL_HEADER.ImageBase
    decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    decoder.detail = True
    print(f"function {begin:#x}..{end:#x}")
    for ins in decoder.disasm(pe.get_data(begin, end-begin), base+begin):
        comment = ""
        for op in ins.operands:
            if op.type == capstone.x86.X86_OP_MEM and op.mem.base == capstone.x86.X86_REG_RIP:
                target = ins.address+ins.size+op.mem.disp-base
                try:
                    raw = pe.get_data(target, 100).split(b"\0", 1)[0]
                    if 3 <= len(raw) < 100 and all(32 <= c < 127 for c in raw):
                        comment = f" ; {target:#x} {raw.decode('ascii')}"
                except pefile.PEFormatError:
                    pass
        print(f"{ins.address-base:#x} {ins.mnemonic} {ins.op_str}{comment}")

if __name__ == "__main__":
    main()
