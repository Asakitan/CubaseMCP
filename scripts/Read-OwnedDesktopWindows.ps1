[CmdletBinding()]
param([switch]$VisibleOnly,[switch]$ChildText)
# Read-only inventory of the windows on the owned private desktop. It enumerates window
# handles, classes, titles and visibility only; it never sends a message, activates a window
# or switches desktops. Used to notice a dialog that a submitted command may have opened.
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = Split-Path -Parent $PSScriptRoot
try {
    $receipt = Get-Content -LiteralPath (Join-Path $root 'artifacts\runtime\cubase-launch.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($receipt.Desktop -cne 'winsta0\CubaseAI_MCP') { throw 'The launch receipt does not describe the owned private desktop.' }
    $target = Get-Process -Id ([int]$receipt.ProcessId) -ErrorAction Stop
    if ([string]$target.StartTime.ToUniversalTime().ToFileTimeUtc() -cne [string]$receipt.processCreationFiletime) { throw 'Owned lifetime mismatch.' }
    Add-Type -Path (Join-Path $root 'native\CubaseDesktop.cs')
    if($ChildText){
        Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class OwnedWindowText32 {
    private delegate bool EnumWindowProc(IntPtr window, IntPtr state);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumWindowProc callback, IntPtr state);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int InternalGetWindowText(IntPtr window, StringBuilder text, int maximum);
    public static string[] Read(long parent, uint processId) {
        var result = new List<string>();
        int count = 0;
        EnumChildWindows(new IntPtr(parent), delegate(IntPtr window, IntPtr state) {
            if (++count > 128) return false;
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner != processId) return true;
            var text = new StringBuilder(4096);
            if (InternalGetWindowText(window, text, text.Capacity) > 0) result.Add(text.ToString());
            return true;
        }, IntPtr.Zero);
        return result.ToArray();
    }
}
'@
    }
    $windows = @([CubaseAiMcp.CubaseDesktop]::Inspect('CubaseAI_MCP') | Where-Object { $_.ProcessId -eq $target.Id })
    if ($VisibleOnly) { $windows = @($windows | Where-Object { $_.Visible }) }
    [ordered]@{
        status = 'observed'; pid = $target.Id; creation = [string]$receipt.processCreationFiletime; sampledUtc = [DateTime]::UtcNow.ToString('o')
        count = $windows.Count
        windows = @($windows | ForEach-Object {
            $entry=[ordered]@{ handle = $_.Handle; className = $_.ClassName; title = $_.Title; visible = $_.Visible }
            if($ChildText){$entry.childText=@([OwnedWindowText32]::Read([Convert]::ToInt64([string]$_.Handle,16),[uint32]$target.Id))}
            $entry
        })
        limitation = 'One unlocked sample; a transient window between samples is not observed.'
    } | ConvertTo-Json -Depth 5 -Compress
} catch {
    [ordered]@{ status = 'error'; error = $_.Exception.Message } | ConvertTo-Json -Compress
    exit 1
}
