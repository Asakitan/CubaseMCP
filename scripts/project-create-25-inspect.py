"""File-only fixed-build New action and Hub service static inspection."""
import pefile
import capstone

p = pefile.PE(r'C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe')
assert p.FILE_HEADER.TimeDateStamp == 0x6adf121b and p.OPTIONAL_HEADER.ImageBase == 0x140000000
for rva, value in [(0x42ec288, b'New\0'), (0x42ee1a0, b'NewWithHub\0'),
                   (0x419fae0, b'CanInterpret\0'), (0x4271b58, b'SmtgHubWindow\0'),
                   (0x4271bd0, b'Hub Service\0')]:
    assert p.get_data(rva, len(value)) == value
c = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
for start, end, selected in [
    (0x1d50ad0, 0x1d52f4b, [(0x1d5108d, 0x1d510b4), (0x1d51475, 0x1d51519)]),
    (0x1ae0340, 0x1ae0530, [(0x1ae0340, 0x1ae0530)]),
    (0x1adfb70, 0x1adfdd5, [(0x1adfb70, 0x1adfc0e)]),
    (0x1ae0030, 0x1ae0067, [(0x1ae0030, 0x1ae0067)]),
]:
    print(f'\nfunction {start:#x}')
    for ins in c.disasm(p.get_data(start, end - start), p.OPTIONAL_HEADER.ImageBase + start):
        rva = ins.address - p.OPTIONAL_HEADER.ImageBase
        if any(lo <= rva < hi for lo, hi in selected):
            print(f'{rva:#x} {ins.mnemonic} {ins.op_str}')
