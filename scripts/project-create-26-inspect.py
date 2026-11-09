"""Read-only, fixed-build Hub wrapper and callback inspection."""
import struct
import capstone
import pefile

p = pefile.PE(r'C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe')
b = p.OPTIONAL_HEADER.ImageBase
assert p.FILE_HEADER.TimeDateStamp == 0x6adf121b and b == 0x140000000
c = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
c.detail = True
assert p.get_data(0x42edcf8, 12) == b'Project Dir\0'
for vt in (0x45d07a0, 0x42eba20):
    assert struct.unpack('<Q', p.get_data(vt + 0x178, 8))[0] == b + 0x1d53bb0
    print(f'application table {vt:#x} +0x178 -> 0x1d53bb0')
# Verify each referenced address from the actual RIP-relative LEA instruction.
for ins_rva, target in [(0x1ae03be, 0x4271b70), (0x1ae03c8, 0x4271b88),
                        (0x1ae0407, 0x4271c60), (0x1ae042f, 0x4271be8),
                        (0x1ae0439, 0x4271c00)]:
    ins = next(c.disasm(p.get_data(ins_rva, 15), b + ins_rva))
    assert ins.mnemonic == 'lea'
    refs = [ins.address + ins.size + op.mem.disp for op in ins.operands
            if op.type == capstone.x86.X86_OP_MEM and op.mem.base == capstone.x86.X86_REG_RIP]
    assert refs == [b + target], (hex(ins_rva), refs)
    print(f'{ins_rva:#x} -> {target:#x}')
for table, expected in [(0x4271b88, [0x1ae0900, 0x15e4fc0, 0x15e4fd0, 0x1ae3890, 0x1ae3900, 0x1ae38e0, 0x1ae38b0, 0x1ae38d0]),
                        (0x4271c00, [0x1ae0880, 0x15e4fc0, 0x15e4fd0, 0x1ae0100]),
                        (0x4271c60, [0x1adf610, 0x1adf610, 0x1adf680])]:
    actual = [struct.unpack('<Q', p.get_data(table + i * 8, 8))[0] - b for i in range(len(expected))]
    assert actual == expected, (hex(table), actual)
    print(f'table {table:#x}: ' + ', '.join(hex(x) for x in actual))
for start, end in [(0x1ae04cc, 0x1ae0523), (0x1ae0100, 0x1ae01b5),
                   (0x1adf610, 0x1adf626), (0x1adf680, 0x1adf70c),
                   (0x1ae3890, 0x1ae38f3), (0x1ae3900, 0x1ae3943),
                   (0x1d3a770, 0x1d3a9fa), (0x1d469c0, 0x1d46a2d),
                   (0x1d50920, 0x1d50a2e), (0x1d38a80, 0x1d38b80)]:
    print(f'\n{start:#x}..{end:#x}')
    for ins in c.disasm(p.get_data(start, end - start), b + start):
        print(f'{ins.address - b:#x} {ins.mnemonic} {ins.op_str}')
