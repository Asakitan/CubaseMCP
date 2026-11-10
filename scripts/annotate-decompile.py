"""Read-only research helper: print a Ghidra C listing with the literal text found at referenced
image addresses appended to each line. Only reads the installed PE file and the listing.

Usage: python scripts/annotate-decompile.py <pe path> <listing.c> [--grep REGEX] [--context N]
"""
import re
import sys

import pefile


def text_at(pe, base, address):
    rva = address - base
    try:
        raw = pe.get_data(rva, 96)
    except Exception:
        return None
    ascii_text = raw.split(b'\x00', 1)[0]
    if 3 <= len(ascii_text) <= 90 and all(32 <= c < 127 for c in ascii_text):
        return ascii_text.decode('ascii')
    if len(raw) > 6 and raw[1] == 0 and raw[3] == 0:
        wide = raw.decode('utf-16-le', errors='ignore').split('\x00', 1)[0]
        if 3 <= len(wide) <= 45 and all(32 <= ord(c) < 127 for c in wide):
            return 'L:' + wide
    return None


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    pe = pefile.PE(sys.argv[1], fast_load=True)
    base = pe.OPTIONAL_HEADER.ImageBase
    pattern = None
    context = 0
    if '--grep' in sys.argv:
        pattern = re.compile(sys.argv[sys.argv.index('--grep') + 1])
    if '--context' in sys.argv:
        context = int(sys.argv[sys.argv.index('--context') + 1])
    cache = {}
    lines = open(sys.argv[2], encoding='utf-8', errors='replace').read().splitlines()
    annotated = []
    for line in lines:
        notes = []
        for match in re.finditer(r'(?:UNK|DAT|PTR|s)_[A-Za-z0-9_]*?(14[0-9a-f]{7})\b|0x(14[0-9a-f]{7})\b', line):
            address = int(match.group(1) or match.group(2), 16)
            if address not in cache:
                cache[address] = text_at(pe, base, address)
            if cache[address]:
                notes.append(f'{address - base:#x}="{cache[address]}"')
        annotated.append(line + ('    // ' + ' '.join(notes) if notes else ''))
    if pattern is None:
        print('\n'.join(annotated))
        return
    shown = set()
    for index, line in enumerate(annotated):
        if pattern.search(line):
            for position in range(max(0, index - context), min(len(annotated), index + context + 1)):
                if position not in shown:
                    shown.add(position)
                    print(f'{position + 1:5d}: {annotated[position]}')
            print('    ---')


if __name__ == '__main__':
    main()
