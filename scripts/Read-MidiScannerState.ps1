[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$TargetProcessId)
$ErrorActionPreference='Stop'
$result=[ordered]@{pid=$TargetProcessId;timestampUtc=[DateTime]::UtcNow.ToString('o');status='error';error=$null;
 processStartUtc=$null;launchMetadataUtc=$null;executable=$null;fileVersion=$null;desktopWindows=$null;processAliveAfter=$false;data=$null;
 limitation='Read-only point-in-time scanner record snapshot; no history, enumeration cause, callbacks or binding inferred.'}
$native=@'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class MidiScannerStateReader {
 const ulong Base=0x140000000, ScannerGlobal=0x58f8d00, ScannerVt=0x43efa28, InformerGlobal=0x5909af0, InformerVt=0x4452800;
 [DllImport("kernel32.dll",SetLastError=true)]static extern IntPtr OpenProcess(uint access,bool inherit,int id);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool ReadProcessMemory(IntPtr process,IntPtr address,byte[] bytes,int count,out IntPtr got);
 [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr h);
 delegate bool EnumProc(IntPtr window,IntPtr state);
 [DllImport("user32.dll",SetLastError=true,CharSet=CharSet.Unicode)]static extern IntPtr OpenDesktopW(string name,uint flags,bool inherit,uint access);
 [DllImport("user32.dll",SetLastError=true)]static extern bool EnumDesktopWindows(IntPtr desktop,EnumProc cb,IntPtr state);
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr w,out uint pid);
 [DllImport("user32.dll")]static extern bool CloseDesktop(IntPtr desktop);
 public sealed class Record {public int index;public string field0;public string field18;public string field30;public string field48;public uint flags0;public uint flags18;public uint flags30;public uint flags48;public string text0;public string text18;public string text30;public string text48;public string detailBegin;public string detailEnd;public string detailCapacity;public ulong detailByteCount;}
 public sealed class Snapshot {public bool scannerPresent;public string scanner;public string begin;public string end;public string capacity;public int count;public string informer;public int informerFlag50;public uint informerField54;public bool stable;public Record[] records;}
 static ulong Q(byte[] a,int o){return BitConverter.ToUInt64(a,o);}
 static byte[] Read(IntPtr p,ulong a,int n){if(a==0||n<1||n>4096)throw new InvalidOperationException("read bounds");var b=new byte[n];IntPtr got;if(!ReadProcessMemory(p,(IntPtr)(long)a,b,n,out got)||got.ToInt64()!=n)throw new Win32Exception(Marshal.GetLastWin32Error(),"ReadProcessMemory");return b;}
 static bool Same(byte[] a,byte[] b){if(a.Length!=b.Length)return false;for(int i=0;i<a.Length;i++)if(a[i]!=b[i])return false;return true;}
 static string StringValue(IntPtr p,byte[] record,int offset){if(Q(record,offset)!=Base+0x4190c98)throw new InvalidOperationException("FString vtable mismatch");uint flags=BitConverter.ToUInt32(record,offset+0x10);int n=(int)(flags&0x3fffffff);if(n>512)throw new InvalidOperationException("FString length bound");if(n==0)return "";bool wide=(flags&0x40000000)!=0;ulong ptr=Q(record,offset+8);var data=Read(p,ptr,n*(wide?2:1));if(!Same(data,Read(p,ptr,data.Length)))throw new InvalidOperationException("FString bytes changed");if(wide)return new UnicodeEncoding(false,false,true).GetString(data);foreach(byte b in data)if(b>127)throw new InvalidOperationException("Non-ASCII narrow string; encoding unverified");return Encoding.ASCII.GetString(data);}
 public static int DesktopWindows(int pid){var d=OpenDesktopW("CubaseAI_MCP",0,false,0x41);if(d==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error(),"OpenDesktop");try{int n=0;if(!EnumDesktopWindows(d,(IntPtr w,IntPtr s)=>{uint id;GetWindowThreadProcessId(w,out id);if(id==(uint)pid)n++;return true;},IntPtr.Zero))throw new Win32Exception(Marshal.GetLastWin32Error(),"EnumDesktopWindows");return n;}finally{CloseDesktop(d);}}
 public static Snapshot ReadSnapshot(int pid){var p=OpenProcess(0x410,false,pid);if(p==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error(),"OpenProcess");try{
  var global=Read(p,Base+ScannerGlobal,8);ulong s=Q(global,0);var info=Read(p,Base+InformerGlobal,8);ulong i=Q(info,0);var r=new Snapshot{scannerPresent=s!=0,scanner="0x"+s.ToString("x"),informer="0x"+i.ToString("x")};
  byte[] scan=null,informer=null;if(s!=0){scan=Read(p,s,0x380);if(Q(scan,0)!=Base+ScannerVt)throw new InvalidOperationException("scanner vtable mismatch");ulong a=Q(scan,0x358),b=Q(scan,0x360),c=Q(scan,0x368);r.begin="0x"+a.ToString("x");r.end="0x"+b.ToString("x");r.capacity="0x"+c.ToString("x");if(a==0&&b==0&&c==0)r.count=0;else{if(a==0||b<a||c<b||(b-a)%0x88!=0||(c-a)%0x88!=0||(b-a)/0x88>16||(c-a)/0x88>256)throw new InvalidOperationException("scanner vector bounds");r.count=(int)((b-a)/0x88);}
   r.records=new Record[r.count];for(int n=0;n<r.count;n++){ulong address=a+(ulong)(n*0x88);var x=Read(p,address,0x88);ulong d=Q(x,0x60),e=Q(x,0x68),f=Q(x,0x70);if((d!=0||e!=0||f!=0)&&(d==0||e<d||f<e||e-d>4096||f-d>8192))throw new InvalidOperationException("detail vector bounds");r.records[n]=new Record{index=n,field0="0x"+Q(x,0).ToString("x"),field18="0x"+Q(x,0x18).ToString("x"),field30="0x"+Q(x,0x30).ToString("x"),field48="0x"+Q(x,0x48).ToString("x"),flags0=BitConverter.ToUInt32(x,0x10),flags18=BitConverter.ToUInt32(x,0x28),flags30=BitConverter.ToUInt32(x,0x40),flags48=BitConverter.ToUInt32(x,0x58),text0=StringValue(p,x,0),text18=StringValue(p,x,0x18),text30=StringValue(p,x,0x30),text48=StringValue(p,x,0x48),detailBegin="0x"+d.ToString("x"),detailEnd="0x"+e.ToString("x"),detailCapacity="0x"+f.ToString("x"),detailByteCount=e-d};if(!Same(x,Read(p,address,0x88)))throw new InvalidOperationException("scanner record changed");}}
  if(i!=0){informer=Read(p,i,0x58);if(Q(informer,0)!=Base+InformerVt)throw new InvalidOperationException("informer vtable mismatch");r.informerFlag50=informer[0x50];r.informerField54=BitConverter.ToUInt32(informer,0x54);}
  r.stable=Same(global,Read(p,Base+ScannerGlobal,8))&&Same(info,Read(p,Base+InformerGlobal,8))&&(scan==null||Same(scan,Read(p,s,0x380)))&&(informer==null||Same(informer,Read(p,i,0x58)));if(!r.stable)throw new InvalidOperationException("snapshot changed");return r;
 }finally{CloseHandle(p);}}
}
'@
try {
 $root=Split-Path -Parent $PSScriptRoot;$launchPath=Join-Path $root 'artifacts\runtime\cubase-launch.json';$launchItem=Get-Item -LiteralPath $launchPath;$launch=Get-Content -LiteralPath $launchPath -Raw -Encoding UTF8|ConvertFrom-Json
 if([int]$launch.ProcessId -ne $TargetProcessId -or $launch.Desktop -cne 'winsta0\CubaseAI_MCP'){throw 'Launch PID or desktop mismatch.'}
 $p=Get-Process -Id $TargetProcessId;$start=$p.StartTime.ToUniversalTime();if($start -gt $launchItem.LastWriteTimeUtc.AddSeconds(2)){throw 'Process started after launch metadata.'}
 $path=$p.MainModule.FileName;if(-not [String]::Equals($path,'C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe',[StringComparison]::OrdinalIgnoreCase)){throw 'Executable mismatch.'}
 if($p.MainModule.BaseAddress.ToInt64() -ne 0x140000000){throw 'Image base mismatch.'};$version=(Get-Item -LiteralPath $path).VersionInfo.FileVersion;if($version -ne '16.0.5.174'){throw 'Executable version mismatch.'}
 $result.processStartUtc=$start.ToString('o');$result.launchMetadataUtc=$launchItem.LastWriteTimeUtc.ToString('o');$result.executable=$path;$result.fileVersion=$version
 Add-Type $native;$result.desktopWindows=[MidiScannerStateReader]::DesktopWindows($TargetProcessId);if($result.desktopWindows -lt 1){throw 'Private desktop ownership not observed.'}
 $result.data=[MidiScannerStateReader]::ReadSnapshot($TargetProcessId);$after=Get-Process -Id $TargetProcessId;if($after.StartTime.ToUniversalTime() -ne $start){throw 'Process changed during observation.'};$result.status='observed'
}catch{$result.error=$_.Exception.ToString()}
$result.processAliveAfter=[bool](Get-Process -Id $TargetProcessId -ErrorAction SilentlyContinue)
$result|ConvertTo-Json -Depth 6
if($result.status -ne 'observed'){exit 1}
