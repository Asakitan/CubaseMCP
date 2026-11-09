[CmdletBinding()]
param([int]$TargetProcessId = 24036)
$ErrorActionPreference = 'Stop'
$result = [ordered]@{
    pid = $TargetProcessId; errorKind = $null; timestampUtc = [DateTime]::UtcNow.ToString('o'); status = 'error'; error = $null
    processStartUtc = $null; desktopWindows = $null; processAliveAfter = $false; data = $null; outputPath = $null
    limitation = 'Unlocked non-atomic window observations, not proof of loaded project or operation completion.'
}
$native = @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class CubaseProjectWindowControllers20 {
    const ulong Base = 0x140000000, ProjectGlobal = 0x59110d0, ManagerGlobal = 0x5973480;
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool ReadProcessMemory(IntPtr process, IntPtr address, byte[] data, int size, out IntPtr read);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    public sealed class Window { public string node, window, windowVtable, windowType, field48, controllerVtable, controllerType; }
    public sealed class Snapshot { public string manager, listHead; public int windowCount; public bool stable; public Window[] windows; }
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
            ulong manager = reader.Q(Base + ManagerGlobal);
            if (manager == 0 || reader.Q(manager + 0xe0) != Base + 0x4192350) throw new InvalidOperationException("PROFILE: manager/list mismatch");
            ulong head = reader.Q(manager + 0xf8), node = head;
            var visited = new HashSet<ulong>(); var windows = new List<Window>();
            while (node != 0) {
                if (visited.Count >= 128 || !visited.Add(node)) throw new InvalidOperationException("BOUND: list limit or cycle");
                byte[] link = reader.Read(node, 16);
                ulong next = BitConverter.ToUInt64(link, 0), window = BitConverter.ToUInt64(link, 8);
                if (window == 0) throw new InvalidOperationException("PROFILE: null window");
                ulong wvt = reader.Q(window), field = reader.Q(window + 0x48);
                bool knownWindow = wvt == Base + 0x41ecf60;
                ulong cvt = knownWindow && field != 0 ? reader.Q(field) : 0;
                string kind = knownWindow && cvt == Base + 0x42df7c0 ? "FocusControllerAwareTimeEditController interface" :
                    knownWindow && cvt == Base + 0x42c00c8 ? "ScoreEditorViewController interface" : "unknown";
                windows.Add(new Window { node=Hex(node), window=Hex(window), windowVtable=Hex(wvt),
                    windowType=knownWindow ? "UDocWindow" : "unknown", field48=Hex(field),
                    controllerVtable=knownWindow && field != 0 ? Hex(cvt) : null,
                    controllerType=!knownWindow ? "unknown" : field == 0 ? "null" : kind });
                node=next;
            }
            reader.Verify();
            return new Snapshot { manager=Hex(manager), listHead=Hex(head), windowCount=windows.Count, windows=windows.ToArray(), stable=true };
        } finally { CloseHandle(process); }
    }
}
'@
$root = Split-Path -Parent $PSScriptRoot
$output = Join-Path $root ('artifacts\ipc\project-window-controllers-{0}-{1}.json' -f $TargetProcessId, [Guid]::NewGuid().ToString('N'))
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
    $result.data = [CubaseProjectWindowControllers20]::ReadSnapshot($TargetProcessId)
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
