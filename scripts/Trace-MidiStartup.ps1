[CmdletBinding(DefaultParameterSetName='Target')]
param(
 [Parameter(Mandatory=$true,ParameterSetName='Target')][ValidateRange(1,2147483647)][int]$TargetProcessId,
 [Parameter(Mandatory=$true,ParameterSetName='NextLaunch')][ValidatePattern('^[a-f0-9]{32}$')][string]$NextLaunchRunId,
 [Parameter(Mandatory=$true,ParameterSetName='NextLaunch')][ValidateRange(1,2147483647)][int]$PreviousProcessId,
 [ValidateRange(1,300)][int]$DurationSeconds=30,
 [ValidateRange(50,5000)][int]$IntervalMs=100
)
$ErrorActionPreference='Stop'
$source=@'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class MidiStartupTrace {
 const ulong B=0x140000000, ProjectGlobal=0x59110d0, InformerGlobal=0x5909af0;
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint a,bool i,int p);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool ReadProcessMemory(IntPtr p,IntPtr a,byte[] b,int n,out IntPtr got);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr p);
 delegate bool EnumProc(IntPtr w,IntPtr s);
 [DllImport("user32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr OpenDesktopW(string n,uint f,bool i,uint a);
 [DllImport("user32.dll",SetLastError=true)] static extern bool EnumDesktopWindows(IntPtr d,EnumProc e,IntPtr s);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr w,out uint p);
 [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr d);
 static ulong Q(byte[] b,int o){return BitConverter.ToUInt64(b,o);}
 static byte[] R(IntPtr p,ulong a,int n){if(a==0||n<1||n>1024)throw new Exception("read bounds");byte[] b=new byte[n];IntPtr got;if(!ReadProcessMemory(p,(IntPtr)(long)a,b,n,out got)||got.ToInt64()!=n)throw new Win32Exception(Marshal.GetLastWin32Error(),"ReadProcessMemory");return b;}
 static bool Eq(byte[] a,byte[] b){if(a.Length!=b.Length)return false;for(int i=0;i<a.Length;i++)if(a[i]!=b[i])return false;return true;}
 static string H(ulong v){return "0x"+v.ToString("x");}
 public static int Windows(int pid){IntPtr d=OpenDesktopW("CubaseAI_MCP",0,false,0x41);if(d==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error(),"OpenDesktop");try{int n=0;if(!EnumDesktopWindows(d,(IntPtr w,IntPtr s)=>{uint o;GetWindowThreadProcessId(w,out o);if(o==(uint)pid)n++;return true;},IntPtr.Zero))throw new Win32Exception(Marshal.GetLastWin32Error(),"EnumDesktopWindows");return n;}finally{CloseDesktop(d);}}
 public sealed class Sample {public string status="pending",projectState="pending",informerState="pending",rootState="pending",project,informer,root,treeHead;public ulong? treeCount;public int? listenerCount;public bool? listenerFound,treeContainsRoot;public bool stable;}
 public static Sample Read(int pid){var s=new Sample();IntPtr p=OpenProcess(0x410,false,pid);if(p==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error(),"OpenProcess");try{
 byte[] pg=R(p,B+ProjectGlobal,8),ig=R(p,B+InformerGlobal,8);ulong project=Q(pg,0),informer=Q(ig,0);s.project=H(project);s.informer=H(informer);
 byte[] pvt=null,container=null,rootField=null,rootVt=null,rootSubVt=null,ivt=null,isub=null,tree=null,sentinel=null;ulong root=0,head=0;var nodes=new List<ulong>();var copies=new List<byte[]>();var treeNodes=new List<ulong>();var treeCopies=new List<byte[]>();
 if(project!=0){
  pvt=R(p,project,8);if(Q(pvt,0)!=B+0x447d378)throw new Exception("project vtable mismatch");
  container=R(p,project+0xc8,0x28);if(Q(container,0)!=B+0x447d2f8)throw new Exception("listener container vtable mismatch");
  rootField=R(p,project+0xf8,8);root=Q(rootField,0);s.root=H(root);s.projectState="observed";
  if(root==0)s.rootState="absent";else{rootVt=R(p,root,8);if(Q(rootVt,0)!=B+0x4471c40)throw new Exception("root vtable mismatch");rootSubVt=R(p,root+0x98,8);if(Q(rootSubVt,0)!=B+0x4472130)throw new Exception("root subobject vtable mismatch");s.rootState="observed";}
  uint count=BitConverter.ToUInt32(container,0x10);ulong node=Q(container,0x18);if(count>128)throw new Exception("listener count bound");var seen=new HashSet<ulong>();bool found=false;
  for(uint k=0;k<count;k++){if(node==0||!seen.Add(node))throw new Exception("listener chain malformed");byte[] n=R(p,node,16);nodes.Add(node);copies.Add(n);if(informer!=0&&Q(n,8)==informer+0x20)found=true;node=Q(n,0);}if(node!=0)throw new Exception("listener chain length mismatch");
  s.listenerCount=(int)count;if(informer!=0)s.listenerFound=found;
 }
 if(informer!=0){ivt=R(p,informer,8);isub=R(p,informer+0x20,8);if(Q(ivt,0)!=B+0x4452800||Q(isub,0)!=B+0x4452900)throw new Exception("informer vtable mismatch");tree=R(p,informer+0x88,16);head=Q(tree,0);ulong tc=Q(tree,8);if(head==0||tc>4096)throw new Exception("project tree header invalid");sentinel=R(p,head,0x28);if(sentinel[0x19]!=1)throw new Exception("project tree sentinel invalid");ulong cursor=Q(sentinel,8);if(tc==0&&cursor!=head)throw new Exception("empty project tree inconsistent");if(tc!=0&&cursor==head)throw new Exception("nonempty project tree inconsistent");s.treeHead=H(head);s.treeCount=tc;s.informerState="observed";
  if(root!=0){ulong wanted=root+0x98;bool found=false;var seenTree=new HashSet<ulong>();while(cursor!=head){if(treeNodes.Count>=64||!seenTree.Add(cursor))throw new Exception("project tree search bound or cycle");byte[] n=R(p,cursor,0x28);if(n[0x19]!=0)throw new Exception("unexpected project tree node");treeNodes.Add(cursor);treeCopies.Add(n);ulong key=Q(n,0x20);if(key==wanted){found=true;break;}cursor=key<wanted?Q(n,0x10):Q(n,0);if(cursor==0)throw new Exception("null project tree link");}s.treeContainsRoot=found;}
 }
 for(int k=0;k<nodes.Count;k++)if(!Eq(copies[k],R(p,nodes[k],16)))throw new Exception("listener changed");
 for(int k=0;k<treeNodes.Count;k++)if(!Eq(treeCopies[k],R(p,treeNodes[k],0x28)))throw new Exception("project tree changed");
 if(!Eq(pg,R(p,B+ProjectGlobal,8))||!Eq(ig,R(p,B+InformerGlobal,8))||(pvt!=null&&!Eq(pvt,R(p,project,8)))||(container!=null&&!Eq(container,R(p,project+0xc8,0x28)))||(rootField!=null&&!Eq(rootField,R(p,project+0xf8,8)))||(rootVt!=null&&!Eq(rootVt,R(p,root,8)))||(rootSubVt!=null&&!Eq(rootSubVt,R(p,root+0x98,8)))||(ivt!=null&&!Eq(ivt,R(p,informer,8)))||(isub!=null&&!Eq(isub,R(p,informer+0x20,8)))||(tree!=null&&!Eq(tree,R(p,informer+0x88,16)))||(sentinel!=null&&!Eq(sentinel,R(p,head,0x28))))throw new Exception("snapshot changed");
 s.stable=true;if(project!=0&&informer!=0&&root!=0)s.status="observed";return s;
 }finally{CloseHandle(p);}}
}
'@
$root=Split-Path -Parent $PSScriptRoot
$runId=if($PSCmdlet.ParameterSetName -eq 'NextLaunch'){$NextLaunchRunId}else{[Guid]::NewGuid().ToString('N')}
$out=if($PSCmdlet.ParameterSetName -eq 'NextLaunch'){Join-Path $root "artifacts\ipc\midi-startup-timeline-next-$runId.json"}else{Join-Path $root "artifacts\ipc\midi-startup-timeline-$TargetProcessId-$runId.json"}
$result=[ordered]@{pid=$null; status='error'; error=$null; outputFile=$out; armUtc=$null; receiptReadErrors=0; processStartUtc=$null; launchMetadataUtc=$null; executable=$null; version=$null; peTimestamp=$null; samples=@(); limitation='Snapshots are not event history. Zero private-desktop windows leaves desktop ownership unverified.'}
try {
 $lp=Join-Path $root 'artifacts\runtime\cubase-launch.json'
 Add-Type $source
 if($PSCmdlet.ParameterSetName -eq 'NextLaunch'){
  $previous=Get-Content -LiteralPath $lp -Raw -Encoding UTF8|ConvertFrom-Json
  if([int]$previous.ProcessId -ne $PreviousProcessId -or $previous.Desktop -cne 'winsta0\CubaseAI_MCP'){throw 'Previous launch PID or desktop mismatch.'}
  $expectedProject=[IO.Path]::GetFullPath([string]$previous.Project);$ownedDirectory=[IO.Path]::GetFullPath((Join-Path $root 'artifacts\live-smoke')).TrimEnd('\')+'\'
  if(-not $expectedProject.StartsWith($ownedDirectory,[StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $expectedProject -PathType Leaf)){throw 'Previous project is not an owned test file.'}
  $previousProcess=Get-Process -Id $PreviousProcessId
  if(-not [String]::Equals($previousProcess.MainModule.FileName,'C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe',[StringComparison]::OrdinalIgnoreCase)){throw 'Previous executable mismatch.'}
  $armTime=[DateTime]::UtcNow;$result.armUtc=$armTime.ToString('o')
  $arm=Join-Path $root "artifacts\ipc\midi-startup-arm-$runId.json";$ticket=Join-Path $root "artifacts\ipc\midi-startup-ticket-$runId.json"
  $armData=[ordered]@{status='ready';runId=$runId;tracePid=$PID;previousPid=$PreviousProcessId;project=$expectedProject;armUtc=$result.armUtc}|ConvertTo-Json
  $armStream=[IO.File]::Open($arm,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read);try{$armWriter=[IO.StreamWriter]::new($armStream,[Text.UTF8Encoding]::new($false));try{$armWriter.Write($armData)}finally{$armWriter.Dispose()}}finally{$armStream.Dispose()}
  $wait=[Diagnostics.Stopwatch]::StartNew();$expectedHost=0;$launch=$null;$li=$null
  while($wait.Elapsed.TotalSeconds -lt 90){
   if($expectedHost -eq 0 -and (Test-Path -LiteralPath $ticket -PathType Leaf)){
    $ticketData=Get-Content -LiteralPath $ticket -Raw -Encoding UTF8|ConvertFrom-Json
    if($ticketData.runId -cne $runId -or [int]$ticketData.previousPid -ne $PreviousProcessId -or [int]$ticketData.hostPid -le 0 -or -not [String]::Equals([string]$ticketData.project,$expectedProject,[StringComparison]::OrdinalIgnoreCase)){throw 'Launch ticket mismatch.'}
    $expectedHost=[int]$ticketData.hostPid
   }
   if($expectedHost -gt 0){
    try {$candidateItem=Get-Item -LiteralPath $lp;$candidate=Get-Content -LiteralPath $lp -Raw -Encoding UTF8|ConvertFrom-Json}catch{$result.receiptReadErrors++;$candidate=$null}
    if($candidate -and [int]$candidate.HostPid -eq $expectedHost -and [int]$candidate.ProcessId -ne $PreviousProcessId -and $candidateItem.LastWriteTimeUtc -ge $armTime.AddSeconds(-2)){$li=$candidateItem;$launch=$candidate;break}
   }
   Start-Sleep -Milliseconds 20
  }
  if(-not $launch){throw 'Timed out waiting for the matching launch ticket and receipt.'}
  if(-not [String]::Equals([string]$launch.Project,$expectedProject,[StringComparison]::OrdinalIgnoreCase)){throw 'Launch project mismatch.'}
  $TargetProcessId=[int]$launch.ProcessId
 } else {$li=Get-Item -LiteralPath $lp;$launch=Get-Content -LiteralPath $lp -Raw -Encoding UTF8|ConvertFrom-Json}
 $result.pid=$TargetProcessId
 if([int]$launch.ProcessId -ne $TargetProcessId -or $launch.Desktop -cne 'winsta0\CubaseAI_MCP'){throw 'Launch PID or desktop mismatch.'}
 $p=Get-Process -Id $TargetProcessId;$start=$p.StartTime.ToUniversalTime();if($start -gt $li.LastWriteTimeUtc.AddSeconds(2)){throw 'Process started after launch metadata.'}
 if($result.armUtc -and $start -lt $armTime){throw 'New process predates trace arming.'}
 $path=$p.MainModule.FileName;if(-not [String]::Equals($path,'C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe',[StringComparison]::OrdinalIgnoreCase)){throw 'Executable mismatch.'}
 if($p.MainModule.BaseAddress.ToInt64() -ne 0x140000000){throw 'Image base mismatch.'};$version=(Get-Item -LiteralPath $path).VersionInfo.FileVersion;if($version -ne '16.0.5.174'){throw 'Version mismatch.'}
 $fs=[IO.File]::OpenRead($path);$reader=[IO.BinaryReader]::new($fs);try{$fs.Position=0x3c;$offset=$reader.ReadUInt32();if($offset -lt 0x40 -or $offset -gt ($fs.Length-12)){throw 'Invalid PE header offset.'};$fs.Position=$offset;$signature=$reader.ReadUInt32();$machine=$reader.ReadUInt16();$fs.Position=$offset+8;$timestamp=$reader.ReadUInt32();if($signature -ne 0x4550 -or $machine -ne 0x8664 -or $timestamp -ne 0x6adf121b){throw 'PE build mismatch.'}}finally{$reader.Dispose();$fs.Dispose()}
 $result.processStartUtc=$start.ToString('o');$result.launchMetadataUtc=$li.LastWriteTimeUtc.ToString('o');$result.executable=$path;$result.version=$version;$result.peTimestamp=('0x{0:x}' -f $timestamp)
 $clock=[Diagnostics.Stopwatch]::StartNew();$samples=[Collections.Generic.List[object]]::new()
 do {
  $row=[ordered]@{timestampUtc=[DateTime]::UtcNow.ToString('o');desktopWindows=$null;desktopStatus='pending';status='error';error=$null;data=$null}
  $terminal=$false
  try {$now=Get-Process -Id $TargetProcessId;if($now.StartTime.ToUniversalTime() -ne $start){$terminal=$true;throw 'Process identity changed.'};$row.desktopWindows=[MidiStartupTrace]::Windows($TargetProcessId);if($row.desktopWindows -gt 0){$row.desktopStatus='observed'};$row.data=[MidiStartupTrace]::Read($TargetProcessId);$row.status=$row.data.status;$now=Get-Process -Id $TargetProcessId;if($now.StartTime.ToUniversalTime() -ne $start){$terminal=$true;throw 'Process identity changed after read.'}}catch{$row.status='error';$row.error=$_.Exception.ToString();if(-not (Get-Process -Id $TargetProcessId -ErrorAction SilentlyContinue)){$terminal=$true}}
  $samples.Add([pscustomobject]$row);if($terminal -or $clock.Elapsed.TotalSeconds -ge $DurationSeconds){break};$remaining=[int](1000*$DurationSeconds-$clock.ElapsedMilliseconds);if($remaining -gt 0){Start-Sleep -Milliseconds ([Math]::Min($IntervalMs,$remaining))}
 } while($clock.Elapsed.TotalSeconds -lt $DurationSeconds)
 $result.samples=$samples.ToArray();$result.status=if(@($samples | Where-Object {$_.status -eq 'error'}).Count){'error'}elseif(@($samples | Where-Object {$_.status -eq 'pending' -or $_.desktopStatus -eq 'pending'}).Count){'pending'}else{'observed'}
}catch{$result.error=$_.Exception.ToString()}
$json=$result|ConvertTo-Json -Depth 8;$stream=[IO.File]::Open($out,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read);try{$writer=[IO.StreamWriter]::new($stream,[Text.UTF8Encoding]::new($false));try{$writer.Write($json)}finally{$writer.Dispose()}}finally{$stream.Dispose()};$json
if($result.status -eq 'error'){exit 1}
