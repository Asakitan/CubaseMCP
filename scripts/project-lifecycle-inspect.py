"""Inspect fixed Cubase 16.0.5 candidate vtable methods without process access.

Output is static disassembly, not a verified ABI. The addresses are build-specific.
Requires pefile and capstone. No files or processes are modified.
"""
import bisect
import json
import struct
from pathlib import Path

import capstone
import pefile

PATH = Path(r"C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe")
TARGETS = [0x1D22E70, 0x1D15D40, 0x1D18BF0, 0x1D26600, 0x1D12C90, 0x1D19240,
           0x2F400A0, 0x2F401E0, 0x2635650, 0x2635940, 0x2673B10, 0x2679B20,
           0x3AC5605, 0x3AC5865, 0x3AC5C9B, 0x3AC5D57, 0x3AC5F66]
pe = pefile.PE(str(PATH), fast_load=True)
data = PATH.read_bytes()
base = pe.OPTIONAL_HEADER.ImageBase
functions = []
section = next(s for s in pe.sections if s.Name.rstrip(b"\0") == b".pdata")
for offset in range(section.PointerToRawData, section.PointerToRawData + section.SizeOfRawData - 11, 12):
    start, end, unwind = struct.unpack_from("<III", data, offset)
    if start and end > start:
        functions.append((start, end, unwind))
functions.sort()
starts = [x[0] for x in functions]
engine = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
result = []
for target in TARGETS:
    index = bisect.bisect_right(starts, target) - 1
    if index < 0 or target >= functions[index][1]:
        result.append({"target": hex(target), "function": None})
        continue
    start, end, unwind = functions[index]
    raw_offset = pe.get_offset_from_rva(start)
    code = data[raw_offset:raw_offset + min(end - start, 8192)]
    rows = [f"{ins.address - base:#x} {ins.mnemonic} {ins.op_str}"
            for ins in engine.disasm(code, base + start)]
    result.append({"target": hex(target), "start": hex(start), "end": hex(end),
                   "unwind": hex(unwind), "truncated": end - start > 8192,
                   "instructions": rows})
print(json.dumps({"module": str(PATH), "file_size": len(data), "image_base": hex(base),
                  "results": result}, indent=2))
