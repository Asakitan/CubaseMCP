"""Inspect the second pre-file-open save alert and its filesystem predicate."""
from importlib import import_module
import pefile
import struct
m = import_module('project-host-open-interface-inspect')
p = m.load(m.ROOT / 'Cubase 16.exe', 0x6ADF121B, 0x140000000)
base = p.OPTIONAL_HEADER.ImageBase
if struct.unpack('<Q', p.get_data(0x48313F0 + 0x158, 8))[0] - base != 0x3B04AE0:
    raise RuntimeError('Unexpected filesystem slot')
p.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_IMPORT']])
imports = {i.address - base: i.name for d in p.DIRECTORY_ENTRY_IMPORT for i in d.imports}
for rva, name in [(0x4162478, b'GetFileAttributesW'), (0x4162240, b'GetDriveTypeW')]:
    if imports.get(rva) != name:
        raise RuntimeError('Unexpected filesystem import')
    print(hex(rva), name.decode())
for label, start, end, spans in [
    ('save branch', 0x1D579D0, 0x1D58DE7, [(0x1D581A2, 0x1D58248), (0x1D58308, 0x1D583C8)]),
    ('filesystem predicate', 0x3B04AE0, 0x3B04B71, [(0x3B04AE0, 0x3B04B71)]),
    ('attribute and drive test', 0x3B08010, 0x3B080CA, [(0x3B08010, 0x3B080CA)]),
]:
    m.show(p, label, start, end, spans)
