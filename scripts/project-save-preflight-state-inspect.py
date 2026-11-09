"""Inspect save-preflight predicate and its fixed-build setter from disk."""
from importlib import import_module
import struct
import capstone
m = import_module('project-host-open-interface-inspect')
p = m.load(m.ROOT / 'Cubase 16.exe', 0x6ADF121B, 0x140000000)
# These leaf functions do not have runtime-function entries: validate their full bytes.
for rva, prefix, size in [(0x3AC5800, b'\x0f\xb6\x05', 8), (0x3AC6030, b'\xc6\x05', 8)]:
    raw = p.get_data(rva, size)
    if not raw.startswith(prefix):
        raise RuntimeError('Unexpected preflight leaf')
    offset = len(prefix)
    if rva + 7 + struct.unpack('<i', raw[offset:offset+4])[0] != 0x599DF29 or raw[-1] != 0xC3:
        raise RuntimeError('Unexpected global or return')
    if rva == 0x3AC6030 and raw[6] != 1:
        raise RuntimeError('Unexpected setter value')
    print(hex(rva), raw.hex())
m.show(p, 'setter caller', 0x3ABE630, 0x3ABE834, [(0x3ABE630, 0x3ABE691)])
m.show(p, 'marker path gate', 0x3AC5C70, 0x3AC5D2C, [(0x3AC5C70, 0x3AC5CDC)])
