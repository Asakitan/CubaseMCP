[CmdletBinding()]
param([int]$TargetProcessId = 72128)
$ErrorActionPreference = 'Stop'
$result = [ordered]@{
    pid = $TargetProcessId; errorKind = $null; timestampUtc = [DateTime]::UtcNow.ToString('o'); status = 'error'; error = $null
    processStartUtc = $null; desktopWindows = $null; processAliveAfter = $false; data = $null; outputPath = $null
    limitation = 'Unlocked non-atomic traversal; lexical paths are candidates, not authoritative active project, dirty state, save completion or persistence.'
}
$native = @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class CurrentProjectPath25 {
    const ulong Base = 0x140000000, ProjectGlobal = 0x59110d0;
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool ReadProcessMemory(IntPtr process, IntPtr address, byte[] data, int size, out IntPtr read);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    public sealed class Item { public string node, value, valueVtable, kind, document, documentVtable, backref, pathObject, pathVtable, directory, filename, documentStatus; public bool equalsGlobalRoot; }
    public sealed class Snapshot { public string project, projectVtable, interfaceAddress, interfaceVtable, globalRoot, head; public uint count; public bool stable; public Item[] items; }
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
    static string PathField(Reader reader, ulong path, int offset) {
        byte[] field = reader.Read(path + (ulong)offset, 0x18);
        if (BitConverter.ToUInt64(field, 0) != Base + 0x4190c98) throw new InvalidOperationException("Path string vtable mismatch");
        ulong data = BitConverter.ToUInt64(field, 8); uint flags = BitConverter.ToUInt32(field, 0x10);
        int length = (int)(flags & 0x3fffffff); bool wide = (flags & 0x40000000) != 0;
        if (length > 512) throw new InvalidOperationException("Path string length exceeds bound");
        if (length == 0) return "";
        byte[] bytes = reader.Read(data, checked(length * (wide ? 2 : 1)));
        if (wide) return new UnicodeEncoding(false, false, true).GetString(bytes);
        foreach (byte value in bytes) if (value > 127) throw new InvalidOperationException("Narrow path encoding is not established");
        return Encoding.ASCII.GetString(bytes);
    }
    public static Snapshot ReadSnapshot(int pid) {
        IntPtr process = OpenProcess(0x410, false, pid);
        if (process == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenProcess");
        try {
            var reader = new Reader(process);
            ulong project = reader.Q(Base + ProjectGlobal);
            if (project == 0) throw new InvalidOperationException("PROFILE: null project");
            ulong projectVtable = reader.Q(project);
            if (projectVtable != Base + 0x447d378) throw new InvalidOperationException("PROFILE: project vtable mismatch");
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
                var item = new Item { node=Hex(node), value=Hex(value), valueVtable=value==0 ? null : Hex(valueVtable), kind=value==0 ? "null" : valueVtable==Base+0x4471c40 ? "MRoot candidate" : "unknown", equalsGlobalRoot=value!=0 && value==root, documentStatus="unknown" };
                if (value!=0 && valueVtable==Base+0x4471c40) {
                    ulong doc=reader.Q(value+0x180); item.document=Hex(doc);
                    if (doc!=0) {
                        ulong dvt=reader.Q(doc); item.documentVtable=Hex(dvt);
                        if (dvt==Base+0x42d96c0) {
                            ulong back=reader.Q(doc+0x108); item.backref=Hex(back);
                            if (back==value) {
                                ulong path=reader.Q(doc+0x30); item.pathObject=Hex(path);
                                if (path!=0) {
                                    ulong pvt=reader.Q(path); item.pathVtable=Hex(pvt);
                                    if (pvt==Base+0x4831bc0) { item.directory=PathField(reader,path,0xc8); item.filename=PathField(reader,path,0x18); item.documentStatus="candidate"; }
                                }
                            }
                        }
                    }
                }
                items.Add(item);
                node=next;
            }
            if (items.Count != count) throw new InvalidOperationException("CHANGED_OR_PROFILE: traversed count differs from stored count");
            reader.Verify();
            return new Snapshot { project=Hex(project), projectVtable=Hex(projectVtable), interfaceAddress=Hex(iface), interfaceVtable=Hex(vt), globalRoot=Hex(root), head=Hex(head), count=count, items=items.ToArray(), stable=true };

        } finally { CloseHandle(process); }
    }
}
'@
$root = Split-Path -Parent $PSScriptRoot
$output = Join-Path $root ('artifacts\ipc\current-project-path-25-{0}-{1}.json' -f $TargetProcessId, [Guid]::NewGuid().ToString('N'))
try {
    $launchPath = Join-Path $root 'artifacts\runtime\cubase-launch.json'
    $launchFile = Get-Item -LiteralPath $launchPath
    $launch = Get-Content -LiteralPath $launchPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($TargetProcessId -ne 72128 -or $launch.ProcessId -ne $TargetProcessId -or $launch.HostPid -ne 55324 -or
        $launch.Desktop -cne 'winsta0\CubaseAI_MCP' -or $launch.mode -cne 'empty' -or
        $null -eq $launch.PSObject.Properties['Project'] -or $null -ne $launch.Project -or
        [string]$launch.processCreationFiletime -cne '134387281655745512' -or
        [string]$launch.holderCreationFiletime -cne '134387281647304009' -or
        -not $launch.DesktopSwitchRestricted -or -not $launch.JobKillsOnLastHandleClose) { throw 'Launch PID, holder, mode or desktop mismatch.' }
    $process = Get-Process -Id $TargetProcessId
    $start = $process.StartTime.ToUniversalTime()
    $holder = Get-Process -Id 55324
    $holderStart = $holder.StartTime.ToUniversalTime()
    if ($holderStart.ToFileTimeUtc().ToString() -cne '134387281647304009') { throw 'PROFILE: holder creation time mismatch.' }
    if ($start.ToString('o') -cne [DateTime]::FromFileTimeUtc(134387281655745512).ToString('o')) { throw 'PROFILE: process creation time mismatch.' }
    if ($start -gt $launchFile.LastWriteTimeUtc.AddSeconds(2)) { throw 'Process started after launch metadata.' }
    $result.processStartUtc = $start.ToString('o')
    $path = $process.MainModule.FileName
    if ($path -ne 'C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe' -or
        (Get-Item -LiteralPath $path).VersionInfo.FileVersion -ne '16.0.5.174' -or
        $process.MainModule.BaseAddress.ToInt64() -ne 0x140000000) { throw 'Executable profile mismatch.' }
    $stream = [System.IO.File]::OpenRead($path)
    try {
        $reader = [System.IO.BinaryReader]::new($stream); $stream.Position = 0x3c; $peOffset = $reader.ReadUInt32(); if ($peOffset -lt 0x40 -or $peOffset -gt $stream.Length - 12) { throw 'PROFILE: invalid PE offset.' }; $stream.Position = $peOffset
        if ($reader.ReadUInt32() -ne 0x4550 -or $reader.ReadUInt16() -ne 0x8664) { throw 'PE signature or machine mismatch.' }
        $stream.Position = $peOffset + 8; if ($reader.ReadUInt32() -ne 0x6adf121b) { throw 'PE timestamp mismatch.' }
    } finally { $stream.Dispose() }
    Add-Type -Path (Join-Path $root 'native\CubaseDesktop.cs')
    Add-Type -TypeDefinition $native
    $result.desktopWindows = @([CubaseAiMcp.CubaseDesktop]::Inspect('CubaseAI_MCP') | Where-Object { $_.ProcessId -eq $TargetProcessId }).Count
    if ($result.desktopWindows -lt 1) { throw 'Private desktop ownership not observed.' }
    $snapshot = [CurrentProjectPath25]::ReadSnapshot($TargetProcessId)
    $result.data = [ordered]@{ project=$snapshot.project; projectVtable=$snapshot.projectVtable; interfaceAddress=$snapshot.interfaceAddress; interfaceVtable=$snapshot.interfaceVtable; globalRoot=$snapshot.globalRoot; head=$snapshot.head; count=$snapshot.count; stable=$snapshot.stable; items=@($snapshot.items | ForEach-Object { $_ | Select-Object * }) }
    foreach ($item in $result.data.items) {
        $candidate = $null; $exists = $null
        if ($item.documentStatus -eq 'candidate' -and $item.directory -and $item.filename) {
            if (-not [IO.Path]::IsPathRooted($item.directory) -or [IO.Path]::IsPathRooted($item.filename) -or $item.filename -ne [IO.Path]::GetFileName($item.filename)) { throw 'PROFILE: invalid path components.' }
            $candidate = [IO.Path]::GetFullPath([IO.Path]::Combine($item.directory, $item.filename))
            $exists = [IO.File]::Exists($candidate)
        }
        $item | Add-Member -NotePropertyName canonicalLexicalCandidate -NotePropertyValue $candidate
        $item | Add-Member -NotePropertyName fileExistsAtObservation -NotePropertyValue $exists
    }
    if ((Get-Process -Id $TargetProcessId).StartTime.ToUniversalTime() -ne $start) { throw 'CHANGED: Process changed during observation.' }
    if ((Get-Process -Id 55324).StartTime.ToUniversalTime() -ne $holderStart) { throw 'CHANGED: Holder changed during observation.' }
    $result.status = 'observed'
} catch { $result.error = $_.Exception.ToString(); if ($result.error -match 'CHANGED:') { $result.errorKind='changed' } elseif ($result.error -match 'UNMAPPED_OR_UNREADABLE:') { $result.errorKind='unmapped_or_unreadable' } elseif ($result.error -match 'BOUND:') { $result.errorKind='bound' } else { $result.errorKind='exception_or_profile' } }
if ($TargetProcessId -eq 72128) {
    $current = Get-Process -Id $TargetProcessId -ErrorAction SilentlyContinue
    if ($current) {
        try { $result.processAliveAfter = $current.StartTime.ToUniversalTime().ToFileTimeUtc().ToString() -ceq '134387281655745512' }
        catch { $result.processAliveAfter = $false }
    }
}
$result.outputPath = $output
$json = $result | ConvertTo-Json -Depth 6
[void][System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($output))
$writer = [System.IO.StreamWriter]::new([System.IO.File]::Open($output, [System.IO.FileMode]::CreateNew), [System.Text.UTF8Encoding]::new($false))
try { $writer.Write($json) } finally { $writer.Dispose() }
$json
if ($result.status -ne 'observed') { exit 1 }
