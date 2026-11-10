"""Read-only static helper: print the NUL-terminated ASCII (or UTF-16) text stored at image RVAs
or absolute preferred-base addresses of an installed PE file. The file is only read from disk.

Usage: python scripts/read-image-strings.py <pe path> <hex address> [<hex address> ...]
"""
import sys

import pefile


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    pe = pefile.PE(sys.argv[1], fast_load=True)
    base = pe.OPTIONAL_HEADER.ImageBase
    for token in sys.argv[2:]:
        value = int(token, 16)
        rva = value - base if value >= base else value
        try:
            raw = pe.get_data(rva, 256)
        except Exception as error:  # pragma: no cover - diagnostic output only
            print(f'{token}: unreadable ({error})')
            continue
        ascii_text = raw.split(b'\x00', 1)[0]
        if len(ascii_text) <= 1 and len(raw) > 3 and raw[1] == 0:
            wide = raw.decode('utf-16-le', errors='replace').split('\x00', 1)[0]
            print(f'{token} (rva {rva:#x}) utf16: {wide!r}')
        else:
            print(f'{token} (rva {rva:#x}) ascii: {ascii_text.decode("utf-8", errors="replace")!r}')


if __name__ == '__main__':
    main()
