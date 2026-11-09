"""Print bounded Cubase 16.0.5 scanner SysEx registration disassembly."""
import runpy
import sys
import pefile

path = r'C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe'
pe = pefile.PE(path, fast_load=True)
if (pe.FILE_HEADER.Machine != 0x8664 or pe.FILE_HEADER.TimeDateStamp != 0x6adf121b or
        pe.OPTIONAL_HEADER.ImageBase != 0x140000000):
    raise SystemExit('Unexpected Cubase PE profile')
module = runpy.run_path('scripts/midi-device-state-inspect.py')
module['main'].__globals__['FUNCTIONS']['identity_registration'] = 0x22b6960
module['main'].__globals__['FUNCTIONS']['sysex_pair_registration'] = 0x22d1d60
module['main'].__globals__['FUNCTIONS']['scanner_rebuild'] = 0x22f73d0
module['main'].__globals__['FUNCTIONS']['scanner_enumerate'] = 0x22f7600
if len(sys.argv) != 2 or sys.argv[1] not in ('identity_registration', 'sysex_pair_registration', 'scanner_rebuild', 'scanner_enumerate'):
    raise SystemExit('Usage: python scripts/midi-activation-14-inspect.py identity_registration|sysex_pair_registration|scanner_rebuild|scanner_enumerate')
sys.argv = [sys.argv[0], '--function', sys.argv[1], '--module', path]
module['main']()
