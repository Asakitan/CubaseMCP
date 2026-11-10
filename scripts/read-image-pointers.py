"""Read-only static helper: print 64-bit image pointers (for example vtable slots) stored in an
installed PE file as RVAs. Only reads the file from disk.

Usage: python scripts/read-image-pointers.py <pe path> <table rva hex> <byte offset hex> [<byte offset hex> ...]
"""
import struct
import sys

import pefile


def main():
    if len(sys.argv) < 4:
        raise SystemExit(__doc__)
    pe = pefile.PE(sys.argv[1], fast_load=True)
    base = pe.OPTIONAL_HEADER.ImageBase
    table = int(sys.argv[2], 16)
    table = table - base if table >= base else table
    for token in sys.argv[3:]:
        offset = int(token, 16)
        value = struct.unpack('<Q', pe.get_data(table + offset, 8))[0]
        print(f'[{table:#x}+{offset:#x}] = {value:#x}' + (f' (rva {value - base:#x})' if value >= base else ''))


if __name__ == '__main__':
    main()
