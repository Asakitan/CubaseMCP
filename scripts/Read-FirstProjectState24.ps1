[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runId = [Guid]::NewGuid().ToString('N')
$path = Join-Path $root "artifacts\ipc\first-project-state-24-72128-$runId.json"
$result = [ordered]@{status='error';error=$null;pid=72128;processCreationFiletime='134387281655745512';
    holderPid=55324;holderCreationFiletime='134387281647304009';startedUtc=[DateTime]::UtcNow.ToString('o');sampledUtc=$null;
    outputPath=$path;readyForFirstOpen=$false;data=$null;
    limitation='Sequential unlocked double reads are not an atomic lifecycle or completion guarantee.'}
$source = @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class FirstProjectState24 {
    const ulong Base = 0x140000000, ProjectGlobal = 0x59110d0, InformerGlobal = 0x5909af0;
    [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool ReadProcessMemory(IntPtr process,IntPtr address,byte[] data,int length,out IntPtr read);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    sealed class Entry { public ulong Address; public byte[] Bytes; }
    sealed class Reader {
        readonly IntPtr process; readonly List<Entry> entries=new List<Entry>();
        public Reader(IntPtr process){this.process=process;}
        public byte[] Read(ulong address,int length){
            if(address<0x10000 || length<1 || length>4096 || address>0x00007fffffffffffUL-(ulong)length) throw new InvalidOperationException("read bounds");
            byte[] bytes=new byte[length];IntPtr got;
            if(!ReadProcessMemory(process,(IntPtr)(long)address,bytes,length,out got) || got.ToInt64()!=length) throw new Win32Exception(Marshal.GetLastWin32Error(),"ReadProcessMemory");
            entries.Add(new Entry{Address=address,Bytes=bytes});return bytes;
        }
        public ulong Q(ulong address){return BitConverter.ToUInt64(Read(address,8),0);}
        public uint D(ulong address){return BitConverter.ToUInt32(Read(address,4),0);}
        public void Verify(){foreach(Entry entry in entries){byte[] again=new byte[entry.Bytes.Length];IntPtr got;
            if(!ReadProcessMemory(process,(IntPtr)(long)entry.Address,again,again.Length,out got)||got.ToInt64()!=again.Length) throw new Win32Exception(Marshal.GetLastWin32Error(),"reread");
            for(int i=0;i<again.Length;i++)if(again[i]!=entry.Bytes[i])throw new InvalidOperationException("snapshot changed");}}
    }
    static string H(ulong value){return "0x"+value.ToString("x");}
    public sealed class Snapshot {public string project,globalRoot,projectListHead,informer,informerTreeHead;
        public uint projectListCount,listenerCount;public ulong informerTreeCount;public bool listenerFound,stable;}
    public static Snapshot Read(){
        IntPtr process=OpenProcess(0x410,false,72128);if(process==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error(),"OpenProcess");
        try {var r=new Reader(process);ulong project=r.Q(Base+ProjectGlobal),informer=r.Q(Base+InformerGlobal);
            if(project==0||r.Q(project)!=Base+0x447d378)throw new InvalidOperationException("project vtable mismatch");
            if(informer==0||r.Q(informer)!=Base+0x4452800||r.Q(informer+0x20)!=Base+0x4452900)throw new InvalidOperationException("informer vtable mismatch");
            ulong root=r.Q(project+0xf8),list=project+0x78;
            if(r.Q(list)!=Base+0x4192350)throw new InvalidOperationException("project list vtable mismatch");
            uint projectCount=r.D(list+0x10);ulong projectHead=r.Q(list+0x18);
            if(projectCount>128||(projectCount==0&&projectHead!=0)||(projectCount>0&&projectHead==0))throw new InvalidOperationException("project list header mismatch");
            ulong container=project+0xc8;if(r.Q(container)!=Base+0x447d2f8)throw new InvalidOperationException("listener vtable mismatch");
            uint listenerCount=r.D(container+0x10);if(listenerCount>128)throw new InvalidOperationException("listener count bound");
            ulong node=r.Q(container+0x18);var seen=new HashSet<ulong>();bool found=false;
            for(uint i=0;i<listenerCount;i++){if(node==0||!seen.Add(node))throw new InvalidOperationException("listener chain malformed");
                byte[] link=r.Read(node,16);if(BitConverter.ToUInt64(link,8)==informer+0x20)found=true;node=BitConverter.ToUInt64(link,0);}
            if(node!=0)throw new InvalidOperationException("listener chain length mismatch");
            ulong head=r.Q(informer+0x88),treeCount=r.Q(informer+0x90);
            if(head==0||treeCount>4096)throw new InvalidOperationException("informer tree header mismatch");
            byte[] sentinel=r.Read(head,0x28);if(sentinel[0x19]!=1||(treeCount==0&&BitConverter.ToUInt64(sentinel,8)!=head))throw new InvalidOperationException("informer tree sentinel mismatch");
            r.Verify();return new Snapshot{project=H(project),globalRoot=H(root),projectListCount=projectCount,projectListHead=H(projectHead),
                informer=H(informer),informerTreeHead=H(head),informerTreeCount=treeCount,listenerCount=listenerCount,listenerFound=found,stable=true};
        } finally {CloseHandle(process);}
    }
}
'@
try {
    $receipt = Get-Content -LiteralPath (Join-Path $root 'artifacts\runtime\cubase-launch.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([int]$receipt.ProcessId -ne 72128 -or [int]$receipt.HostPid -ne 55324 -or $receipt.mode -cne 'empty' -or
        $null -ne $receipt.Project -or $receipt.Desktop -cne 'winsta0\CubaseAI_MCP' -or
        [string]$receipt.processCreationFiletime -cne $result.processCreationFiletime -or
        [string]$receipt.holderCreationFiletime -cne $result.holderCreationFiletime -or
        -not $receipt.DesktopSwitchRestricted -or -not $receipt.JobKillsOnLastHandleClose) { throw 'Fixed empty-launch receipt mismatch.' }
    $process=Get-Process -Id 72128;$holder=Get-Process -Id 55324
    if($process.StartTime.ToUniversalTime().ToFileTimeUtc().ToString() -cne $result.processCreationFiletime -or
       $holder.StartTime.ToUniversalTime().ToFileTimeUtc().ToString() -cne $result.holderCreationFiletime){throw 'Process lifetime mismatch.'}
    $exe=$process.MainModule.FileName
    if($exe -ine 'C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe' -or $process.MainModule.BaseAddress.ToInt64() -ne 0x140000000 -or
       (Get-Item -LiteralPath $exe).VersionInfo.FileVersion -ne '16.0.5.174'){throw 'Fixed image profile mismatch.'}
    $fs=[IO.File]::OpenRead($exe);$reader=[IO.BinaryReader]::new($fs)
    try{$fs.Position=0x3c;$offset=$reader.ReadUInt32();if($offset -lt 0x40 -or $offset -gt ($fs.Length-12)){throw 'Invalid PE offset.'};$fs.Position=$offset;if($reader.ReadUInt32() -ne 0x4550 -or $reader.ReadUInt16() -ne 0x8664){throw 'Invalid PE profile.'};$fs.Position=$offset+8;if($reader.ReadUInt32() -ne 0x6adf121b){throw 'PE timestamp mismatch.'}}finally{$reader.Dispose();$fs.Dispose()}
    Add-Type -Path (Join-Path $root 'native\CubaseDesktop.cs');Add-Type $source
    if(-not @([CubaseAiMcp.CubaseDesktop]::Inspect('CubaseAI_MCP') | Where-Object {$_.ProcessId -eq 72128}).Count){throw 'Private desktop ownership not observed.'}
    $result.data=[FirstProjectState24]::Read()
    $result.sampledUtc=[DateTime]::UtcNow.ToString('o')
    if((Get-Process -Id 72128).StartTime.ToUniversalTime().ToFileTimeUtc().ToString() -cne $result.processCreationFiletime -or
       (Get-Process -Id 55324).StartTime.ToUniversalTime().ToFileTimeUtc().ToString() -cne $result.holderCreationFiletime){throw 'Process lifetime changed.'}
    $result.status='observed'
    $result.readyForFirstOpen=$result.data.stable -and $result.data.globalRoot -ceq '0x0' -and
        $result.data.projectListCount -eq 0 -and $result.data.projectListHead -ceq '0x0' -and
        $result.data.informerTreeCount -eq 0 -and $result.data.listenerFound
} catch {$result.error=$_.Exception.ToString()}
$file=[IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
try{$bytes=[Text.UTF8Encoding]::new($false).GetBytes(($result|ConvertTo-Json -Depth 6));$file.Write($bytes,0,$bytes.Length);$file.Flush($true)}finally{$file.Dispose()}
$result|ConvertTo-Json -Depth 6
if($result.status -cne 'observed'){exit 1}
