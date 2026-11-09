"""Decode the fixed-build posted-message queue path from PE function boundaries."""
from pathlib import Path
from bisect import bisect_right
import struct
import capstone
import pefile

PATH = Path(r"C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe")
RANGES = {
    "producer": (0x3A8C770, 0x3A8C8CC, ((0x3A8C83E, 0x3A8C8B6),)),
    "list-append": (0x3A88620, 0x3A886A1, ((0x3A88620, 0x3A88694),)),
    "queue-consumer": (0x3A8C220, 0x3A8C459, ((0x3A8C232, 0x3A8C2DB), (0x3A8C2FE, 0x3A8C402))),
    "selector-calls-consumer": (0x279E640, 0x279EA96, ((0x279EA2D, 0x279EA43),)),
}

def main():
    pe = pefile.PE(str(PATH))
    base = pe.OPTIONAL_HEADER.ImageBase
    if (pe.FILE_HEADER.Machine, pe.FILE_HEADER.TimeDateStamp, base) != (0x8664, 0x6ADF121B, 0x140000000):
        raise RuntimeError("Installed Cubase PE does not match the fixed x64 profile")
    begins = {entry.struct.BeginAddress for entry in pe.DIRECTORY_ENTRY_EXCEPTION}
    cs = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    for name, (start, end, spans) in RANGES.items():
        if start not in begins:
            raise RuntimeError(f"{name}: missing runtime-function begin")
        print(f"\n{name} (decode from {start:#x})")
        for ins in cs.disasm(pe.get_data(start, end-start), base+start):
            addr = ins.address-base
            if any(a <= addr < b for a, b in spans):
                print(f"{addr:#x} {ins.mnemonic} {ins.op_str}")
    thunk = pe.get_data(0x3AB9330, 5)
    if thunk[0] != 0xE9 or 0x3AB9335 + struct.unpack('<i', thunk[1:])[0] != 0x3A88620:
        raise RuntimeError("Unexpected list-append thunk")
    table = 0x4825768
    col = struct.unpack('<Q', pe.get_data(table-8, 8))[0]-base
    sig, _, _, type_rva, _, self_rva = struct.unpack('<6I', pe.get_data(col, 24))
    if sig != 1 or col != self_rva:
        raise RuntimeError("Unexpected RTTI locator")
    name = pe.get_data(type_rva+16, 128).split(b'\0')[0].decode('ascii')
    print(f"\nthunk=0x3ab9330 -> 0x3a88620; record RTTI={name}")
    # Validate direct-call candidates against each enclosing runtime-function
    # disassembly; byte matches alone are not necessarily instruction starts.
    functions = sorted((e.struct.BeginAddress, e.struct.EndAddress) for e in pe.DIRECTORY_ENTRY_EXCEPTION)
    starts = [begin for begin, _ in functions]
    call_sites = []
    for section in pe.sections:
        if not section.Characteristics & 0x20000000:
            continue
        data = section.get_data()
        position = 0
        while True:
            position = data.find(b'\xe8', position)
            if position < 0 or position + 5 > len(data):
                break
            address = section.VirtualAddress + position
            destination = address + 5 + struct.unpack_from('<i', data, position + 1)[0]
            position += 1
            if destination != 0x3A8C220:
                continue
            index = bisect_right(starts, address) - 1
            if index < 0 or address >= functions[index][1]:
                continue
            begin = functions[index][0]
            for ins in cs.disasm(pe.get_data(begin, address + 5 - begin), base + begin):
                if ins.address - base == address and ins.mnemonic == 'call':
                    call_sites.append(address)
                    break
    print('validated direct calls:', ', '.join(hex(a) for a in sorted(set(call_sites))))

if __name__ == '__main__':
    main()
