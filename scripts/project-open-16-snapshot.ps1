param([Parameter(Mandatory=$true)][int]$TargetProcessId)
$ErrorActionPreference='Stop'
$src=@"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class ProjectOpen16Read {
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint a,bool i,int p);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool ReadProcessMemory(IntPtr p,IntPtr a,byte[] b,int n,out IntPtr r);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr p);
 delegate bool EnumProc(IntPtr w,IntPtr l);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr OpenDesktopW(string s,uint f,bool i,uint a);
 [DllImport("user32.dll",SetLastError=true)] static extern bool EnumDesktopWindows(IntPtr d,EnumProc f,IntPtr p);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr w,out uint p);
 [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr d);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr w,System.Text.StringBuilder b,int n);
 public static int Desktop(int pid) { IntPtr d=OpenDesktopW("CubaseAI_MCP",0,false,0x41); if(d==IntPtr.Zero) throw new Win32Exception(); try {int n=0; EnumProc cb=(IntPtr w,IntPtr l)=>{uint p;GetWindowThreadProcessId(w,out p);if(p==pid)n++;return true;}; if(!EnumDesktopWindows(d,cb,IntPtr.Zero))throw new Win32Exception();GC.KeepAlive(cb);return n;}finally{CloseDesktop(d);} }
 public static string WindowThreads(int pid) { IntPtr d=OpenDesktopW("CubaseAI_MCP",0,false,0x41); if(d==IntPtr.Zero) throw new Win32Exception(); try {var x=new System.Collections.Generic.SortedSet<uint>(); EnumProc cb=(IntPtr w,IntPtr l)=>{uint p;uint t=GetWindowThreadProcessId(w,out p);if(p==pid)x.Add(t);return true;};if(!EnumDesktopWindows(d,cb,IntPtr.Zero))throw new Win32Exception();GC.KeepAlive(cb);return string.Join(",",x);}finally{CloseDesktop(d);} }
 public static string WindowTitles(int pid) { IntPtr d=OpenDesktopW("CubaseAI_MCP",0,false,0x41); if(d==IntPtr.Zero) throw new Win32Exception(); try {var x=new System.Collections.Generic.List<string>(); EnumProc cb=(IntPtr w,IntPtr l)=>{uint p;uint t=GetWindowThreadProcessId(w,out p);if(p==pid){var b=new System.Text.StringBuilder(512);GetWindowTextW(w,b,b.Capacity);if(b.Length>0)x.Add(t+":"+b.ToString());}return true;};if(!EnumDesktopWindows(d,cb,IntPtr.Zero))throw new Win32Exception();GC.KeepAlive(cb);return string.Join(" | ",x);}finally{CloseDesktop(d);} }
 static byte[] R(IntPtr h,ulong a,int n){var b=new byte[n];IntPtr k;if(!ReadProcessMemory(h,(IntPtr)(long)a,b,n,out k)||k.ToInt64()!=n)throw new Win32Exception(Marshal.GetLastWin32Error());return b;}
 static ulong Q(IntPtr h,ulong a){return BitConverter.ToUInt64(R(h,a,8),0);}
 public static string Snapshot(int pid){IntPtr h=OpenProcess(0x410,false,pid);if(h==IntPtr.Zero)throw new Win32Exception();try{
 const ulong B=0x140000000; ulong pred=Q(h,B+0x5973dd0),app=Q(h,B+0x5972e30),flags=Q(h,B+0x59110d0); if(pred==0||app==0||flags==0)throw new InvalidOperationException("Required global is null");
 ulong source=Q(h,B+0x597d000); if(source==0)throw new InvalidOperationException("Platform source is null; fallback not sampled"); ulong sv=Q(h,source+8); if(sv!=B+0x4797908)throw new InvalidOperationException("Unexpected factory vtable"); ulong sm=Q(h,sv+0x48); if(sm!=B+0x18f7d00)throw new InvalidOperationException("Unexpected factory slot"); ulong resultV=Q(h,source+0x48); if(resultV!=B+0x4799968)throw new InvalidOperationException("Unexpected event handler vtable"); ulong resultMethod=Q(h,resultV+0xb0); ulong vt=Q(h,pred+0x10),method=Q(h,vt+0x88),avt=Q(h,app);byte[] f=R(h,flags+0x70,2), tid=R(h,source+0x1c0,4);
 if(resultV!=Q(h,source+0x48)||resultMethod!=Q(h,resultV+0xb0)||source!=Q(h,B+0x597d000)||sv!=Q(h,source+8)||sm!=Q(h,sv+0x48)||pred!=Q(h,B+0x5973dd0)||app!=Q(h,B+0x5972e30)||flags!=Q(h,B+0x59110d0)||vt!=Q(h,pred+0x10)||method!=Q(h,vt+0x88)||avt!=Q(h,app))throw new InvalidOperationException("Snapshot changed");byte[] t2=R(h,source+0x1c0,4); if(BitConverter.ToUInt32(tid,0)!=BitConverter.ToUInt32(t2,0))throw new InvalidOperationException("Thread ID changed");byte[] g=R(h,flags+0x70,2);if(f[0]!=g[0]||f[1]!=g[1])throw new InvalidOperationException("State bytes changed");
 return string.Format("eventHandlerThreadId={13};source=0x{8:x};sourceVtableRva=0x{9:x};sourceSlot48Rva=0x{10:x};resultVtableRva=0x{11:x};resultSlotB0Rva=0x{12:x};predicate=0x{0:x};predicateVtableRva=0x{1:x};predicateMethodRva=0x{2:x};app=0x{3:x};appVtableRva=0x{4:x};stateGlobal=0x{5:x};state70={6};state71={7}",pred,vt-B,method-B,app,avt-B,flags,f[0],f[1],source,sv-B,sm-B,resultV-B,resultMethod-B,BitConverter.ToUInt32(tid,0));
 }finally{CloseHandle(h);}}
}
"@
$root=Split-Path -Parent $PSScriptRoot
$receipt=Join-Path $root 'artifacts\runtime\cubase-launch.json'
$l=Get-Content -Raw -Encoding utf8 $receipt|ConvertFrom-Json
if($l.ProcessId -ne $TargetProcessId -or $l.Desktop -ne 'winsta0\CubaseAI_MCP'){throw 'Launch receipt mismatch'}
$p=Get-Process -Id $TargetProcessId;$start=$p.StartTime.ToUniversalTime();if($start -gt (Get-Item $receipt).LastWriteTimeUtc.AddSeconds(2)){throw 'Process start mismatch'}
$path=$p.MainModule.FileName;if($path -ne 'C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe' -or $p.MainModule.BaseAddress.ToInt64() -ne 0x140000000 -or (Get-Item $path).VersionInfo.FileVersion -ne '16.0.5.174'){throw 'Image profile mismatch'}
$f=[System.IO.File]::OpenRead($path);try{$r=[System.IO.BinaryReader]::new($f);$f.Position=0x3c;$o=$r.ReadUInt32();$f.Position=$o;if($r.ReadUInt32() -ne 0x4550 -or $r.ReadUInt16() -ne 0x8664){throw 'PE machine mismatch'};$f.Position=$o+8;if($r.ReadUInt32() -ne 0x6adf121b){throw 'PE timestamp mismatch'}}finally{$f.Dispose()}
Add-Type -TypeDefinition $src
if([ProjectOpen16Read]::Desktop($TargetProcessId) -lt 1){throw 'Private desktop ownership absent'}
$s=[ProjectOpen16Read]::Snapshot($TargetProcessId)
if((Get-Process -Id $TargetProcessId).StartTime.ToUniversalTime() -ne $start){throw 'Process identity changed'}
[ordered]@{timestampUtc=[DateTime]::UtcNow.ToString('o');pid=$TargetProcessId;processStartUtc=$start.ToString('o');privateWindowThreadIds=[ProjectOpen16Read]::WindowThreads($TargetProcessId);privateWindowTitles=[ProjectOpen16Read]::WindowTitles($TargetProcessId);snapshot=$s;limitation='Unlocked repeated reads only; no virtual calls, project operation, thread or completion proof.'}|ConvertTo-Json
