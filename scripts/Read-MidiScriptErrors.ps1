[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$TargetProcessId)

$ErrorActionPreference = 'Stop'
$report = [ordered]@{
    timestampUtc = [DateTime]::UtcNow.ToString('o'); targetProcessId = $TargetProcessId
    status = 'error'; error = $null; launchMetadata = $null; executable = $null
    fileVersion = $null; desktop = $null; processAliveAfter = $null
    treeCount = $null; visitedNodes = $null; matchFound = $false; messages = @()
    limitations = 'Snapshot only. Missing messages do not prove successful evaluation or device activation.'
}
$native = @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class MidiScriptErrorsReader {
  const ulong ImageBase = 0x140000000UL, ConsoleRva = 0x596eae0UL, VtableRva = 0x4609d58UL;
  const int MaxNodes = 256, MaxString = 4096, MaxMessages = 512;
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int id);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool ReadProcessMemory(IntPtr process, IntPtr address, byte[] buffer, int size, out IntPtr got);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  delegate bool EnumProc(IntPtr window, IntPtr state);
  [DllImport("user32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr OpenDesktopW(string name,uint flags,bool inherit,uint access);
  [DllImport("user32.dll",SetLastError=true)] static extern bool EnumDesktopWindows(IntPtr desktop,EnumProc callback,IntPtr state);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
  public sealed class Result { public int treeCount; public int visitedNodes; public bool matchFound; public List<Message> messages = new List<Message>(); }
  public sealed class Message { public int index; public int kind; public string text; }
  static byte[] Read(IntPtr p, ulong a, int n) {
    if (a == 0 || n < 0 || n > 0x6000) throw new InvalidOperationException("Read rejected by bounds.");
    byte[] b = new byte[n]; IntPtr got;
    if (!ReadProcessMemory(p, (IntPtr)(long)a, b, n, out got) || got.ToInt64()!=n) throw new Win32Exception(Marshal.GetLastWin32Error(), "ReadProcessMemory failed");
    return b;
  }
  static ulong Q(byte[] b,int offset) { return BitConverter.ToUInt64(b, offset); }
  static string ReadString(IntPtr p, byte[] data, int offset) {
    ulong len=Q(data,offset+16), cap=Q(data,offset+24);
    if (len>MaxString || cap<len) throw new InvalidOperationException("Invalid or oversized string.");
    if (len==0) return "";
    byte[] bytes;
    if (cap>15) bytes=Read(p,Q(data,offset),(int)len);
    else { bytes=new byte[(int)len]; Array.Copy(data,offset,bytes,0,(int)len); }
    return new UTF8Encoding(false,true).GetString(bytes);
  }
  public static int PrivateDesktopWindowCount(uint processId) {
    IntPtr desktop=OpenDesktopW("CubaseAI_MCP",0,false,0x41);
    if(desktop==IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(),"OpenDesktop failed");
    try {
      int count=0;
      bool ok=EnumDesktopWindows(desktop,(IntPtr h,IntPtr s)=> { uint pid; GetWindowThreadProcessId(h,out pid); if(pid==processId) count++; return true; },IntPtr.Zero);
      if(!ok) throw new Win32Exception(Marshal.GetLastWin32Error(),"EnumDesktopWindows failed");
      return count;
    } finally { CloseDesktop(desktop); }
  }
  public static Result ReadConsole(int pid, string expectedPath) {
    IntPtr p=OpenProcess(0x410,false,pid); if (p==IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(),"OpenProcess failed");
    try {
      byte[] root=Read(p,ImageBase+ConsoleRva,24);
      if (Q(root,0)!=ImageBase+VtableRva) throw new InvalidOperationException("ScriptConsole vtable mismatch or not initialized.");
      ulong head=Q(root,8), count=Q(root,16);
      if (head==0 || count>MaxNodes) throw new InvalidOperationException("Invalid ScriptConsole tree header.");
      byte[] header=Read(p,head,0x58); var stack=new Stack<ulong>(); var seen=new HashSet<ulong>();
      stack.Push(Q(header,8)); var result=new Result(); result.treeCount=(int)count;
      while(stack.Count>0) {
        ulong ptr=stack.Pop(); if(ptr==0 || ptr==head || !seen.Add(ptr)) continue;
        if(seen.Count>MaxNodes) throw new InvalidOperationException("Tree traversal exceeded bound.");
        byte[] node=Read(p,ptr,0x58); if(node[0x19]!=0) continue;
        stack.Push(Q(node,0)); stack.Push(Q(node,16));
        string key=ReadString(p,node,0x20);
        if(!String.Equals(key,expectedPath,StringComparison.OrdinalIgnoreCase)) continue;
        if(result.matchFound) throw new InvalidOperationException("Duplicate target script key.");
        result.matchFound=true;
        ulong begin=Q(node,0x40), end=Q(node,0x48), cap=Q(node,0x50);
        if(end<begin || cap<end || end-begin>MaxMessages*0x30UL || (end-begin)%0x30!=0) throw new InvalidOperationException("Invalid message vector.");
        if(end==begin) continue;
        byte[] logs=Read(p,begin,(int)(end-begin));
        for(int i=0;i<logs.Length;i+=0x30) {
          byte[] entry=new byte[0x30]; Array.Copy(logs,i,entry,0,0x30);
          result.messages.Add(new Message { index=i/0x30, kind=BitConverter.ToInt32(entry,0), text=ReadString(p,entry,0x10) });
        }
      }
      result.visitedNodes=seen.Count;
      byte[] check=Read(p,ImageBase+ConsoleRva,24);
      if(Q(check,0)!=Q(root,0)||Q(check,8)!=head||Q(check,16)!=count || seen.Count!=(int)count)
        throw new InvalidOperationException("Tree changed during observation or traversal incomplete.");
      return result;
    } finally { CloseHandle(p); }
  }
}
'@
try {
    $workspace = Split-Path -Parent $PSScriptRoot
    $launchPath = Join-Path $workspace 'artifacts\runtime\cubase-launch.json'
    $launchItem = Get-Item -LiteralPath $launchPath
    $launch = Get-Content -LiteralPath $launchPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $report.launchMetadata = $launchPath
    if ([int]$launch.ProcessId -ne $TargetProcessId -or $launch.Desktop -cne 'winsta0\CubaseAI_MCP') { throw 'Launch metadata PID or private desktop mismatch.' }
    $process = Get-Process -Id $TargetProcessId
    if ($process.StartTime.ToUniversalTime() -gt $launchItem.LastWriteTimeUtc.AddSeconds(2)) { throw 'Process started after the recorded launch metadata; PID may have been reused.' }
    $exe = $process.MainModule.FileName
    $expectedExe = 'C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe'
    if (-not [String]::Equals($exe,$expectedExe,[StringComparison]::OrdinalIgnoreCase)) { throw 'Executable path mismatch.' }
    if ($process.MainModule.BaseAddress.ToInt64() -ne 0x140000000) { throw 'Image base differs from the verified layout.' }
    $version = (Get-Item -LiteralPath $exe).VersionInfo.FileVersion
    if ($version -ne '16.0.5.174') { throw 'Executable version differs from the verified layout.' }
    $report.executable=$exe; $report.fileVersion=$version
    Add-Type $native
    $windowCount = [MidiScriptErrorsReader]::PrivateDesktopWindowCount([uint32]$TargetProcessId)
    if ($windowCount -lt 1) { throw 'No target-owned window was observed on the private desktop.' }
    $report.desktop = "winsta0\CubaseAI_MCP (metadata plus $windowCount target-owned windows; no activation)"
    $expectedPath = 'C:\Users\99325\Documents\Steinberg\Cubase\MIDI Remote\Driver Scripts\Local\CubaseAI\MCP\CubaseAI_MCP.js'
    $result = [MidiScriptErrorsReader]::ReadConsole($TargetProcessId,$expectedPath)
    $report.treeCount=$result.treeCount; $report.visitedNodes=$result.visitedNodes
    $report.matchFound=$result.matchFound; $report.messages=@($result.messages)
    $report.status='observed'
} catch { $report.error = $_.Exception.Message }
$report.processAliveAfter=[bool](Get-Process -Id $TargetProcessId -ErrorAction SilentlyContinue)
$report | ConvertTo-Json -Depth 6
if ($report.status -ne 'observed') { exit 1 }
