$ErrorActionPreference = 'Stop'
$code = @'
import ctypes as c, ctypes.wintypes as w, struct, datetime, json, bisect, pefile, capstone
k=c.WinDLL('kernel32',use_last_error=True); n=c.WinDLL('ntdll')
k.OpenProcess.argtypes=[w.DWORD,w.BOOL,w.DWORD]; k.OpenProcess.restype=w.HANDLE
k.OpenThread.argtypes=[w.DWORD,w.BOOL,w.DWORD]; k.OpenThread.restype=w.HANDLE
k.ReadProcessMemory.argtypes=[w.HANDLE,c.c_void_p,c.c_void_p,c.c_size_t,c.POINTER(c.c_size_t)]; k.ReadProcessMemory.restype=w.BOOL
k.GetProcessIdOfThread.argtypes=[w.HANDLE]; k.GetProcessIdOfThread.restype=w.DWORD
k.GetProcessTimes.argtypes=[w.HANDLE]+[c.POINTER(w.FILETIME)]*4; k.GetThreadTimes.argtypes=[w.HANDLE]+[c.POINTER(w.FILETIME)]*4; k.CloseHandle.argtypes=[w.HANDLE]
class T(c.Structure): _fields_=[('exit',c.c_long),('teb',c.c_void_p),('pid',c.c_void_p),('tid',c.c_void_p),('aff',c.c_void_p),('prio',c.c_long),('bp',c.c_long)]
n.NtQueryInformationThread.argtypes=[w.HANDLE,w.ULONG,c.c_void_p,w.ULONG,c.c_void_p]
p=k.OpenProcess(0x410,0,24036)
if not p: raise OSError(c.get_last_error(),'OpenProcess')
t=k.OpenThread(0x40,0,59956)
if not t:
 err=c.get_last_error(); k.CloseHandle(p); raise OSError(err,'OpenThread')
def times(h,fn):
 x=[w.FILETIME() for _ in range(4)]
 if not fn(h,*map(c.byref,x)): raise OSError(c.get_last_error(),'times')
 return x[0].dwLowDateTime+(x[0].dwHighDateTime<<32)
def identity():
 if times(p,k.GetProcessTimes)!=134387250823263004 or times(t,k.GetThreadTimes)!=134387250823263010 or k.GetProcessIdOfThread(t)!=24036: raise RuntimeError('identity')
def read(a,n):
 b=c.create_string_buffer(n); got=c.c_size_t()
 if not k.ReadProcessMemory(p,a,b,n,c.byref(got)) or got.value!=n: raise OSError(c.get_last_error(),'read')
 return b.raw
def bounds():
 i=T()
 if n.NtQueryInformationThread(t,0,c.byref(i),c.sizeof(i),None): raise RuntimeError('thread query')
 _,base,limit=struct.unpack('<QQQ',read(i.teb,24)); return (i.teb,base,limit)
try:
 identity(); b1=bounds(); rsp=0x14e208; base=b1[1]
 if not b1[2]<=rsp<base or base-rsp>65536: raise RuntimeError('captured RSP outside bounded stack')
 first=read(rsp,base-rsp); second=read(rsp,base-rsp); b2=bounds(); identity()
 if b1!=b2: raise RuntimeError('TEB bounds changed')
 pe=pefile.PE(r'C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe')
 if pe.FILE_HEADER.TimeDateStamp!=0x6adf121b: raise RuntimeError('image timestamp')
 functions=pe.DIRECTORY_ENTRY_EXCEPTION; starts=[x.struct.BeginAddress for x in functions]; md=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64); results=[]
 for off in range(0,len(first)-7,8):
  addr=struct.unpack_from('<Q',first,off)[0]; rva=addr-0x140000000; i=bisect.bisect_right(starts,rva)-1
  if i<0 or rva>=functions[i].struct.EndAddress or rva-starts[i]>65536: continue
  ins=list(md.disasm(pe.get_data(starts[i],rva-starts[i]),0x140000000+starts[i]))
  if ins and ins[-1].address+ins[-1].size==addr and ins[-1].mnemonic=='call': results.append({'rsp_offset':hex(off),'rva':hex(rva),'function':hex(starts[i]),'call':ins[-1].op_str,'slot_stable':first[off:off+8]==second[off:off+8]})
 print(json.dumps({'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'rsp_from_prior_capture':hex(rsp),'stack_base':hex(base),'stack_limit':hex(b1[2]),'bytes_per_read':len(first),'buffers_equal':first==second,'candidates':results,'warning':'prior context and later reads not synchronous; instruction scan not proof of frame'},indent=2))
finally: k.CloseHandle(t); k.CloseHandle(p)
'@
$code | python -
if ($LASTEXITCODE -ne 0) { throw "Read-only candidate scan failed: $LASTEXITCODE" }
