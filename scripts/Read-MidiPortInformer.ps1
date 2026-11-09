[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$TargetProcessId)
$ErrorActionPreference='Stop'
$result=[ordered]@{ pid=$TargetProcessId; timestampUtc=[DateTime]::UtcNow.ToString('o'); status='error'; error=$null;
    processStartUtc=$null; launchMetadataUtc=$null; executable=$null; fileVersion=$null; desktopWindows=$null;
    processAliveAfter=$false; data=$null; limitation='Read-only point-in-time registry snapshot; no callback delivery or detection outcome is inferred.' }
$source=@'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class MidiPortInformerReader {
 const ulong Base=0x140000000, Root=0x590a1b0, RootVt=0x4454c88, AdapterVt=0x4454a30, AdapterSecondary=0x4454a40, InformerGlobal=0x5909af0, InformerVt=0x4452800, InformerSecondary=0x4452970, PortSourceGlobal=0x5512810, PortRegistry=0x5928a80, PortRegistryVt=0x44d8308, PortRegistrySecondary=0x44d83d8, PortArrayVt=0x4825ab8, MmeInVt=0x45d1280, MmeOutVt=0x45d1520, FStringVt=0x4190c98, IdleGateGlobal=0x5973dd0;
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int id);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool ReadProcessMemory(IntPtr process,IntPtr address,byte[] b,int n,out IntPtr got);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 delegate bool EnumProc(IntPtr window,IntPtr state);
 [DllImport("user32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr OpenDesktopW(string name,uint flags,bool inherit,uint access);
 [DllImport("user32.dll",SetLastError=true)] static extern bool EnumDesktopWindows(IntPtr desktop,EnumProc cb,IntPtr state);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
 [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
 public sealed class PortEntry { public string address; public string vtable; public string type; public string name; }
 public sealed class Snapshot { public string adapter; public string informer; public bool informerInitialized; public int observerCount; public bool adapterObserverFound; public string treeHead; public string treeCount; public string idleTreeHead; public string idleTreeCount; public string portSource; public bool portRegistryPresent; public int? portRegistryCount; public int? portRegistryCapacity; public string portRegistryBuffer; public List<PortEntry> portRegistryItems=new List<PortEntry>(); public string idleGateObject; public bool stable; }
 static ulong Q(byte[] a,int o){return BitConverter.ToUInt64(a,o);}
 static byte[] Read(IntPtr p,ulong a,int n){if(a==0||n<1||n>4096)throw new InvalidOperationException("read bounds");var b=new byte[n];IntPtr got;if(!ReadProcessMemory(p,(IntPtr)(long)a,b,n,out got)||got.ToInt64()!=n)throw new Win32Exception(Marshal.GetLastWin32Error(),"ReadProcessMemory");return b;}
 static bool Same(byte[] a,byte[] b){if(a.Length!=b.Length)return false;for(int i=0;i<a.Length;i++)if(a[i]!=b[i])return false;return true;}
 static string PortName(IntPtr p,byte[] item){const int offset=0x50;if(Q(item,offset)!=Base+FStringVt)throw new InvalidOperationException("port name vtable mismatch");uint flags=BitConverter.ToUInt32(item,offset+0x10);int length=(int)(flags&0x3fffffff);if(length>512)throw new InvalidOperationException("port name length bound");if(length==0)return "";bool wide=(flags&0x40000000)!=0;ulong ptr=Q(item,offset+8);var bytes=Read(p,ptr,length*(wide?2:1));if(!Same(bytes,Read(p,ptr,bytes.Length)))throw new InvalidOperationException("port name changed");if(wide)return new UnicodeEncoding(false,false,true).GetString(bytes);foreach(byte c in bytes)if(c>127)throw new InvalidOperationException("non-ASCII narrow port name");return Encoding.ASCII.GetString(bytes);}
 public static int DesktopWindows(int pid){var d=OpenDesktopW("CubaseAI_MCP",0,false,0x41);if(d==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error(),"OpenDesktop");try{int n=0;if(!EnumDesktopWindows(d,(IntPtr w,IntPtr s)=>{uint owner;GetWindowThreadProcessId(w,out owner);if(owner==(uint)pid)n++;return true;},IntPtr.Zero))throw new Win32Exception(Marshal.GetLastWin32Error(),"EnumDesktopWindows");return n;}finally{CloseDesktop(d);}}
 public static Snapshot ReadSnapshot(int pid){var p=OpenProcess(0x410,false,pid);if(p==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error(),"OpenProcess");try{
  var root=Read(p,Base+Root,0xd0);if(Q(root,0)!=Base+RootVt)throw new InvalidOperationException("root vtable mismatch");ulong a=Q(root,0xc0);if(a==0)throw new InvalidOperationException("adapter absent");var adapter=Read(p,a,0xd8);if(Q(adapter,0)!=Base+AdapterVt||Q(adapter,0xd0)!=Base+AdapterSecondary)throw new InvalidOperationException("adapter vtable mismatch");
  var global=Read(p,Base+InformerGlobal,8);var source=Read(p,Base+PortSourceGlobal,8);var gate=Read(p,Base+IdleGateGlobal,8);ulong i=Q(global,0),registry=Q(source,0);var result=new Snapshot{adapter="0x"+a.ToString("x"),informer="0x"+i.ToString("x"),informerInitialized=i!=0,portSource="0x"+registry.ToString("x"),portRegistryPresent=registry!=0,idleGateObject="0x"+Q(gate,0).ToString("x")};
  byte[] registryData=null,registryItems=null;ulong buffer=0;if(registry!=0){if(registry!=Base+PortRegistry)throw new InvalidOperationException("port registry address mismatch");registryData=Read(p,registry,0x48);if(Q(registryData,0)!=Base+PortRegistryVt||Q(registryData,0x10)!=Base+PortRegistrySecondary||Q(registryData,0x20)!=Base+PortArrayVt)throw new InvalidOperationException("port registry vtable mismatch");int capacity=BitConverter.ToInt32(registryData,0x30),count=BitConverter.ToInt32(registryData,0x3c);buffer=Q(registryData,0x40);if(count<0||capacity<count||capacity>16384||count>256||(capacity>0&&buffer==0))throw new InvalidOperationException("port registry array bounds");result.portRegistryCount=count;result.portRegistryCapacity=capacity;result.portRegistryBuffer="0x"+buffer.ToString("x");if(count>0){registryItems=Read(p,buffer,count*8);for(int k=0;k<count;k++){ulong item=Q(registryItems,k*8);if(item==0)throw new InvalidOperationException("null registry item");var vt=Read(p,item,8);ulong v=Q(vt,0);if(v==0||!Same(vt,Read(p,item,8)))throw new InvalidOperationException("registry item changed");var entry=new PortEntry{address="0x"+item.ToString("x"),vtable="0x"+v.ToString("x")};if(v==Base+MmeInVt||v==Base+MmeOutVt){var port=Read(p,item,0x68);if(Q(port,0)!=v)throw new InvalidOperationException("port vtable changed");entry.type=v==Base+MmeInVt?"PMmeMidiInSocket":"PMmeMidiOutSocket";entry.name=PortName(p,port);if(!Same(port,Read(p,item,0x68)))throw new InvalidOperationException("port object changed");}result.portRegistryItems.Add(entry);}}}
  if(i==0){result.stable=Same(root,Read(p,Base+Root,0xd0))&&Same(adapter,Read(p,a,0xd8))&&Same(global,Read(p,Base+InformerGlobal,8))&&Same(source,Read(p,Base+PortSourceGlobal,8))&&Same(gate,Read(p,Base+IdleGateGlobal,8))&&(registryData==null||Same(registryData,Read(p,registry,0x48)))&&(registryItems==null||Same(registryItems,Read(p,buffer,registryItems.Length)));if(!result.stable)throw new InvalidOperationException("snapshot changed");return result;}
  var obj=Read(p,i,0x98);if(Q(obj,0)!=Base+InformerVt||Q(obj,0x30)!=Base+InformerSecondary)throw new InvalidOperationException("informer vtable mismatch");ulong begin=Q(obj,0x38),end=Q(obj,0x40),cap=Q(obj,0x48);
  if(begin==0&&end==0&&cap==0)result.observerCount=0;else{if(begin==0||end<begin||cap<end||(end-begin)%8!=0||(cap-begin)%8!=0||(end-begin)/8>128||(cap-begin)/8>256)throw new InvalidOperationException("observer vector bounds");result.observerCount=(int)((end-begin)/8);if(result.observerCount>0){var v=Read(p,begin,result.observerCount*8);for(int k=0;k<result.observerCount;k++)if(Q(v,k*8)==a+0xd0)result.adapterObserverFound=true;if(!Same(v,Read(p,begin,v.Length)))throw new InvalidOperationException("observer vector changed");}}
  result.treeHead="0x"+Q(obj,0x58).ToString("x");result.treeCount="0x"+Q(obj,0x60).ToString("x");if(Q(obj,0x60)>4096)throw new InvalidOperationException("tree count bound");
  result.idleTreeHead="0x"+Q(obj,0x88).ToString("x");result.idleTreeCount="0x"+Q(obj,0x90).ToString("x");
  result.stable=Same(root,Read(p,Base+Root,0xd0))&&Same(adapter,Read(p,a,0xd8))&&Same(global,Read(p,Base+InformerGlobal,8))&&Same(source,Read(p,Base+PortSourceGlobal,8))&&Same(gate,Read(p,Base+IdleGateGlobal,8))&&Same(obj,Read(p,i,0x98))&&(registryData==null||Same(registryData,Read(p,registry,0x48)))&&(registryItems==null||Same(registryItems,Read(p,buffer,registryItems.Length)));if(!result.stable)throw new InvalidOperationException("snapshot changed");return result;
 }finally{CloseHandle(p);}}
}
'@
try {
 $root=Split-Path -Parent $PSScriptRoot; $launchPath=Join-Path $root 'artifacts\runtime\cubase-launch.json';$launchItem=Get-Item -LiteralPath $launchPath
 $launch=Get-Content -LiteralPath $launchPath -Raw -Encoding UTF8|ConvertFrom-Json
 if([int]$launch.ProcessId -ne $TargetProcessId -or $launch.Desktop -cne 'winsta0\CubaseAI_MCP'){throw 'Launch PID or desktop mismatch.'}
 $p=Get-Process -Id $TargetProcessId;$start=$p.StartTime.ToUniversalTime();if($start -gt $launchItem.LastWriteTimeUtc.AddSeconds(2)){throw 'Process started after launch metadata.'}
 $path=$p.MainModule.FileName;if(-not [String]::Equals($path,'C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe',[StringComparison]::OrdinalIgnoreCase)){throw 'Executable mismatch.'}
 if($p.MainModule.BaseAddress.ToInt64() -ne 0x140000000){throw 'Image base mismatch.'};$version=(Get-Item -LiteralPath $path).VersionInfo.FileVersion;if($version -ne '16.0.5.174'){throw 'Executable version mismatch.'}
 $result.processStartUtc=$start.ToString('o');$result.launchMetadataUtc=$launchItem.LastWriteTimeUtc.ToString('o');$result.executable=$path;$result.fileVersion=$version
 Add-Type $source;$result.desktopWindows=[MidiPortInformerReader]::DesktopWindows($TargetProcessId);if($result.desktopWindows -lt 1){throw 'Private desktop ownership not observed.'}
 $result.data=[MidiPortInformerReader]::ReadSnapshot($TargetProcessId);$after=Get-Process -Id $TargetProcessId;if($after.StartTime.ToUniversalTime() -ne $start){throw 'Process changed during observation.'};$result.status='observed'
}catch{$result.error=$_.Exception.ToString()}
$result.processAliveAfter=[bool](Get-Process -Id $TargetProcessId -ErrorAction SilentlyContinue)
$result|ConvertTo-Json -Depth 6
if($result.status -ne 'observed'){exit 1}
