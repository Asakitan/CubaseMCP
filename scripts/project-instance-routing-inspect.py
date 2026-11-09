"""Read-only fixed-profile instance forwarding inspection from runtime starts."""
from pathlib import Path
import pefile, capstone
PATH = Path(r"C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe")
RANGES = {
    "startup-parent": (0x39358D0,0x3935B94,((0x3935A3C,0x3935A56),)),
    "candidate-forwarder": (0x3940920,0x3940A5A,((0x3940920,0x39409E2),)),
    "commandline-helper": (0x3940A60,0x3940E1B,((0x3940A60,0x3940AF7),(0x3940B9E,0x3940BF4),(0x3940CCB,0x3940CD7))),
    "post-wrapper": (0x3943F00,0x3943FA1,((0x3943F7E,0x3943FA1),)),
    "foreground-wrapper": (0x3944120,0x394414E,((0x3944120,0x394414E),)),
    "window-message-handler": (0x394EC00,0x394EF2B,((0x394EDAE,0x394EDBC),(0x394EE12,0x394EE6C))),
    "receiver-path-helper": (0x3942720,0x3942914,((0x3942720,0x394277C),(0x394284A,0x39428A2))),
}

def main():
    pe=pefile.PE(str(PATH)); base=pe.OPTIONAL_HEADER.ImageBase
    if (pe.FILE_HEADER.Machine,pe.FILE_HEADER.TimeDateStamp,base)!=(0x8664,0x6ADF121B,0x140000000):
        raise RuntimeError("Installed Cubase PE does not match the fixed x64 profile")
    starts={e.struct.BeginAddress for e in pe.DIRECTORY_ENTRY_EXCEPTION}
    cs=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64)
    for name,(start,end,spans) in RANGES.items():
        if start not in starts: raise RuntimeError(f"{name}: invalid runtime-function start")
        print(f"\n{name}: decode from {start:#x}")
        for i in cs.disasm(pe.get_data(start,end-start),base+start):
            a=i.address-base
            if any(lo<=a<hi for lo,hi in spans): print(f"{a:#x} {i.mnemonic} {i.op_str}")
    wanted={0x4162438,0x4162400,0x4162408,0x4162418,0x4162CD0,0x4162CB0,0x4162D98,0x4163090,0x4162430}
    for dll in pe.DIRECTORY_ENTRY_IMPORT:
        for i in dll.imports:
            if i.address-base in wanted: print(f"IAT {i.address-base:#x} {dll.dll.decode()}!{i.name.decode()}")

if __name__=='__main__': main()
