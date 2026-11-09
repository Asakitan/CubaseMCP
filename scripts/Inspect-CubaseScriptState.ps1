param(
    [Parameter(Mandatory=$true)][int]$TargetPid,
    [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $OutputPath) { throw 'Output already exists.' }
$source = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class ConsoleSnapshot {
  [StructLayout(LayoutKind.Sequential)] public struct COORD { public short X,Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public short Left,Top,Right,Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct INFO { public COORD Size,Cursor; public short Attr; public RECT Window; public COORD Max; }
  [DllImport("kernel32.dll",SetLastError=true)] public static extern bool FreeConsole();
  [DllImport("kernel32.dll",SetLastError=true)] public static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] public static extern IntPtr CreateFileW(string n,uint access,uint share,IntPtr sa,uint disposition,uint flags,IntPtr template);
  [DllImport("kernel32.dll",SetLastError=true)] public static extern bool GetConsoleScreenBufferInfo(IntPtr h,out INFO info);
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] public static extern bool ReadConsoleOutputCharacterW(IntPtr h,StringBuilder text,uint length,COORD pos,out uint read);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
}
'@
Add-Type $source
$r = [ordered]@{utc=[DateTime]::UtcNow.ToString('o');pid=$TargetPid;aliveBefore=[bool](Get-Process -Id $TargetPid -ErrorAction SilentlyContinue);attached=$false;error=$null;bufferWidth=$null;bufferHeight=$null;lines=@();scope='AttachConsole and bounded ReadConsoleOutputCharacterW in isolated helper; no input, window activation or process writes'}
if (-not $r.aliveBefore) { throw 'Target process is not running.' }
[void][ConsoleSnapshot]::FreeConsole()
if (-not [ConsoleSnapshot]::AttachConsole([uint32]$TargetPid)) {
    $r.error = 'AttachConsole Win32 error ' + [Runtime.InteropServices.Marshal]::GetLastWin32Error()
} else {
    $r.attached = $true
    $h = [ConsoleSnapshot]::CreateFileW('CONOUT$',0x80000000,3,[IntPtr]::Zero,3,0,[IntPtr]::Zero)
    if ($h -eq [IntPtr](-1)) { $r.error='CreateFile CONOUT$ Win32 error ' + [Runtime.InteropServices.Marshal]::GetLastWin32Error() }
    else {
        try {
            $info=New-Object ConsoleSnapshot+INFO
            if (-not [ConsoleSnapshot]::GetConsoleScreenBufferInfo($h,[ref]$info)) { throw ('GetConsoleScreenBufferInfo Win32 error ' + [Runtime.InteropServices.Marshal]::GetLastWin32Error()) }
            $r.bufferWidth=[int]$info.Size.X; $r.bufferHeight=[int]$info.Size.Y
            if ($info.Size.X -le 0 -or $info.Size.X -gt 500 -or $info.Size.Y -le 0 -or $info.Size.Y -gt 10000) { throw 'Console dimensions exceed bounds.' }
            for ($y=0; $y -lt $info.Size.Y; $y++) {
                $pos=New-Object ConsoleSnapshot+COORD; $pos.X=0; $pos.Y=[int16]$y
                $builder=New-Object System.Text.StringBuilder ([int]$info.Size.X); [uint32]$read=0
                if (-not [ConsoleSnapshot]::ReadConsoleOutputCharacterW($h,$builder,[uint32]$info.Size.X,$pos,[ref]$read)) { throw ('ReadConsoleOutputCharacter Win32 error ' + [Runtime.InteropServices.Marshal]::GetLastWin32Error()) }
                $line=$builder.ToString().TrimEnd(); if ($line.Length -gt 0) { $r.lines += $line }
            }
        } catch { $r.error=$_.Exception.Message } finally { [void][ConsoleSnapshot]::CloseHandle($h) }
    }
    [void][ConsoleSnapshot]::FreeConsole()
}
$r.aliveAfter=[bool](Get-Process -Id $TargetPid -ErrorAction SilentlyContinue)
$r | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
