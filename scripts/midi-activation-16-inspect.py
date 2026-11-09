"""Bounded disk-only disassembly of fixed scanner enumeration and request path."""
import runpy
import sys
import pefile

path = r'C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe'
p = pefile.PE(path, fast_load=True)
if (p.FILE_HEADER.Machine, p.FILE_HEADER.TimeDateStamp, p.OPTIONAL_HEADER.ImageBase) != (0x8664, 0x6adf121b, 0x140000000):
    raise SystemExit('Unexpected PE profile')
functions = {'enumerate_start': 0x29e2610, 'enumerate_loop': 0x29e263d,
             'enumerate_return': 0x29e2698, 'request_candidate': 0x22f4110,
             'previous_records': 0x22f6ac0}
if len(sys.argv) != 2 or sys.argv[1] not in functions:
    raise SystemExit('Choose: ' + ', '.join(functions))
name = sys.argv[1]
module = runpy.run_path('scripts/midi-device-state-inspect.py')
module['main'].__globals__['FUNCTIONS'][name] = functions[name]
sys.argv = [sys.argv[0], '--function', name, '--module', path]
module['main']()
