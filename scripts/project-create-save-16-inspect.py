"""Inspect local-volume branch in the additional save predicate; disk only."""
from importlib import import_module
import pefile
m = import_module('project-host-open-interface-inspect')
p = m.load(m.ROOT / 'Cubase 16.exe', 0x6ADF121B, 0x140000000)
if p.get_data(0x4831854, 6) != b'\\\x00\\\x00\x00\x00':
    raise RuntimeError('Unexpected two-backslash string')
p.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_IMPORT']])
imports = {i.address - p.OPTIONAL_HEADER.ImageBase: i.name for d in p.DIRECTORY_ENTRY_IMPORT for i in d.imports}
for rva, name in [(0x4162478, b'GetFileAttributesW'), (0x4162240, b'GetDriveTypeW')]:
    if imports.get(rva) != name:
        raise RuntimeError('Unexpected import')
    print(hex(rva), name.decode())
print('0x4831854: two UTF-16 backslashes')
m.show(p, 'attribute and drive predicate', 0x3B08010, 0x3B080CA, [(0x3B08010, 0x3B080CA)])
m.show(p, 'path-type gate', 0x3B127F0, 0x3B128FA, [(0x3B127F0, 0x3B128FA)])
