[CmdletBinding()]
param([int]$TargetProcessId = 24036)
$ErrorActionPreference = 'Stop'
$result = [ordered]@{
    pid = $TargetProcessId; errorKind = $null; timestampUtc = [DateTime]::UtcNow.ToString('o'); status = 'error'; error = $null
    processStartUtc = $null; desktopWindows = $null; processAliveAfter = $false; data = $null; outputPath = $null
    limitation = 'Post-prompt unlocked non-atomic traversal; candidates do not prove activation or completion.'
}
$native = @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class ProjectList22 {
    const ulong Base = 0x140000000, ProjectGlobal = 0x59110d0, ManagerGlobal = 0x5973480;
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool ReadProcessMemory(IntPtr process, IntPtr address, byte[] data, int size, out IntPtr read);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    public sealed class Item { public string node, value, valueVtable, kind; public bool equalsGlobalRoot; }
    public sealed class Snapshot { public string project, interfaceAddress, interfaceVtable, globalRoot, head; public uint count; public bool stable; public Item[] items; }
    sealed class ReadRecord { public ulong address; public byte[] value; }
    sealed class Reader {
        public readonly IntPtr process; public readonly List<ReadRecord> reads = new List<ReadRecord>();
        public Reader(IntPtr process) { this.process = process; }
        public byte[] Read(ulong address, int size) {
            if (address < 0x10000 || address > 0x00007fffffffffffUL - (ulong)size || size < 1 || size > 4096) throw new InvalidOperationException("BOUND: invalid address or size");
            byte[] data = new byte[size]; IntPtr count;
            if (!ReadProcessMemory(process, (IntPtr)(long)address, data, size, out count) || count.ToInt64() != size)
                throw new Win32Exception(Marshal.GetLastWin32Error(), "UNMAPPED_OR_UNREADABLE: ReadProcessMemory");
            reads.Add(new ReadRecord { address=address, value=data });
            return data;
        }
        public ulong Q(ulong address) { return BitConverter.ToUInt64(Read(address, 8), 0); }
        public void Verify() {
            foreach (ReadRecord item in reads) {
                byte[] again = new byte[item.value.Length]; IntPtr count;
                if (!ReadProcessMemory(process, (IntPtr)(long)item.address, again, again.Length, out count) || count.ToInt64()!=again.Length)
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "UNMAPPED_OR_UNREADABLE: reread");
                for (int i=0; i<again.Length; i++) if (again[i]!=item.value[i]) throw new InvalidOperationException("CHANGED: observed field changed");
            }
        }
    }
    static string Hex(ulong value) { return "0x" + value.ToString("x"); }
    public static Snapshot ReadSnapshot(int pid) {
        IntPtr process = OpenProcess(0x410, false, pid);
        if (process == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenProcess");
        try {
            var reader = new Reader(process);
            ulong project = reader.Q(Base + 0x59110d0);
            if (project == 0) throw new InvalidOperationException("PROFILE: null project");
            ulong iface = project + 0x78, vt = reader.Q(iface);
            if (vt != Base + 0x4192350) throw new InvalidOperationException("PROFILE: interface vtable mismatch");
            uint count = BitConverter.ToUInt32(reader.Read(iface+0x10, 4), 0);
            if (count > 128) throw new InvalidOperationException("BOUND: count exceeds limit");
            ulong head = reader.Q(iface+0x18), root = reader.Q(project+0xf8), node=head;
            var visited = new HashSet<ulong>(); var items = new List<Item>();
            while (node != 0) {
                if (visited.Count >= 128 || !visited.Add(node)) throw new InvalidOperationException("BOUND: list limit or cycle");
                byte[] link=reader.Read(node,16);
                ulong next=BitConverter.ToUInt64(link,0), value=BitConverter.ToUInt64(link,8);
                ulong valueVtable = value==0 ? 0 : reader.Q(value);
                items.Add(new Item { node=Hex(node), value=Hex(value), valueVtable=value==0 ? null : Hex(valueVtable), kind=value==0 ? "null" : valueVtable==Base+0x4471c40 ? "MRoot candidate" : "unknown", equalsGlobalRoot=value!=0 && value==root });
                node=next;
            }
            if (items.Count != count) throw new InvalidOperationException("CHANGED_OR_PROFILE: traversed count differs from stored count");
            reader.Verify();
            return new Snapshot { project=Hex(project), interfaceAddress=Hex(iface), interfaceVtable=Hex(vt), globalRoot=Hex(root), head=Hex(head), count=count, items=items.ToArray(), stable=true };

        } finally { CloseHandle(process); }
    }
}
'@
$root = Split-Path -Parent $PSScriptRoot
$output = Join-Path $root ('artifacts\ipc\project-list-22-{0}-{1}.json' -f $TargetProcessId, [Guid]::NewGuid().ToString('N'))
try {
    $launchPath = Join-Path $root 'artifacts\runtime\cubase-launch.json'
    $launchFile = Get-Item -LiteralPath $launchPath
    $launch = Get-Content -LiteralPath $launchPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($TargetProcessId -ne 24036 -or $launch.ProcessId -ne $TargetProcessId -or $launch.Desktop -ne 'winsta0\CubaseAI_MCP') { throw 'Launch PID or desktop mismatch.' }
    $process = Get-Process -Id $TargetProcessId
    $start = $process.StartTime.ToUniversalTime()
    if ($start.ToString('o') -cne '2026-11-09T19:11:22.3263004Z') { throw 'PROFILE: process creation time mismatch.' }
    if ($start -gt $launchFile.LastWriteTimeUtc.AddSeconds(2)) { throw 'Process started after launch metadata.' }
    $result.processStartUtc = $start.ToString('o')
    $path = $process.MainModule.FileName
    if ($path -ne 'C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe' -or
        (Get-Item -LiteralPath $path).VersionInfo.FileVersion -ne '16.0.5.174' -or
        $process.MainModule.BaseAddress.ToInt64() -ne 0x140000000) { throw 'Executable profile mismatch.' }
    $stream = [System.IO.File]::OpenRead($path)
    try {
        $reader = [System.IO.BinaryReader]::new($stream); $stream.Position = 0x3c; $peOffset = $reader.ReadUInt32(); $stream.Position = $peOffset
        if ($reader.ReadUInt32() -ne 0x4550 -or $reader.ReadUInt16() -ne 0x8664) { throw 'PE signature or machine mismatch.' }
        $stream.Position = $peOffset + 8; if ($reader.ReadUInt32() -ne 0x6adf121b) { throw 'PE timestamp mismatch.' }
    } finally { $stream.Dispose() }
    Add-Type -Path (Join-Path $root 'native\CubaseDesktop.cs')
    Add-Type -TypeDefinition $native
    $result.desktopWindows = @([CubaseAiMcp.CubaseDesktop]::Inspect('CubaseAI_MCP') | Where-Object { $_.ProcessId -eq $TargetProcessId }).Count
    if ($result.desktopWindows -lt 1) { throw 'Private desktop ownership not observed.' }
    $result.data = [ProjectList22]::ReadSnapshot($TargetProcessId)
    if ((Get-Process -Id $TargetProcessId).StartTime.ToUniversalTime() -ne $start) { throw 'CHANGED: Process changed during observation.' }
    $result.status = 'observed'
} catch { $result.error = $_.Exception.ToString(); if ($result.error -match 'CHANGED:') { $result.errorKind='changed' } elseif ($result.error -match 'UNMAPPED_OR_UNREADABLE:') { $result.errorKind='unmapped_or_unreadable' } elseif ($result.error -match 'BOUND:') { $result.errorKind='bound' } else { $result.errorKind='exception_or_profile' } }
$result.processAliveAfter = [bool](Get-Process -Id $TargetProcessId -ErrorAction SilentlyContinue)
$result.outputPath = $output
$json = $result | ConvertTo-Json -Depth 6
[void][System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($output))
$writer = [System.IO.StreamWriter]::new([System.IO.File]::Open($output, [System.IO.FileMode]::CreateNew), [System.Text.UTF8Encoding]::new($false))
try { $writer.Write($json) } finally { $writer.Dispose() }
$json
if ($result.status -ne 'observed') { exit 1 }
