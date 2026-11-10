[CmdletBinding()]
param([Parameter(Mandatory)][int]$TargetProcessId)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$launch = Get-Content -LiteralPath (Join-Path $root 'artifacts/runtime/cubase-launch.json') -Raw -Encoding utf8 | ConvertFrom-Json
if ($launch.ProcessId -ne $TargetProcessId) { throw 'The target is not the owned host.' }
$source = @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;

public sealed class TrackConnections33 {
    const ulong Image = 0x140000000;
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool ReadProcessMemory(IntPtr process, IntPtr address, byte[] bytes, int size, out IntPtr read);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    public sealed class Entry { public string path, address, typeRva, ownerAddress, ownerTypeRva, deviceAddress, deviceTypeRva, ownerKeyHex; }
    public sealed class Result { public string root; public Entry[] tracks; }
    readonly IntPtr process;
    readonly List<Entry> entries = new List<Entry>();
    readonly HashSet<ulong> seen = new HashSet<ulong>();
    TrackConnections33(IntPtr handle) { process = handle; }
    byte[] Bytes(ulong address, int size) {
        if (address < 0x10000 || size < 1 || size > 4096) throw new InvalidOperationException("Read bound");
        byte[] bytes = new byte[size]; IntPtr read;
        if (!ReadProcessMemory(process, (IntPtr)(long)address, bytes, size, out read) || read.ToInt64() != size)
            throw new Win32Exception(Marshal.GetLastWin32Error());
        return bytes;
    }
    ulong Q(ulong address) { return BitConverter.ToUInt64(Bytes(address, 8), 0); }
    static string Hex(ulong value) { return "0x" + value.ToString("x"); }
    void Walk(ulong data, string parent, int depth) {
        if (depth > 8 || Q(data) != Image + 0x4479f30) return;
        ulong item = Q(data + 0xb0); int index = 0;
        while (item != 0) {
            if (entries.Count >= 256 || !seen.Add(item)) throw new InvalidOperationException("Track traversal bound");
            string path = parent.Length == 0 ? index.ToString() : parent + "/" + index;
            ulong type = Q(item), owner = Q(item + 0x50), device = owner == 0 ? 0 : Q(owner + 0xc8);
            var entry = new Entry { path = path, address = Hex(item), typeRva = Hex(type - Image), ownerAddress = Hex(owner),
                ownerTypeRva = owner == 0 ? null : Hex(Q(owner) - Image), deviceAddress = Hex(device),
                deviceTypeRva = device == 0 ? null : Hex(Q(device) - Image),
                ownerKeyHex = owner == 0 ? null : BitConverter.ToString(Bytes(owner + 0x78, 72)) };
            entries.Add(entry);
            ulong children = Q(item + 0x58);
            if (children != 0 && Q(children) == Image + 0x4479f30) Walk(children, path, depth + 1);
            item = Q(item + 0x10); ++index;
        }
    }
    public static Result Read(int pid) {
        IntPtr handle = OpenProcess(0x410, false, pid);
        if (handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            var reader = new TrackConnections33(handle);
            ulong project = reader.Q(Image + 0x59110d0), root = reader.Q(project + 0xf8);
            if (reader.Q(root) != Image + 0x4471c40) throw new InvalidOperationException("Root profile mismatch");
            reader.Walk(reader.Q(root + 0x58), "", 0);
            return new Result { root = Hex(root), tracks = reader.entries.ToArray() };
        } finally { CloseHandle(handle); }
    }
}
'@
if (-not ('TrackConnections33' -as [type])) { Add-Type -TypeDefinition $source }
$result = [TrackConnections33]::Read($TargetProcessId)
$result | ConvertTo-Json -Depth 6