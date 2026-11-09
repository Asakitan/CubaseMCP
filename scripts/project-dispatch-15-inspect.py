"""Fixed-profile, read-only inspection of application OpenFile dispatch."""
from pathlib import Path
import importlib.util
import struct
import capstone

spec = importlib.util.spec_from_file_location('profile', Path(__file__).with_name('project-host-open-interface-inspect.py'))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


def main():
    pe = p.load(p.ROOT / 'Cubase 16.exe', 0x6ADF121B, 0x140000000)
    base = pe.OPTIONAL_HEADER.ImageBase
    for address, expected in ((0x42EDEC0, b'OpenFile\0'), (0x41B2218, b'Path\0'),
                              (0x42EDED0, b'ProjectDir\0')):
        if pe.get_data(address, len(expected)) != expected:
            raise RuntimeError(f'Unexpected string at {address:#x}')
    for table, name in ((0x45D07A0, '.?AVPCubaseApplication@Steinberg@@'),
                        (0x42EBA20, '.?AVPSequencerApplication@Steinberg@@')):
        actual, offset, _ = p.vtable_info(pe, table)
        if (actual, offset) != (name, 0):
            raise RuntimeError(f'Unexpected RTTI {actual} at {table:#x}')
        for slot, target in ((0xB0, 0x1D50AD0), (0x178, 0x1D53BB0)):
            value = struct.unpack('<Q', pe.get_data(table + slot, 8))[0] - base
            if value != target:
                raise RuntimeError(f'Unexpected vtable slot {table:#x}+{slot:#x}')
        print(f'{actual} table={table:#x} +0xb0=0x1d50ad0 +0x178=0x1d53bb0')
    for start, spans in ((0x3751D40, ((0x3751DBC, 0x3751DF9), (0x3751E91, 0x3751EB0))),
                         (0x1D50AD0, ((0x1D50EA7, 0x1D50F42),)),
                         (0x1D53BB0, ((0x1D53BD8, 0x1D53C80),)),
                         (0x3A8C220, ((0x3A8C2FE, 0x3A8C402),))):
        entry = next((e.struct for e in pe.DIRECTORY_ENTRY_EXCEPTION if e.struct.BeginAddress == start), None)
        if entry is None:
            raise RuntimeError(f'Missing function {start:#x}')
        print(f'\nfunction={start:#x}..{entry.EndAddress:#x}, selected instructions')
        cs = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
        for ins in cs.disasm(pe.get_data(start, entry.EndAddress-start), base+start):
            rva = ins.address-base
            if any(a <= rva < b for a,b in spans):
                print(f'{rva:#x} {ins.mnemonic} {ins.op_str}')

if __name__ == '__main__':
    main()
