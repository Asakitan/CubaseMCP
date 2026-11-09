"""Inspect fixed-build path setter, storage and root-check call shapes from disk."""
from importlib import import_module
import struct
import pefile

m = import_module('project-host-open-interface-inspect')
p = m.load(m.ROOT / 'Cubase 16.exe', 0x6ADF121B, 0x140000000)
b = p.OPTIONAL_HEADER.ImageBase
for table, name, offset, slots in (
    (0x4831BC0, '.?AVFNPath@Steinberg@@', 0, {0x178: 0x3B0E0E0, 0x180: 0x3B0E860, 0x1A0: 0x3B0DDF0}),
    (0x4831D70, '.?AVFNPath@Steinberg@@', 0x10, {0x10: 0x15C31C8, 0x20: 0x3B0F4B0}),
    (0x48313F0, '.?AVFNFileSystem@Steinberg@@', 0, {0x228: 0x3B09BE0}),
):
    actual_name, actual_offset, _ = m.vtable_info(p, table)
    if (actual_name, actual_offset) != (name, offset):
        raise RuntimeError('Unexpected path or filesystem RTTI')
    for slot, expected in slots.items():
        actual = struct.unpack('<Q', p.get_data(table + slot, 8))[0] - b
        if actual != expected:
            raise RuntimeError(f'Unexpected vtable slot {table:#x}+{slot:#x}')
        print(f'{name} offset={offset:#x} vtable={table:#x} slot={slot:#x} -> {expected:#x}')

initializer = p.get_data(0x15BCB6E, 14)
if (initializer[:3] != b'\x48\x8d\x05' or
        0x15BCB75 + struct.unpack('<i', initializer[3:7])[0] != 0x48313F0 or
        initializer[7:10] != b'\x48\x89\x05' or
        0x15BCB7C + struct.unpack('<i', initializer[10:14])[0] != 0x59A01B0):
    raise RuntimeError('Unexpected filesystem singleton initializer')
leaf = p.get_data(0x3B0E860, 17)
if (leaf[:3] != b'\x48\x8b\x0d' or
        0x3B0E867 + struct.unpack('<i', leaf[3:7])[0] != 0x5530450 or
        leaf[7:] != bytes.fromhex('488b0148ffa028020000')):
    raise RuntimeError('Unexpected FNPath root-check leaf')
p.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_IMPORT']])
if not any(i.address - b == 0x4162C30 and i.name == b'PathStripToRootW'
           for dll in p.DIRECTORY_ENTRY_IMPORT for i in dll.imports):
    raise RuntimeError('Unexpected root-path helper import')
print('filesystem global=0x5530450 singleton=0x59a01b0; root helper=PathStripToRootW')

for label, start, end, spans in (
    ('secondary-path-setter', 0x3B0F4B0, 0x3B0F51C, ((0x3B0F4B0, 0x3B0F51C),)),
    ('base-path-setter', 0x3B183D0, 0x3B18437, ((0x3B183D0, 0x3B18437),)),
    ('derived-path-setter', 0x3B0E0E0, 0x3B0E0FC, ((0x3B0E0E0, 0x3B0E0FC),)),
    ('derived-path-storage', 0x3B0DDF0, 0x3B0E0D5, ((0x3B0DDF0, 0x3B0DE73), (0x3B0DFA4, 0x3B0E0D5))),
    ('filesystem-root-check', 0x3B09BE0, 0x3B09D2E, ((0x3B09BE0, 0x3B09D2E),)),
):
    m.show(p, label, start, end, spans)
