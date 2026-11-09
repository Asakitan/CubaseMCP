"""Inspect fixed-build posted-open path ownership without invoking the host."""
from importlib import import_module
import struct

m = import_module('project-host-open-interface-inspect')
p = m.load(m.ROOT / 'Cubase 16.exe', 0x6ADF121B, 0x140000000)
for table, name, offset, slot, target in (
    (0x4831BC0, '.?AVFNPath@Steinberg@@', 0, 0xC0, 0x1D5C8B0),
    (0x4825630, '.?AVFMessage@Steinberg@@', 0x18, 0x10, 0x3A8B760),
    (0x4825768, '.?AVFPostedMessage@Steinberg@@', 0, 0x10, 0x3B89D20),
):
    if m.vtable_info(p, table)[:2] != (name, offset):
        raise RuntimeError(f'Unexpected RTTI at {table:#x}')
    method = struct.unpack('<Q', p.get_data(table + slot, 8))[0] - p.OPTIONAL_HEADER.ImageBase
    if method != target:
        raise RuntimeError(f'Unexpected vtable target at {table:#x}+{slot:#x}')
    print(f'{name} vtable={table:#x} offset={offset:#x} slot={slot:#x} target={target:#x}')

for name, start, end, spans in (
    ('host-open', 0x3751D40, 0x3751EF0, ((0x3751E3C, 0x3751ED8),)),
    ('native-path-clone', 0x1D5C8B0, 0x1D5C8E7, ((0x1D5C8B0, 0x1D5C8E7),)),
    ('native-path-copy-constructor', 0x3B0C790, 0x3B0C84E, ((0x3B0C790, 0x3B0C84E),)),
    ('message-property-thunk', 0x3A8B760, 0x3A8B77E, ((0x3A8B760, 0x3A8B77E),)),
    ('message-property-setter', 0x16350F0, 0x1635299, ((0x16350F0, 0x1635299),)),
    ('property-value-ref', 0x3A9C4F0, 0x3A9C546, ((0x3A9C4F0, 0x3A9C546),)),
    ('posted-message-destruction', 0x3A8B6D0, 0x3A8B727, ((0x3A8B6D0, 0x3A8B727),)),
    ('posted-message-creation', 0x3A8C770, 0x3A8C8CC, ((0x3A8C830, 0x3A8C8CC),)),
    ('posted-message-consumer', 0x3A8C220, 0x3A8C459, ((0x3A8C310, 0x3A8C350),)),
):
    m.show(p, name, start, end, spans)
