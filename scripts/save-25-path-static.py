from importlib import import_module
m=import_module('project-host-open-interface-inspect')
p=m.load(m.ROOT/'Cubase 16.exe',0x6ADF121B,0x140000000)
m.show(p,'save setup and path selection',0x1D579D0,0x1D583D0,[(0x1D579D0,0x1D57BD0),(0x1D57F50,0x1D58050),(0x1D581A2,0x1D58248)])
