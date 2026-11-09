"""Inspect the fixed Cubase 16.0.5 scanner receiver vtables and thunks."""
import struct
import pefile
import capstone

p = pefile.PE(r'C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe')
if (p.FILE_HEADER.Machine, p.FILE_HEADER.TimeDateStamp, p.OPTIONAL_HEADER.ImageBase) != (0x8664, 0x6adf121b, 0x140000000):
    raise SystemExit('Unexpected PE profile')
b = p.OPTIONAL_HEADER.ImageBase
primary, secondary = struct.unpack('<QQ', p.get_data(0x550c1a0, 16))
if (primary-b, secondary-b) != (0x43ec3e0, 0x43eaf10):
    raise SystemExit('Unexpected static receiver vtables')
for table, slot, target in ((primary-b, 0, 0x22b8900), (primary-b, 0x10, 0x22b8940),
                            (secondary-b, 8, 0x22b6960)):
    if struct.unpack('<Q', p.get_data(table + slot, 8))[0] - b != target:
        raise SystemExit('Unexpected scanner receiver vtable slot')
for label, vtable, count in [('primary', primary-b, 10), ('secondary', secondary-b, 3)]:
    slots = struct.unpack('<' + 'Q'*count, p.get_data(vtable, count*8))
    print(label, hex(vtable), [hex(x-b) for x in slots])
for address in (0x22b8900, 0x22b8940):
    print('thunk', hex(address))
    dec = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    for ins in dec.disasm(p.get_data(address, 20), b+address):
        print(hex(ins.address-b), ins.mnemonic, ins.op_str)
        if ins.mnemonic in ('ret', 'jmp'):
            break
