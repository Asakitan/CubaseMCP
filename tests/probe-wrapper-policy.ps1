$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
foreach ($name in @('Invoke-NativeProbe.ps1', 'Invoke-PathServiceProbe.ps1', 'Invoke-PathRoundTripProbe.ps1')) {
    $path = Join-Path $root ('scripts\' + $name)
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$errors)
    if ($errors.Count -gt 0) { throw "$name has PowerShell parse errors." }
    $matches = @($ast.FindAll({
        param($node)
        $node -is [System.Management.Automation.Language.IfStatementAst] -and
            $node.Clauses.Count -eq 1 -and $node.Clauses[0].Item1.Extent.Text -like '$Result.Error*'
    }, $true))
    if ($matches.Count -ne 1) { throw "Expected exactly one entry-result guard in $name." }
    $condition = [scriptblock]::Create($matches[0].Clauses[0].Item1.Extent.Text)
    foreach ($case in @(
        @{ code = 0; completed = $true; error = $null; failed = $false },
        @{ code = 1; completed = $true; error = $null; failed = $true },
        @{ code = 2; completed = $true; error = $null; failed = $true },
        @{ code = 0; completed = $false; error = $null; failed = $true },
        @{ code = 0; completed = $true; error = 'load failed'; failed = $true }
    )) {
        $Result = [PSCustomObject]@{ Error = $case.error; EntryCompleted = $case.completed; EntryReturnCode = $case.code }
        if ([bool](& $condition) -ne $case.failed) { throw "Unexpected entry-result guard outcome in $name." }
    }
}
Write-Output 'Fixed probe wrapper exit policies passed.'
