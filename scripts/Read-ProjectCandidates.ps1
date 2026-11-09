[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$TargetProcessId)
$ErrorActionPreference = 'Stop'
$result = [ordered]@{
    pid = $TargetProcessId; timestampUtc = [DateTime]::UtcNow.ToString('o'); status = 'error'; error = $null
    processStartUtc = $null; desktopWindows = $null; processAliveAfter = $false; data = $null; outputPath = $null
    limitation = 'Unlocked read-only candidates, not proof of active project, canonical path, persistence or operation completion.'
}
$native = @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class CubaseProjectCandidates {
    const ulong Base = 0x140000000, ProjectGlobal = 0x59110d0, ManagerGlobal = 0x5973480;
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool ReadProcessMemory(IntPtr process, IntPtr address, byte[] data, int size, out IntPtr read);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    public sealed class Candidate {
        public string window; public string controller; public string document; public string pathObject;
        public string directory; public string filename; public string documentField108; public bool field108MatchesProjectRoot;
    }
    public sealed class Snapshot {
        public string project; public string root; public string manager; public int windowCount;
        public int otherWindows; public bool stable; public Candidate[] candidates;
    }
    sealed class ReadRecord { public ulong address; public byte[] value; }
    sealed class Reader {
        public readonly IntPtr process; public readonly List<ReadRecord> reads = new List<ReadRecord>();
        public Reader(IntPtr process) { this.process = process; }
        public byte[] Read(ulong address, int size) {
            if (address == 0 || size < 1 || size > 4096) throw new InvalidOperationException("Read bound or null address");
            byte[] data = new byte[size]; IntPtr count;
            if (!ReadProcessMemory(process, (IntPtr)(long)address, data, size, out count) || count.ToInt64() != size)
                throw new Win32Exception(Marshal.GetLastWin32Error(), "ReadProcessMemory");
            reads.Add(new ReadRecord { address=address, value=data });
            return data;
        }
        public ulong Q(ulong address) { return BitConverter.ToUInt64(Read(address, 8), 0); }
        public void Verify() {
            foreach (ReadRecord item in reads) {
                byte[] again = new byte[item.value.Length]; IntPtr count;
                if (!ReadProcessMemory(process, (IntPtr)(long)item.address, again, again.Length, out count) || count.ToInt64()!=again.Length)
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "ReadProcessMemory reread");
                for (int i=0; i<again.Length; i++) if (again[i]!=item.value[i]) throw new InvalidOperationException("Candidate snapshot changed");
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
            ulong project = reader.Q(Base + ProjectGlobal), manager = reader.Q(Base + ManagerGlobal), root = 0;
            if (project == 0 || manager == 0) throw new InvalidOperationException("Project or window manager is not initialized");
            if (reader.Q(project) != Base + 0x447d378) throw new InvalidOperationException("MProject vtable mismatch");
            root = reader.Q(project + 0xf8);
            if (root != 0 && (reader.Q(root) != Base + 0x4471c40 || reader.Q(root + 0x98) != Base + 0x4472130))
                throw new InvalidOperationException("MRoot vtable mismatch");
            ulong list = manager + 0xe0;
            if (reader.Q(list) != Base + 0x4192350) throw new InvalidOperationException("Window list vtable mismatch");
            ulong node = reader.Q(list + 0x18);
            var visited = new HashSet<ulong>(); var candidates = new List<Candidate>(); int windowCount = 0, otherWindows = 0;
            while (node != 0) {
                if (visited.Count >= 128 || !visited.Add(node)) throw new InvalidOperationException("Window list bound or cycle");
                byte[] link = reader.Read(node, 16); ulong next = BitConverter.ToUInt64(link, 0), window = BitConverter.ToUInt64(link, 8);
                windowCount++;
                if (window == 0 || reader.Q(window) != Base + 0x41ecf60) { otherWindows++; node=next; continue; }
                ulong controller = reader.Q(window + 0x48);
                if (controller < 0x10 || reader.Q(controller) != Base + 0x42df7c0) { otherWindows++; node=next; continue; }
                ulong complete = controller - 0x10;
                if (reader.Q(complete) != Base + 0x42df530) throw new InvalidOperationException("Time-controller primary vtable mismatch");
                ulong holder = reader.Q(complete + 0x468);
                if (holder == 0) { otherWindows++; node=next; continue; }
                ulong context = reader.Q(holder + 8);
                if (context == 0 || reader.Q(context) != Base + 0x446e330) { otherWindows++; node=next; continue; }
                ulong selected = reader.Q(context + 0x20);
                if (selected == 0) { otherWindows++; node=next; continue; }
                ulong document = reader.Q(selected + 0x180);
                if (document == 0 || reader.Q(document) != Base + 0x42d96c0) { otherWindows++; node=next; continue; }
                ulong path = reader.Q(document + 0x30);
                if (path == 0 || reader.Q(path) != Base + 0x4831bc0) { otherWindows++; node=next; continue; }
                ulong field108 = reader.Q(document + 0x108);
                candidates.Add(new Candidate { window=Hex(window), controller=Hex(controller), document=Hex(document), pathObject=Hex(path),
                    directory=PathField(reader, path, 0xc8), filename=PathField(reader, path, 0x18),
                    documentField108=Hex(field108), field108MatchesProjectRoot=root!=0 && field108==root });
                node=next;
            }
            reader.Verify();
            return new Snapshot { project=Hex(project), root=Hex(root), manager=Hex(manager), windowCount=windowCount,
                otherWindows=otherWindows, candidates=candidates.ToArray(), stable=true };
        } finally { CloseHandle(process); }
    }
}
'@
$root = Split-Path -Parent $PSScriptRoot
$output = Join-Path $root ('artifacts\ipc\project-candidates-{0}-{1}.json' -f $TargetProcessId, [Guid]::NewGuid().ToString('N'))
try {
    $launchPath = Join-Path $root 'artifacts\runtime\cubase-launch.json'
    $launchFile = Get-Item -LiteralPath $launchPath
    $launch = Get-Content -LiteralPath $launchPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($launch.ProcessId -ne $TargetProcessId -or $launch.Desktop -ne 'winsta0\CubaseAI_MCP') { throw 'Launch PID or desktop mismatch.' }
    $process = Get-Process -Id $TargetProcessId
    $start = $process.StartTime.ToUniversalTime()
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
    $result.data = [CubaseProjectCandidates]::ReadSnapshot($TargetProcessId)
    if ((Get-Process -Id $TargetProcessId).StartTime.ToUniversalTime() -ne $start) { throw 'Process changed during observation.' }
    $result.status = 'observed'
} catch { $result.error = $_.Exception.Message }
$result.processAliveAfter = [bool](Get-Process -Id $TargetProcessId -ErrorAction SilentlyContinue)
$result.outputPath = $output
$json = $result | ConvertTo-Json -Depth 6
[void][System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($output))
$writer = [System.IO.StreamWriter]::new([System.IO.File]::Open($output, [System.IO.FileMode]::CreateNew), [System.Text.UTF8Encoding]::new($false))
try { $writer.Write($json) } finally { $writer.Dispose() }
$json
if ($result.status -ne 'observed') { exit 1 }
