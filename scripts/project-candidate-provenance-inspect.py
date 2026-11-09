"""Validate the fixed-build project-candidate reader's object and root provenance."""
from importlib import import_module
import struct

m = import_module('project-host-open-interface-inspect')
p = m.load(m.ROOT / 'Cubase 16.exe', 0x6ADF121B, 0x140000000)
expected = (
    (0x42D96C0, '.?AVPArrangement@Steinberg@@', 0),
    (0x4831BC0, '.?AVFNPath@Steinberg@@', 0),
    (0x4471C40, '.?AVMRoot@Steinberg@@', 0),
    (0x4472130, '.?AVMRoot@Steinberg@@', 0x98),
    (0x41ECF60, '.?AVUDocWindow@Steinberg@@', 0),
    (0x42DF530, '.?AVFocusControllerAwareTimeEditController@?A0x57c04016@Steinberg@@', 0),
    (0x42DF7C0, '.?AVFocusControllerAwareTimeEditController@?A0x57c04016@Steinberg@@', 0x10),
    (0x446E330, '.?AVMEditContext@Steinberg@@', 0),
    (0x4192350, '.?AVCmLinkedList@Steinberg@@', 0),
    (0x447D378, '.?AVMProject@Steinberg@@', 0),
)
for table, name, offset in expected:
    actual, actual_offset, _ = m.vtable_info(p, table)
    if (actual, actual_offset) != (name, offset):
        raise RuntimeError(f'Unexpected RTTI at {table:#x}')
    print(f'{table:#x} offset={offset:#x} {name}')

for address, target in ((0x1CF3E67, 0x42D96C0), (0x275498F, 0x4471C40), (0x27549A4, 0x4472130)):
    instruction = p.get_data(address, 7)
    if instruction[:3] != b'\x48\x8d\x05' or address + 7 + struct.unpack('<i', instruction[3:])[0] != target:
        raise RuntimeError('Unexpected constructor vtable reference')
if p.get_data(0x1CF4145, 5) != b'\xe8' + struct.pack('<i', 0x2754970 - 0x1CF414A):
    raise RuntimeError('Unexpected root constructor call')
if p.get_data(0x1CF414F, 7) != bytes.fromhex('48898608010000'):
    raise RuntimeError('Unexpected arrangement root-field store')
print('PArrangement constructor stores constructed MRoot at +0x108')

for label, start, end, spans in (
    ('arrangement-constructor', 0x1CF3E30, 0x1CF41A9, ((0x1CF3E67, 0x1CF3E72), (0x1CF412C, 0x1CF41A9))),
    ('root-constructor', 0x2754970, 0x27549B2, ((0x2754970, 0x27549B2),)),
    ('document-selector', 0x1D3A220, 0x1D3A400, ((0x1D3A2B0, 0x1D3A400),)),
):
    m.show(p, label, start, end, spans)
