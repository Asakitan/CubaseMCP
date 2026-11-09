"""Inspect fixed host-open interface and a shipped component caller from disk."""
from pathlib import Path
import struct
import capstone
import pefile

ROOT = Path(r"C:\Program Files\Steinberg\Cubase 16")
IID_HOST = bytes.fromhex("c13cb143751b3244a09cd9527c1dd0ac")
IID_PATH_SERVICE = bytes.fromhex("a18ef30af240144b965bf97ca4ff94d1")


def load(path, timestamp, image_base):
    pe = pefile.PE(str(path), fast_load=True)
    if (pe.FILE_HEADER.Machine, pe.FILE_HEADER.TimeDateStamp, pe.OPTIONAL_HEADER.ImageBase) != (
        0x8664, timestamp, image_base
    ):
        raise RuntimeError(f"Unexpected PE profile: {path}")
    pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_EXCEPTION"]])
    return pe


def vtable_info(pe, vtable):
    base = pe.OPTIONAL_HEADER.ImageBase
    col = struct.unpack("<Q", pe.get_data(vtable - 8, 8))[0] - base
    signature, offset, _, descriptor, hierarchy, self_rva = struct.unpack("<6I", pe.get_data(col, 24))
    if signature != 1 or self_rva != col:
        raise RuntimeError("Unexpected RTTI locator")
    name = pe.get_data(descriptor + 16, 160).split(b"\0", 1)[0].decode("ascii")
    _, _, count, array = struct.unpack("<4I", pe.get_data(hierarchy, 16))
    if count > 128:
        raise RuntimeError("Unexpected RTTI hierarchy size")
    bases = []
    for index in range(count):
        descriptor_rva = struct.unpack("<I", pe.get_data(array + 4 * index, 4))[0]
        type_rva, _, mdisp, _, _, _ = struct.unpack("<IIiiiI", pe.get_data(descriptor_rva, 24))
        typename = pe.get_data(type_rva + 16, 160).split(b"\0", 1)[0].decode("ascii")
        bases.append((typename, mdisp))
    return name, offset, bases


def show(pe, label, start, end, spans):
    begins = {entry.struct.BeginAddress for entry in pe.DIRECTORY_ENTRY_EXCEPTION}
    if start not in begins:
        raise RuntimeError(f"{label}: start is not a runtime-function begin")
    decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    base = pe.OPTIONAL_HEADER.ImageBase
    print(f"\n{label}: decode from {start:#x}")
    for instruction in decoder.disasm(pe.get_data(start, end - start), base + start):
        address = instruction.address - base
        if any(begin <= address < stop for begin, stop in spans):
            print(f"{address:#x} {instruction.mnemonic} {instruction.op_str}")


def main():
    host = load(ROOT / "Cubase 16.exe", 0x6ADF121B, 0x140000000)
    component = load(ROOT / "Components" / "vstconnect.dll", 0x647E2A79, 0x180000000)
    if host.get_data(0x5523300, 16) != IID_HOST or component.get_data(0xF92FD8, 16) != IID_HOST:
        raise RuntimeError("Host interface IID mismatch")
    if (host.get_data(0x5530530, 16) != IID_PATH_SERVICE or
            host.get_data(0x4831B88, 16) != IID_PATH_SERVICE or
            component.get_data(0xF93750, 16) != IID_PATH_SERVICE):
        raise RuntimeError("Path-service IID mismatch")
    host_name, host_offset, bases = vtable_info(host, 0x4737230)
    client_name, client_offset, _ = vtable_info(component, 0xB6BE80)
    path_name, path_offset, path_bases = vtable_info(host, 0x4832CB0)
    if host_name != ".?AVUPluginContext@Steinberg@@" or host_offset != 8:
        raise RuntimeError("Unexpected host context vtable")
    if (".?AVIHostApplication2@Steinberg@@", 8) not in bases:
        raise RuntimeError("Expected host interface base was not found")
    classes_name, classes_offset, classes_bases = vtable_info(host, 0x47373C8)
    if (classes_name != host_name or classes_offset != 0x68 or
            (".?AVIHostClasses@Steinberg@@", 0x68) not in classes_bases):
        raise RuntimeError("Unexpected host classes subobject")
    factory_name, factory_offset, _ = vtable_info(host, 0x483C260)
    table_name, table_offset, _ = vtable_info(host, 0x483C468)
    if (factory_name != ".?AVClassFactory@Steinberg@@" or factory_offset != 0 or
            table_name != ".?AV?$THashTable@USorterByCID@MetaClasses@Steinberg@@@Steinberg@@" or table_offset != 0):
        raise RuntimeError("Unexpected class factory or CID registry vtable")
    # The fixed-build initializer stores six UPluginContext vtables into
    # consecutive static image locations; validate the instructions, not
    # only their disassembly labels.
    for index, table in enumerate((0x47371C0, 0x4737230, 0x4737258,
                                   0x47372A0, 0x47372C8, 0x47372F0)):
        name, offset, _ = vtable_info(host, table)
        if name != host_name or offset != 8 * index:
            raise RuntimeError("Unexpected static host context vtable")
        lea_at = 0x1580191 + 14 * index
        lea, store = host.get_data(lea_at, 7), host.get_data(lea_at + 7, 7)
        if (lea[:3] != b"\x48\x8d\x05" or
                lea_at + 7 + struct.unpack("<i", lea[3:])[0] != table or
                store[:3] != b"\x48\x89\x05" or
                lea_at + 14 + struct.unpack("<i", store[3:])[0] != 0x55233F0 + 8 * index):
            raise RuntimeError("Unexpected static host context initializer")
    lea, store = host.get_data(0x158021D, 7), host.get_data(0x1580224, 7)
    if (lea[:3] != b"\x48\x8d\x05" or 0x1580224 + struct.unpack("<i", lea[3:])[0] != 0x47373C8 or
            store[:3] != b"\x48\x89\x05" or 0x158022B + struct.unpack("<i", store[3:])[0] != 0x5523458):
        raise RuntimeError("Unexpected static host classes initializer")
    if client_name != ".?AVYYVst3HostAccess@@" or client_offset != 0x10:
        raise RuntimeError("Unexpected shipped-component caller vtable")
    if path_name != ".?AVFPath@Steinberg@@" or path_offset != 0x10:
        raise RuntimeError("Unexpected path vtable")
    if (".?AVIPath@Steinberg@@", 0x10) not in path_bases or (".?AVIPath2@Steinberg@@", 0x10) not in path_bases:
        raise RuntimeError("Expected path interface bases were not found")
    native_path_name, native_path_offset, native_path_bases = vtable_info(host, 0x4831D70)
    if (native_path_name != ".?AVFNPath@Steinberg@@" or native_path_offset != 0x10 or
            (".?AVIPath@Steinberg@@", 0x10) not in native_path_bases or
            (".?AVIPath2@Steinberg@@", 0x10) not in native_path_bases):
        raise RuntimeError("Unexpected native path factory return vtable")
    for address, prefix, destination in ((0x15BD9F6, b"\x4c\x8d\x0d", 0x4831B88),
                                          (0x15BDA02, b"\x4c\x8d\x05", 0x3B0ED80),
                                          (0x15BDA10, b"\x48\x8d\x0d", 0x59A03D0),
                                          (0x3B0EDAE, b"\x48\x8d\x05", 0x4831BC0),
                                          (0x3B0EDB8, b"\x48\x8d\x05", 0x4831D70)):
        instruction = host.get_data(address, 7)
        if instruction[:3] != prefix or address + 7 + struct.unpack("<i", instruction[3:])[0] != destination:
            raise RuntimeError("Unexpected native path registration or factory reference")
    for pe, table, slot, expected in ((host, 0x4737230, 0x18, 0x3751D40),
                                       (host, 0x47373C8, 0x00, 0x37523F0),
                                       (host, 0x47373C8, 0x18, 0x3AB0B90),
                                       (host, 0x4832CB0, 0x20, 0x3B183D0),
                                       (host, 0x4831D70, 0x20, 0x3B0F4B0),
                                       (host, 0x483C468, 0x58, 0x3B8FC80),
                                       (component, 0xB6BE80, 0x98, 0x1D1180)):
        actual = struct.unpack("<Q", pe.get_data(table + slot, 8))[0] - pe.OPTIONAL_HEADER.ImageBase
        if actual != expected:
            raise RuntimeError("Unexpected vtable method")
    classes_query = host.get_data(0x37523F0, 9)
    if (classes_query[:5] != b"\x48\x83\xe9\x68\xe9" or
            0x37523F9 + struct.unpack("<i", classes_query[5:])[0] != 0x37520B0):
        raise RuntimeError("Unexpected host classes query thunk")
    registry_ref = component.get_data(0x1CE2D9, 7)
    if registry_ref[:3] != b"\x48\x8b\x1d" or 0x1CE2E0 + struct.unpack("<i", registry_ref[3:])[0] != 0x100B9F0:
        raise RuntimeError("Unexpected component constructor registry reference")
    print("Host IID:", IID_HOST.hex())
    print("Path-service IID:", IID_PATH_SERVICE.hex())
    print("Host context:", host_name, "offset", hex(host_offset), "slot +0x18 -> 0x3751d40")
    print("Static host context initializer target: 0x55233f0; interface subobject: +0x8")
    print("Host classes subobject: +0x68; query thunk -> 0x37520b0; slot +0x18 -> 0x3ab0b90")
    print("Path IID registration: record 0x59a03d0; factory 0x3b0ed80; FNPath subobject +0x10")
    print("CID registry: factory global 0x5889af0; table vtable 0x483c468; lookup slot +0x58 -> 0x3b8fc80")
    print("Path object:", path_name, "offset", hex(path_offset), "slot +0x20 -> 0x3b183d0")
    print("Component caller:", client_name, "offset", hex(client_offset), "slot +0x98 -> 0x1d1180")
    print("Constructor registry head global: 0x100b9f0")
    show(host, "context-query", 0x37520B0, 0x375213E, ((0x3752105, 0x375213E),))
    show(host, "static-host-context-initializer", 0x1580030, 0x158022B,
         ((0x1580191, 0x15801E5), (0x158021D, 0x158022B)))
    show(host, "host-classes-service-lookup", 0x3AB0B90, 0x3AB0C1E, ((0x3AB0B90, 0x3AB0C1E),))
    show(host, "path-registration-initializer", 0x15BD9F0, 0x15BDA2C, ((0x15BD9F0, 0x15BDA2C),))
    show(host, "path-registration-constructor", 0x3B8F020, 0x3B8F0FD, ((0x3B8F037, 0x3B8F0E0),))
    show(host, "native-path-factory", 0x3B0ED80, 0x3B0EDED, ((0x3B0ED80, 0x3B0EDED),))
    show(host, "native-path-setter", 0x3B0F4B0, 0x3B0F524, ((0x3B0F4B0, 0x3B0F4D2),))
    show(host, "class-factory-singleton", 0x3B401F0, 0x3B4025D, ((0x3B401F0, 0x3B4025D),))
    show(host, "cid-registry-lookup", 0x3B8FC80, 0x3B8FD2D, ((0x3B8FC80, 0x3B8FD2D),))
    show(host, "cid-registry-insertion", 0x2E3B160, 0x2E3B1F2, ((0x2E3B160, 0x2E3B1F2),))
    show(host, "cid-registry-hash", 0x3B8F9E0, 0x3B8FA29, ((0x3B8F9E0, 0x3B8FA29),))
    print("\ncid-word-conversion leaf: decode from 0x3b94440")
    decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    for instruction in decoder.disasm(host.get_data(0x3B94440, 0xA2), host.OPTIONAL_HEADER.ImageBase + 0x3B94440):
        print(f"{instruction.address - host.OPTIONAL_HEADER.ImageBase:#x} {instruction.mnemonic} {instruction.op_str}")
        if instruction.mnemonic == "ret":
            break
    show(host, "host-open", 0x3751D40, 0x3751EED, ((0x3751D40, 0x3751EED),))
    show(host, "path-conversion", 0x3B0D3F0, 0x3B0D52C, ((0x3B0D3F0, 0x3B0D52C),))
    show(host, "path-query", 0x3B0F2A0, 0x3B0F314, ((0x3B0F2A0, 0x3B0F314),))
    show(host, "path-setter", 0x3B183D0, 0x3B18437, ((0x3B183D0, 0x3B18437),))
    show(component, "vstconnect-open-caller", 0x1D1180, 0x1D13AC,
         ((0x1D11B2, 0x1D1220), (0x1D1277, 0x1D12B2), (0x1D1333, 0x1D1366)))
    show(component, "vstconnect-constructor-registry", 0x1CE250, 0x1CE453,
         ((0x1CE261, 0x1CE296), (0x1CE2D9, 0x1CE3A0), (0x1CE3DF, 0x1CE439)))


if __name__ == "__main__":
    main()
