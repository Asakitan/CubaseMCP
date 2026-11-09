[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$TargetProcessId)

$ErrorActionPreference = 'Stop'
$result = [ordered]@{
    pid = $TargetProcessId
    timestampUtc = [DateTime]::UtcNow.ToString('o')
    status = 'error'
    error = $null
    processStartUtc = $null
    desktopWindows = $null
    contextAddress = $null
    hostInterfaceAddress = $null
    hostClassesAddress = $null
    pathRegistrationAddress = $null
    pathRegistrationIid = $null
    pathFactoryRva = $null
    pathRegistry = $null
    vtableRvas = $null
    stable = $false
    processAliveAfter = $false
    outputPath = $null
    limitation = 'Unpinned separate read-only snapshots; no interface query, reference adjustment, factory call, host call, project operation or proof of live lookup success, context lifetime, thread or readiness.'
}

$source = @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class PluginContextStaticSnapshot {
    const ulong ImageBase = 0x140000000, Context = 0x55233f0;
    static readonly ulong[] Expected = { 0x47371c0, 0x4737230, 0x4737258, 0x47372a0, 0x47372c8, 0x47372f0 };
    static readonly byte[] PathIid = { 0xa1, 0x8e, 0xf3, 0x0a, 0xf2, 0x40, 0x14, 0x4b, 0x96, 0x5b, 0xf9, 0x7c, 0xa4, 0xff, 0x94, 0xd1 };
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int id);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool ReadProcessMemory(IntPtr process, IntPtr address, byte[] buffer, int size, out IntPtr read);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    delegate bool WindowCallback(IntPtr window, IntPtr state);
    [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr OpenDesktopW(string name, uint flags, bool inherit, uint access);
    [DllImport("user32.dll", SetLastError=true)] static extern bool EnumDesktopWindows(IntPtr desktop, WindowCallback callback, IntPtr state);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
    public static int DesktopWindows(int pid) {
        IntPtr desktop = OpenDesktopW("CubaseAI_MCP", 0, false, 0x41);
        if (desktop == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenDesktopW");
        try {
            int count = 0;
            WindowCallback callback = (IntPtr window, IntPtr state) => { uint owner; GetWindowThreadProcessId(window, out owner); if (owner == (uint)pid) count++; return true; };
            if (!EnumDesktopWindows(desktop, callback, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error(), "EnumDesktopWindows");
            GC.KeepAlive(callback);
            return count;
        } finally { CloseDesktop(desktop); }
    }
    static byte[] Read(IntPtr process, ulong address, int length) {
        byte[] buffer = new byte[length]; IntPtr read;
        if (!ReadProcessMemory(process, (IntPtr)(long)address, buffer, buffer.Length, out read) || read.ToInt64() != buffer.Length)
            throw new Win32Exception(Marshal.GetLastWin32Error(), "ReadProcessMemory");
        return buffer;
    }
    public static string[] Snapshot(int pid) {
        IntPtr process = OpenProcess(0x410, false, pid);
        if (process == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenProcess");
        try {
            byte[] first = Read(process, ImageBase + Context, Expected.Length * 8), second = Read(process, ImageBase + Context, Expected.Length * 8);
            byte[] classes = Read(process, ImageBase + Context + 0x68, 8), classesAgain = Read(process, ImageBase + Context + 0x68, 8);
            for (int i = 0; i < first.Length; i++) if (first[i] != second[i]) throw new InvalidOperationException("Context changed during snapshot");
            for (int i = 0; i < classes.Length; i++) if (classes[i] != classesAgain[i]) throw new InvalidOperationException("Host classes changed during snapshot");
            string[] result = new string[Expected.Length + 1];
            for (int i = 0; i < Expected.Length; i++) {
                ulong value = BitConverter.ToUInt64(first, i * 8);
                if (value != ImageBase + Expected[i]) throw new InvalidOperationException("Context vtable mismatch at +0x" + (i * 8).ToString("x"));
                result[i] = "0x" + (value - ImageBase).ToString("x");
            }
            if (BitConverter.ToUInt64(classes, 0) != ImageBase + 0x47373c8) throw new InvalidOperationException("Host classes vtable mismatch");
            result[Expected.Length] = "0x47373c8";
            return result;
        } finally { CloseHandle(process); }
    }
    public static string[] Registration(int pid) {
        IntPtr process = OpenProcess(0x410, false, pid);
        if (process == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenProcess");
        try {
            byte[] first = Read(process, ImageBase + 0x59a03d0, 0x40), second = Read(process, ImageBase + 0x59a03d0, 0x40);
            for (int i = 0; i < first.Length; i++) if (first[i] != second[i]) throw new InvalidOperationException("Path registration changed during snapshot");
            for (int i = 0; i < PathIid.Length; i++) if (first[0x18 + i] != PathIid[i]) throw new InvalidOperationException("Path registration IID mismatch");
            if (BitConverter.ToUInt64(first, 0x28) != ImageBase + 0x3b0ed80) throw new InvalidOperationException("Path registration callback mismatch");
            return new string[] { "a18ef30af240144b965bf97ca4ff94d1", "0x3b0ed80" };
        } finally { CloseHandle(process); }
    }
    public sealed class RegistryResult {
        public uint bucketCount;
        public uint entryCount;
        public uint expectedBucket;
        public uint matchingBucket;
        public uint matchingEntries;
        public uint matchingIidEntries;
        public bool firstMatchingIidIsTarget;
        public bool recordFound;
        public bool stable;
    }
    static bool Equal(byte[] a, byte[] b) {
        if (a.Length != b.Length) return false;
        for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return false;
        return true;
    }
    static ulong ReadQ(IntPtr process, ulong address) { return BitConverter.ToUInt64(Read(process, address, 8), 0); }
    static uint IidBucket(uint capacity) {
        uint a = BitConverter.ToUInt32(PathIid, 0);
        uint b = ((uint)PathIid[5] << 24) | ((uint)PathIid[4] << 16) | ((uint)PathIid[7] << 8) | PathIid[6];
        uint c = ((uint)PathIid[8] << 24) | ((uint)PathIid[9] << 16) | ((uint)PathIid[10] << 8) | PathIid[11];
        uint d = ((uint)PathIid[12] << 24) | ((uint)PathIid[13] << 16) | ((uint)PathIid[14] << 8) | PathIid[15];
        return unchecked(a + b + c + d) % capacity;
    }
    public static RegistryResult Registry(int pid) {
        IntPtr process = OpenProcess(0x410, false, pid);
        if (process == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenProcess");
        try {
            ulong globalAddress = ImageBase + 0x5889af0, factory = ReadQ(process, globalAddress);
            if (factory == 0) throw new InvalidOperationException("Class factory global is not initialized");
            byte[] factoryHeader = Read(process, factory, 0x18);
            if (BitConverter.ToUInt64(factoryHeader, 0) != ImageBase + 0x483c260) throw new InvalidOperationException("Class factory vtable mismatch");
            ulong container = BitConverter.ToUInt64(factoryHeader, 0x10);
            if (container == 0) throw new InvalidOperationException("Class registry container is null");
            ulong tableAddress = container + 0x30;
            byte[] table = Read(process, tableAddress, 0x30);
            if (BitConverter.ToUInt64(table, 0) != ImageBase + 0x483c468) throw new InvalidOperationException("Class registry table vtable mismatch");
            uint capacity = BitConverter.ToUInt32(table, 0x10), total = BitConverter.ToUInt32(table, 0x20);
            if (capacity == 0 || capacity > 256 || total > 4096) throw new InvalidOperationException("Class registry bounds exceeded");
            if (BitConverter.ToUInt64(table, 0x18) != ImageBase + 0x3b8f9e0) throw new InvalidOperationException("Class registry hash function mismatch");
            ulong buckets = BitConverter.ToUInt64(table, 0x28);
            if (buckets == 0) throw new InvalidOperationException("Class registry buckets are null");
            byte[] headers = Read(process, buckets, checked((int)capacity * 0x18));
            var nodes = new Dictionary<ulong, byte[]>();
            var records = new Dictionary<ulong, byte[]>();
            uint count = 0, matches = 0, matchingBucket = 0, matchingIids = 0, expectedBucket = IidBucket(capacity);
            ulong firstMatchingIid = 0;
            for (uint i = 0; i < capacity; i++) {
                int offset = checked((int)i * 0x18);
                uint bucketCount = BitConverter.ToUInt32(headers, offset);
                ulong node = BitConverter.ToUInt64(headers, offset + 8), tail = BitConverter.ToUInt64(headers, offset + 0x10), last = 0;
                if (bucketCount > 4096 || count + bucketCount > 4096) throw new InvalidOperationException("Class registry bucket bound exceeded");
                uint seen = 0;
                while (node != 0) {
                    if (seen >= bucketCount || nodes.ContainsKey(node)) throw new InvalidOperationException("Class registry cycle or length mismatch");
                    byte[] entry = Read(process, node, 0x10);
                    nodes.Add(node, entry);
                    ulong record = BitConverter.ToUInt64(entry, 8);
                    if (record == ImageBase + 0x59a03d0) { matches++; matchingBucket = i; }
                    if (i == expectedBucket && record != 0) {
                        byte[] recordData = Read(process, record + 0x18, 0x18);
                        if (!records.ContainsKey(record)) records.Add(record, recordData);
                        bool equal = true;
                        for (int j = 0; j < PathIid.Length; j++) if (recordData[j] != PathIid[j]) equal = false;
                        if (equal) { if (matchingIids == 0) firstMatchingIid = record; matchingIids++; }
                    }
                    last = node; node = BitConverter.ToUInt64(entry, 0); seen++;
                }
                if (seen != bucketCount || (seen == 0 ? tail != 0 : tail != last)) throw new InvalidOperationException("Class registry bucket header mismatch");
                count += seen;
            }
            if (count != total) throw new InvalidOperationException("Class registry total mismatch");
            if (matches != 0 && matchingBucket != expectedBucket) throw new InvalidOperationException("Class registry IID hash bucket mismatch");
            if (ReadQ(process, globalAddress) != factory || !Equal(factoryHeader, Read(process, factory, 0x18)) ||
                !Equal(table, Read(process, tableAddress, 0x30)) || !Equal(headers, Read(process, buckets, headers.Length)))
                throw new InvalidOperationException("Class registry header changed during snapshot");
            foreach (var entry in nodes) if (!Equal(entry.Value, Read(process, entry.Key, 0x10))) throw new InvalidOperationException("Class registry node changed during snapshot");
            foreach (var entry in records) if (!Equal(entry.Value, Read(process, entry.Key + 0x18, 0x18))) throw new InvalidOperationException("Class registry record changed during snapshot");
            return new RegistryResult { bucketCount=capacity, entryCount=count, expectedBucket=expectedBucket, matchingBucket=matchingBucket,
                matchingEntries=matches, matchingIidEntries=matchingIids, firstMatchingIidIsTarget=firstMatchingIid == ImageBase + 0x59a03d0,
                recordFound=matches != 0, stable=true };
        } finally { CloseHandle(process); }
    }
}
'@

$root = Split-Path -Parent $PSScriptRoot
$output = Join-Path $root ('artifacts\ipc\plugin-context-static-{0}-{1}.json' -f $TargetProcessId, [Guid]::NewGuid().ToString('N'))
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
    if ($path -ne 'C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe') { throw 'Executable mismatch.' }
    if ((Get-Item -LiteralPath $path).VersionInfo.FileVersion -ne '16.0.5.174') { throw 'Executable version mismatch.' }
    if ($process.MainModule.BaseAddress.ToInt64() -ne 0x140000000) { throw 'Image base mismatch.' }
    $stream = [System.IO.File]::OpenRead($path)
    try {
        $reader = [System.IO.BinaryReader]::new($stream)
        $stream.Position = 0x3c
        $peOffset = $reader.ReadUInt32()
        $stream.Position = $peOffset
        if ($reader.ReadUInt32() -ne 0x4550 -or $reader.ReadUInt16() -ne 0x8664) { throw 'PE signature or machine mismatch.' }
        $stream.Position = $peOffset + 8
        if ($reader.ReadUInt32() -ne 0x6adf121b) { throw 'PE timestamp mismatch.' }
    } finally { $stream.Dispose() }
    Add-Type -TypeDefinition $source
    $result.desktopWindows = [PluginContextStaticSnapshot]::DesktopWindows($TargetProcessId)
    if ($result.desktopWindows -lt 1) { throw 'Private desktop ownership not observed.' }
    $result.vtableRvas = [PluginContextStaticSnapshot]::Snapshot($TargetProcessId)
    $registration = [PluginContextStaticSnapshot]::Registration($TargetProcessId)
    $result.pathRegistry = [PluginContextStaticSnapshot]::Registry($TargetProcessId)
    if ((Get-Process -Id $TargetProcessId).StartTime.ToUniversalTime() -ne $start) { throw 'Process changed during observation.' }
    $result.contextAddress = '0x1455233f0'
    $result.hostInterfaceAddress = '0x1455233f8'
    $result.hostClassesAddress = '0x145523458'
    $result.pathRegistrationAddress = '0x1459a03d0'
    $result.pathRegistrationIid = $registration[0]
    $result.pathFactoryRva = $registration[1]
    $result.stable = $true
    $result.status = 'observed'
} catch { $result.error = $_.Exception.Message }
$result.processAliveAfter = [bool](Get-Process -Id $TargetProcessId -ErrorAction SilentlyContinue)
$result.outputPath = $output
$json = $result | ConvertTo-Json -Depth 5
$writer = [System.IO.StreamWriter]::new([System.IO.File]::Open($output, [System.IO.FileMode]::CreateNew), [System.Text.UTF8Encoding]::new($false))
try { $writer.Write($json) } finally { $writer.Dispose() }
$json
if ($result.status -ne 'observed') { exit 1 }
