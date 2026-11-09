"""Verify the fixed-build predicate's static call chain, without invoking it."""
import importlib.util, struct
from pathlib import Path
import pefile, capstone
s=importlib.util.spec_from_file_location('profile',Path(__file__).with_name('project-host-open-interface-inspect.py'))
m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
p=m.load(m.ROOT/'Cubase 16.exe',0x6adf121b,0x140000000); b=p.OPTIONAL_HEADER.ImageBase
for v,name,offset,slot,target in ((0x4713f68,'.?AVUController@Steinberg@@',16,0x88,0x3674c90),(0x4797908,'.?AUWin32Factory@Platform@UI@Steinberg@@',8,0x48,0x18f7d00),(0x4799968,'.?AVWin32EventHandler@Platform@UI@Steinberg@@',16,0xb0,0x3935710)):
 if m.vtable_info(p,v)[:2] != (name,offset) or struct.unpack('<Q',p.get_data(v+slot,8))[0]-b != target: raise RuntimeError('Unexpected vtable profile')
 print(f'{name} vtable={v:#x} offset={offset:#x} slot={slot:#x} target={target:#x}')
p.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_IMPORT']])
imports={i.address-b:i.name for e in p.DIRECTORY_ENTRY_IMPORT for i in e.imports}
if imports.get(0x41624e8) != b'GetCurrentThreadId': raise RuntimeError('Unexpected import')
print('import 0x41624e8 GetCurrentThreadId')
cs=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64)
for start,stop in ((0x3674c90,0x3674caa),(0x37b4a20,0x37b4a37),(0x37b4a40,0x37b4a7d),(0x3920bb0,0x3920bc5),(0x18f7d00,0x18f7d05),(0x3935710,0x393572e)):
 print(f'\n{start:#x}..{stop:#x}')
 for i in cs.disasm(p.get_data(start,stop-start),b+start): print(f'{i.address-b:#x} {i.mnemonic} {i.op_str}')
