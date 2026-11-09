"""Inspect fixed-build moved-project prompt and host-open argument flow from disk."""
from importlib import import_module

m = import_module('project-host-open-interface-inspect')
p = m.load(m.ROOT / 'Cubase 16.exe', 0x6ADF121B, 0x140000000)
marker = 'The project file has been moved.'.encode('utf-16le')
if p.get_data(0x448BE80, len(marker)) != marker:
    raise RuntimeError('Unexpected moved-project prompt literal')
if p.get_data(0x1D53D3C, 5) != bytes.fromhex('e8 ef e6 fe ff'):
    raise RuntimeError('Unexpected existing-project call')
print('Moved-project prompt literal and existing-project call matched the fixed build')
for name, start, end, spans in (
    ('moved-project-handler', 0x2810150, 0x2811233,
     ((0x2810270, 0x28102C5), (0x28104A0, 0x28104E0), (0x281063C, 0x2810675),
      (0x2810708, 0x2810735), (0x28107BA, 0x28108D0))),
    ('application-open', 0x1D53BB0, 0x1D53FC8, ((0x1D53CDA, 0x1D53DB5),)),
):
    m.show(p, name, start, end, spans)
