"""Read-only fixed-build inspection of the native path-service caller."""
from pathlib import Path
import importlib.util
import capstone
import pefile
import struct

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('host_profile', ROOT / 'project-host-open-interface-inspect.py')
profile = importlib.util.module_from_spec(spec)
spec.loader.exec_module(profile)


def main():
    pe = profile.load(profile.ROOT / 'Cubase 16.exe', 0x6ADF121B, 0x140000000)
    if pe.get_data(0x5530530, 16) != profile.IID_PATH_SERVICE:
        raise RuntimeError('Unexpected path IID')
    context_iid = bytes.fromhex('5b428884480e7c405f52409d31467af2')
    if pe.get_data(0x553FC88, 16) != context_iid:
        raise RuntimeError('Unexpected upstream context IID')
    pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_IMPORT']])
    imports = {i.address - pe.OPTIONAL_HEADER.ImageBase: (entry.dll, i.name)
               for entry in pe.DIRECTORY_ENTRY_IMPORT for i in entry.imports}
    expected = {0x4162BC8: b'DragQueryFileW', 0x4162478: b'GetFileAttributesW',
                0x4162C18: b'StrRChrW', 0x4162C20: b'StrCmpIW'}
    for address, name in expected.items():
        if imports.get(address, (None, None))[1] != name:
            raise RuntimeError(f'Unexpected import at {address:#x}')
        print(f'import {address:#x} {imports[address][0].decode()}!{name.decode()}')
    print('machine=0x8664 timestamp=0x6adf121b image_base=0x140000000')
    print(f'path_iid={profile.IID_PATH_SERVICE.hex()}')
    print(f'upstream_context_iid={context_iid.hex()}')
    if profile.vtable_info(pe, 0x4825768)[:2] != ('.?AVFPostedMessage@Steinberg@@', 0):
        raise RuntimeError('Unexpected posted-message vtable')
    for start, target in ((0x3A8D370, 0x3A8C770), (0x3AB9330, 0x3A88620)):
        data = pe.get_data(start, 5)
        if data[0] != 0xE9 or start + 5 + struct.unpack('<i', data[1:])[0] != target:
            raise RuntimeError(f'Unexpected thunk at {start:#x}')
        print(f'thunk {start:#x} -> {target:#x}')
    print('posted-message RTTI=Steinberg::FPostedMessage vtable=0x4825768')
    for start in (0x3933F10, 0x39206C0, 0x3541930, 0x3B0F4B0,
                  0x3751D40, 0x3A8C770, 0x3A88620):
        entry = next((e.struct for e in pe.DIRECTORY_ENTRY_EXCEPTION if e.struct.BeginAddress == start), None)
        if entry is None:
            raise RuntimeError(f'Missing runtime function start {start:#x}')
        print(f'\nfunction {start:#x}..{entry.EndAddress:#x}')
        cs = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
        for ins in cs.disasm(pe.get_data(start, entry.EndAddress - start), pe.OPTIONAL_HEADER.ImageBase + start):
            print(f'{ins.address - pe.OPTIONAL_HEADER.ImageBase:#x} {ins.mnemonic} {ins.op_str}')


if __name__ == '__main__':
    main()
