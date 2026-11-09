"""Read-only, bounded PE RTTI and code-reference inspection for the installed host.

Uses pefile/capstone in the diagnostic Python environment, not the MCP runtime.
It does not open or modify any process. Reports address observations, not an ABI.
"""
import argparse
import bisect
import json
import re
import struct
from pathlib import Path

import capstone
import pefile


def inspect(path, pattern, disasm_limit=200):
    pe = pefile.PE(str(path), fast_load=True)
    data = path.read_bytes()
    base = pe.OPTIONAL_HEADER.ImageBase
    sections = [(s.VirtualAddress, s.SizeOfRawData, s.PointerToRawData,
                 s.Characteristics, s.Name.rstrip(b"\0").decode()) for s in pe.sections]
    def off(rva):
        for va, size, raw, _, _ in sections:
            if va <= rva < va + size:
                return raw + rva - va
        raise ValueError("RVA outside file-backed section: " + hex(rva))
    def rva_at(offset):
        for va, size, raw, _, _ in sections:
            if raw <= offset < raw + size:
                return va + offset - raw
        raise ValueError("File offset outside section")
    def executable(rva):
        return any(va <= rva < va + size and flags & 0x20000000 for va,size,raw,flags,n in sections)
    def u32(rva): return struct.unpack_from("<I", data, off(rva))[0]
    def u64(rva): return struct.unpack_from("<Q", data, off(rva))[0]
    pdata = next(s for s in sections if s[4] == ".pdata")
    runtime_functions = []
    for p in range(pdata[2], pdata[2] + pdata[1] - 11, 12):
        start,end,unwind = struct.unpack_from("<III",data,p)
        if start and executable(start) and end > start:
            runtime_functions.append((start,end,unwind))
    runtime_functions.sort()
    starts = [f[0] for f in runtime_functions]
    def containing(rva):
        index = bisect.bisect_right(starts, rva) - 1
        return runtime_functions[index] if index >= 0 and rva < runtime_functions[index][1] else None
    disassembler = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    def disasm(rva):
        f = containing(rva)
        if not f: return {"rva":hex(rva),"function":None}
        begin,end,unwind = f
        raw = data[off(begin):off(begin) + min(end-begin,32768)]
        instructions = []
        for i,ins in enumerate(disassembler.disasm(raw,base+begin)):
            if i >= disasm_limit: break
            instructions.append(hex(ins.address-base) + " " + ins.mnemonic + " " + ins.op_str)
        return {"begin":hex(begin),"end":hex(end),"unwind":hex(unwind),
                "truncated": len(instructions) >= disasm_limit or end-begin > 32768,
                "instructions":instructions}
    # Restrict references to common seven-byte RIP-relative MOV/LEA encodings.
    riprefs = {}
    for va,size,raw,flags,name in sections:
        if not flags & 0x20000000: continue
        chunk = data[raw:raw+size]
        for match in re.finditer(rb"[\x48\x4c][\x8b\x8d][\x05\x0d\x15\x1d\x25\x2d\x35\x3d]....",chunk,re.DOTALL):
            site = va + match.start()
            target = site + 7 + struct.unpack_from("<i",chunk,match.start()+3)[0]
            riprefs.setdefault(target,[]).append(site)
    strings=[]
    for va,size,raw,flags,name in sections:
        if flags & 0x20000000: continue
        chunk=data[raw:raw+size]
        for m in re.finditer(rb"[\x20-\x7e]{5,600}",chunk):
            text=m.group().decode("ascii")
            if re.search(pattern,text,re.I):
                strings.append({"rva":hex(va+m.start()),"text":text})
    results=[]
    ro = [s for s in sections if not s[3] & 0x20000000]
    for string in strings[:80]:
        srva=int(string["rva"],16)
        row={**string,"code_references":[disasm(r) for r in riprefs.get(srva,[])[:16]],"rtti":[]}
        if string["text"].startswith((".?AV",".?AU")):
            td=srva-16
            needle=struct.pack("<I",td)
            for va,size,raw,flags,name in ro:
                chunk=data[raw:raw+size]
                p=0
                while True:
                    p=chunk.find(needle,p)
                    if p < 0: break
                    col=va+p-12
                    p+=1
                    try:
                        if u32(col) != 1 or u32(col+20) != col: continue
                        descriptor={"type_descriptor":hex(td),"col":hex(col),"offset":hex(u32(col+4)),"hierarchy":hex(u32(col+16)),"vtables":[]}
                        colptr=struct.pack("<Q",base+col)
                        for va2,size2,raw2,flags2,name2 in ro:
                            chunk2=data[raw2:raw2+size2]
                            q=0
                            while True:
                                q=chunk2.find(colptr,q)
                                if q < 0: break
                                vt=va2+q+8
                                q+=1
                                entries=[]
                                for slot in range(128):
                                    target=u64(vt+8*slot)-base
                                    if not executable(target): break
                                    entries.append(hex(target))
                                refs=riprefs.get(vt,[])
                                descriptor["vtables"].append({"rva":hex(vt),"entries":entries,"code_references":[disasm(r) for r in refs[:12]]})
                        row["rtti"].append(descriptor)
                    except (ValueError,struct.error): pass
        results.append(row)
    return {"module":str(path),"file_size":len(data),"image_base":hex(base),"pattern":pattern,
            "string_count":len(strings),"string_limit":80,"rip_reference_scope":"7-byte 48/4c MOV/LEA only",
            "results":results}


if __name__ == "__main__":
    ap=argparse.ArgumentParser()
    ap.add_argument("--module",type=Path,default=Path(r"C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe"))
    ap.add_argument("--pattern",default=r"ProjectPluginHost|IProjectPluginRequest|ISkiDispatcher|IProjectPluginService")
    ap.add_argument("--output",type=Path,required=True)
    ap.add_argument("--limit",type=int,default=200)
    args=ap.parse_args()
    if args.output.exists(): raise SystemExit("Output already exists: " + str(args.output))
    report=inspect(args.module,args.pattern,args.limit)
    with args.output.open("x",encoding="utf-8") as output:
        json.dump(report,output,indent=2)
    print(json.dumps({"output":str(args.output),"string_count":report["string_count"],"summary":[
        {"rva":r["rva"],"text":r["text"],"rtti":len(r["rtti"]),"references":len(r["code_references"])} for r in report["results"]]},indent=2))
