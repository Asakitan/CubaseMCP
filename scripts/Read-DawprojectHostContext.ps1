[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$TargetProcessId)
$ErrorActionPreference = 'Stop'
$result = [ordered]@{pid=$TargetProcessId;timestampUtc=[DateTime]::UtcNow.ToString('o');status='error';error=$null;processStartUtc=$null;launchMetadataUtc=$null;desktopWindows=$null;processAliveAfter=$false;stable=$false;project=$null;projectVtableRva=$null;context=$null;contextVtable=$null;contextSubobject=$null;contextSubobjectVtable=$null;listeners=$null;limitation='Read-only unpinned snapshot; private desktop window ownership does not prove every thread desktop, active project, host attachment or thread safety.'}
$source = @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class DawHostSnapshot {
 const ulong Base=0x140000000, ProjectGlobal=0x59110d0, ProjectVtable=0x447d378;
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int id);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool ReadProcessMemory(IntPtr p,IntPtr addr,byte[] b,int n,out IntPtr got);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 delegate bool Callback(IntPtr window,IntPtr state);
 [DllImport("user32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr OpenDesktopW(string n,uint f,bool i,uint a);
 [DllImport("user32.dll",SetLastError=true)] static extern bool EnumDesktopWindows(IntPtr d,Callback cb,IntPtr state);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr w,out uint pid);
 [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr d);
 static ulong ReadQ(IntPtr p,ulong a){var b=new byte[8];IntPtr got;if(!ReadProcessMemory(p,(IntPtr)(long)a,b,8,out got)||got.ToInt64()!=8)throw new Win32Exception(Marshal.GetLastWin32Error(),"ReadProcessMemory");return BitConverter.ToUInt64(b,0);}
 public static int DesktopWindows(int pid){var d=OpenDesktopW("CubaseAI_MCP",0,false,0x41);if(d==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error(),"OpenDesktop");try{int n=0;if(!EnumDesktopWindows(d,(IntPtr w,IntPtr s)=>{uint owner;GetWindowThreadProcessId(w,out owner);if(owner==(uint)pid)n++;return true;},IntPtr.Zero))throw new Win32Exception(Marshal.GetLastWin32Error(),"EnumDesktopWindows");return n;}finally{CloseDesktop(d);}}
 public static string[] Read(int pid){var p=OpenProcess(0x410,false,pid);if(p==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error(),"OpenProcess");try{ulong g=ReadQ(p,Base+ProjectGlobal);if(g==0){if(ReadQ(p,Base+ProjectGlobal)!=0)throw new InvalidOperationException("global changed");return new string[]{"0x0",null,null,null,null};}ulong vt=ReadQ(p,g);if(vt!=Base+ProjectVtable)throw new InvalidOperationException("project vtable mismatch");ulong ctx=ReadQ(p,g+0xf8),cv=0,sv=0;if(ctx!=0){cv=ReadQ(p,ctx);if(cv!=Base+0x4471c40)throw new InvalidOperationException("context vtable mismatch");sv=ReadQ(p,ctx+0x98);if(sv!=Base+0x4472130)throw new InvalidOperationException("context subobject vtable mismatch");}if(ReadQ(p,Base+ProjectGlobal)!=g||ReadQ(p,g)!=vt||ReadQ(p,g+0xf8)!=ctx||(ctx!=0&&(ReadQ(p,ctx)!=cv||ReadQ(p,ctx+0x98)!=sv)))throw new InvalidOperationException("snapshot changed");return new string[]{"0x"+g.ToString("x"),"0x"+(vt-Base).ToString("x"),"0x"+ctx.ToString("x"),ctx==0?null:"0x"+cv.ToString("x"),ctx==0?null:"0x"+sv.ToString("x")};}finally{CloseHandle(p);}}
 public sealed class ListResult { public string container; public string informer; public uint count; public string head; public bool informerFound; public bool stable; }
 public static ListResult Listeners(int pid){var p=OpenProcess(0x410,false,pid);if(p==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error(),"OpenProcess");try{ulong project=ReadQ(p,Base+ProjectGlobal);if(project==0||ReadQ(p,project)!=Base+ProjectVtable)throw new InvalidOperationException("project missing or changed");ulong container=project+0xc8;if(ReadQ(p,container)!=Base+0x447d2f8)throw new InvalidOperationException("listener container vtable mismatch");ulong countWord=ReadQ(p,container+0x10);uint count=(uint)countWord;if(count>128)throw new InvalidOperationException("listener count bound");ulong head=ReadQ(p,container+0x18),informer=ReadQ(p,Base+0x5909af0);if(informer!=0&&ReadQ(p,informer)!=Base+0x4452800)throw new InvalidOperationException("informer vtable mismatch");var nodes=new List<ulong>();var nexts=new List<ulong>();var values=new List<ulong>();ulong cur=head;while(cur!=0){if(nodes.Count>=128||nodes.Contains(cur))throw new InvalidOperationException("list bound or cycle");nodes.Add(cur);nexts.Add(ReadQ(p,cur));values.Add(ReadQ(p,cur+8));cur=nexts[nexts.Count-1];}if(nodes.Count!=count)throw new InvalidOperationException("list count mismatch");bool found=false;for(int i=0;i<nodes.Count;i++){if(informer!=0&&values[i]==informer+0x20)found=true;if(ReadQ(p,nodes[i])!=nexts[i]||ReadQ(p,nodes[i]+8)!=values[i])throw new InvalidOperationException("listener node changed");}if(ReadQ(p,Base+ProjectGlobal)!=project||ReadQ(p,project)!=Base+ProjectVtable||ReadQ(p,container)!=Base+0x447d2f8||ReadQ(p,container+0x10)!=countWord||ReadQ(p,container+0x18)!=head||ReadQ(p,Base+0x5909af0)!=informer)throw new InvalidOperationException("listener header changed");return new ListResult{container="0x"+container.ToString("x"),informer="0x"+informer.ToString("x"),count=count,head="0x"+head.ToString("x"),informerFound=found,stable=true};}finally{CloseHandle(p);}}
}
'@
try {
 $root=Split-Path -Parent $PSScriptRoot
 $launchPath=Join-Path $root 'artifacts\runtime\cubase-launch.json';$item=Get-Item -LiteralPath $launchPath;$launch=Get-Content -LiteralPath $launchPath -Raw -Encoding UTF8|ConvertFrom-Json
 if($launch.ProcessId -ne $TargetProcessId -or $launch.Desktop -ne 'winsta0\CubaseAI_MCP'){throw 'Launch PID or desktop mismatch.'}
 $p=Get-Process -Id $TargetProcessId;$start=$p.StartTime.ToUniversalTime();if($start -gt $item.LastWriteTimeUtc.AddSeconds(2)){throw 'Process started after launch metadata.'}
 $result.processStartUtc=$start.ToString('o');$result.launchMetadataUtc=$item.LastWriteTimeUtc.ToString('o')
 $path=$p.MainModule.FileName;if($path -ne 'C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe'){throw 'Executable mismatch.'}
 $version=(Get-Item -LiteralPath $path).VersionInfo.FileVersion;if($version -ne '16.0.5.174'){throw "Executable version mismatch: $version"}
 if($p.MainModule.BaseAddress.ToInt64() -ne 0x140000000){throw 'Image base mismatch.'}
 Add-Type -TypeDefinition $source;$result.desktopWindows=[DawHostSnapshot]::DesktopWindows($TargetProcessId);if($result.desktopWindows -lt 1){throw 'Private desktop ownership not observed.'}
 $v=[DawHostSnapshot]::Read($TargetProcessId);$result.project=$v[0];$result.projectVtableRva=$v[1];$result.context=$v[2];$result.contextVtable=$v[3];$result.contextSubobject=if($v[2] -and $v[2] -ne '0x0'){'0x'+([Convert]::ToUInt64($v[2].Substring(2),16)+0x98).ToString('x')}else{$null};$result.contextSubobjectVtable=$v[4];$result.stable=$true
 $result.listeners=[DawHostSnapshot]::Listeners($TargetProcessId)
 if($v[0] -eq '0x0' -or [Convert]::ToUInt64($result.listeners.container.Substring(2),16) -ne ([Convert]::ToUInt64($v[0].Substring(2),16)+0xc8)){throw 'Project changed between observations.'}
 if((Get-Process -Id $TargetProcessId).StartTime.ToUniversalTime() -ne $start){throw 'Process changed during observation.'}
 $result.status='observed'
} catch {$result.error=$_.Exception.Message}
$result.processAliveAfter=[bool](Get-Process -Id $TargetProcessId -ErrorAction SilentlyContinue)
$result|ConvertTo-Json -Depth 5
if($result.status -ne 'observed'){exit 1}
