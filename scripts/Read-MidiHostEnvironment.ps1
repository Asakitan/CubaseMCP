[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$TargetProcessId)
$ErrorActionPreference = 'Stop'
$result = [ordered]@{ pid=$TargetProcessId; timestampUtc=[DateTime]::UtcNow.ToString('o'); status='error'; error=$null;
    inputs=@(); outputs=@(); stable=$false; processAliveAfter=$false; processStartUtc=$null; launchMetadataUtc=$null;
    executable=$null; fileVersion=$null; desktopWindows=$null;
    limitation='Read-only snapshot of host model names; not proof of detector execution, binding or activation.' }
$source = @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class MidiHostEnvironmentReader {
 const ulong Base=0x140000000, ModelGlobal=0x595a4c8, ModelVt=0x45fae68, EnvVt=0x45fa638, InputVt=0x45fa5a8, OutputVt=0x45fa608;
 [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int id);
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool ReadProcessMemory(IntPtr process,IntPtr address,byte[] bytes,int count,out IntPtr got);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 delegate bool EnumProc(IntPtr window,IntPtr state);
 [DllImport("user32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr OpenDesktopW(string name,uint flags,bool inherit,uint access);
 [DllImport("user32.dll",SetLastError=true)] static extern bool EnumDesktopWindows(IntPtr desktop,EnumProc cb,IntPtr state);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
 [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
 public sealed class Port { public string name; public string objectAddress; public string runtimeId; }
 public sealed class Snapshot { public string model; public string environment; public List<Port> inputs=new List<Port>(); public List<Port> outputs=new List<Port>(); public bool stable; }
 static ulong Q(byte[] a,int offset) { return BitConverter.ToUInt64(a,offset); }
 static byte[] Read(IntPtr p,ulong address,int n) { if(address==0 || n<1 || n>4096) throw new InvalidOperationException("read bounds"); var b=new byte[n]; IntPtr got; if(!ReadProcessMemory(p,(IntPtr)(long)address,b,n,out got)||got.ToInt64()!=n)throw new Win32Exception(Marshal.GetLastWin32Error(),"ReadProcessMemory");return b; }
 static bool Same(byte[] a,byte[] b) { if(a.Length!=b.Length)return false;for(int i=0;i<a.Length;i++)if(a[i]!=b[i])return false;return true; }
 static string Text(IntPtr p,byte[] objectBytes) { ulong len=Q(objectBytes,0x38),cap=Q(objectBytes,0x40); if(len>512||cap<len||cap>1048576)throw new InvalidOperationException("string bounds");if(len==0)return ""; byte[] bytes=new byte[(int)len];if(cap<=15)Array.Copy(objectBytes,0x28,bytes,0,(int)len);else bytes=Read(p,Q(objectBytes,0x28),(int)len); return new UTF8Encoding(false,true).GetString(bytes); }
 static List<Port> ReadVector(IntPtr p,byte[] env,int off,ulong expectedVt) {
   ulong start=Q(env,off),end=Q(env,off+8),cap=Q(env,off+16);
   if(start==0 && end==0 && cap==0)return new List<Port>();
   if(start==0||end<start||cap<end||(end-start)%16!=0||(cap-start)%16!=0||(end-start)/16>64||(cap-start)/16>128)throw new InvalidOperationException("vector bounds");
   int n=(int)((end-start)/16); var contents=n==0?new byte[0]:Read(p,start,n*16);var ports=new List<Port>();
   for(int i=0;i<n;i++) { ulong obj=Q(contents,i*16); if(obj==0||Q(contents,i*16+8)==0)throw new InvalidOperationException("invalid shared reference");var a=Read(p,obj,0x48);if(Q(a,0)!=Base+expectedVt)throw new InvalidOperationException("port vtable mismatch");string name=Text(p,a);var b=Read(p,obj,0x48);string again=Text(p,b);if(!Same(a,b)||name!=again)throw new InvalidOperationException("port changed during read");ports.Add(new Port{name=name,objectAddress="0x"+obj.ToString("x"),runtimeId="0x"+Q(a,0x18).ToString("x")}); }
   if(n>0&&!Same(contents,Read(p,start,n*16)))throw new InvalidOperationException("vector elements changed");return ports;
 }
 public static int DesktopWindows(int pid) {var d=OpenDesktopW("CubaseAI_MCP",0,false,0x41);if(d==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error(),"OpenDesktop");try{int count=0;if(!EnumDesktopWindows(d,(IntPtr w,IntPtr s)=>{uint owner;GetWindowThreadProcessId(w,out owner);if(owner==(uint)pid)count++;return true;},IntPtr.Zero))throw new Win32Exception(Marshal.GetLastWin32Error(),"EnumDesktopWindows");return count;}finally{CloseDesktop(d);}}
 public static Snapshot ReadSnapshot(int pid) {var p=OpenProcess(0x410,false,pid);if(p==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error(),"OpenProcess");try{
   var firstGlobal=Read(p,Base+ModelGlobal,16);ulong model=Q(firstGlobal,0);var modelA=Read(p,model,0x60);if(Q(modelA,0)!=Base+ModelVt)throw new InvalidOperationException("model vtable mismatch");ulong env=Q(modelA,0x50);var envA=Read(p,env,0x58);if(Q(envA,0)!=Base+EnvVt)throw new InvalidOperationException("environment vtable mismatch");
   var r=new Snapshot{model="0x"+model.ToString("x"),environment="0x"+env.ToString("x")};r.inputs=ReadVector(p,envA,0x28,InputVt);r.outputs=ReadVector(p,envA,0x40,OutputVt);
   var envB=Read(p,env,0x58);var modelB=Read(p,model,0x60);var globalB=Read(p,Base+ModelGlobal,16);r.stable=Same(firstGlobal,globalB)&&Same(modelA,modelB)&&Same(envA,envB);if(!r.stable)throw new InvalidOperationException("headers changed during read");return r;
 }finally{CloseHandle(p);}}
}
'@
try {
    $root=Split-Path -Parent $PSScriptRoot
    $launchPath=Join-Path $root 'artifacts\runtime\cubase-launch.json'
    $launchItem=Get-Item -LiteralPath $launchPath
    $launch=Get-Content -LiteralPath $launchPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if($launch.ProcessId -ne $TargetProcessId -or $launch.Desktop -ne 'winsta0\CubaseAI_MCP') { throw 'Launch PID or desktop mismatch.' }
    $process=Get-Process -Id $TargetProcessId
    $startUtc=$process.StartTime.ToUniversalTime()
    if($startUtc -gt $launchItem.LastWriteTimeUtc.AddSeconds(2)) { throw 'Process started after launch metadata; PID may have been reused.' }
    $result.processStartUtc=$startUtc.ToString('o'); $result.launchMetadataUtc=$launchItem.LastWriteTimeUtc.ToString('o')
    $path=$process.MainModule.FileName
    if($path -ne 'C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe') { throw 'Executable mismatch.' }
    $version=(Get-Item -LiteralPath $path).VersionInfo.FileVersion
    if($version -ne '16.0.5.174') { throw "Executable version mismatch: $version" }
    if($process.MainModule.BaseAddress.ToInt64() -ne 0x140000000) { throw 'Image base mismatch.' }
    Add-Type $source
    $result.executable=$path; $result.fileVersion=$version
    $result.desktopWindows=[MidiHostEnvironmentReader]::DesktopWindows($TargetProcessId)
    if($result.desktopWindows -lt 1) { throw 'Private desktop ownership not observed.' }
    $snapshot=[MidiHostEnvironmentReader]::ReadSnapshot($TargetProcessId)
    $result.inputs=$snapshot.inputs; $result.outputs=$snapshot.outputs; $result.stable=$snapshot.stable
    $result.model=$snapshot.model; $result.environment=$snapshot.environment
    $post=Get-Process -Id $TargetProcessId
    if($post.StartTime.ToUniversalTime() -ne $startUtc) { throw 'Process changed during the observation.' }
    $result.status='observed'
} catch { $result.error=$_.Exception.ToString() }
$result.processAliveAfter=[bool](Get-Process -Id $TargetProcessId -ErrorAction SilentlyContinue)
$result | ConvertTo-Json -Depth 6
if($result.status -ne 'observed') { exit 1 }
