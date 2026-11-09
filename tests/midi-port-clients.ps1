$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Add-Type -Path (Join-Path $root 'native\MidiPortHost.cs')
if (-not [CubaseAiMcp.MidiPortHost].GetMethod('GetClientProcessIds')) {
    throw 'The port host lacks the client-process snapshot method.'
}
$suffix = [Guid]::NewGuid().ToString('N').Substring(0, 8)
$names = [string[]]@("MCP-Test-$suffix-A", "MCP-Test-$suffix-B")
$portHost = $null
$child = $null
try {
    $portHost = New-Object CubaseAiMcp.MidiPortHost -ArgumentList (,$names)
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = (Get-Command node.exe -ErrorAction Stop).Source
    $start.Arguments = '"' + (Join-Path $root 'tests\midi-client-hold.cjs') + '" "' + $names[0] + '"'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $child = [Diagnostics.Process]::Start($start)
    $line = $child.StandardOutput.ReadLineAsync()
    if (-not $line.Wait(5000) -or $line.Result -ne 'open') {
        $detail = if ($child.HasExited) { $child.StandardError.ReadToEnd() } else { 'The client is still running.' }
        throw "The temporary MIDI client did not open its port: $detail"
    }
    $clients = $portHost.GetClientProcessIds()
    if ($clients.Length -ne 2 -or $clients[0] -notcontains [uint64]$child.Id) {
        throw "The first port did not report MIDI client PID $($child.Id)."
    }
    if ($clients[1] -contains [uint64]$child.Id) { throw 'The unused second port falsely reported the client.' }
    Write-Output 'MIDI client-process snapshot passed.'
} finally {
    if ($null -ne $child) {
        $child.StandardInput.Close()
        if (-not $child.WaitForExit(5000)) { $child.Kill() }
        $child.Dispose()
    }
    if ($null -ne $portHost) { $portHost.Dispose() }
}
