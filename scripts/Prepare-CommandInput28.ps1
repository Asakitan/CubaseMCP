# Historical single-use 3.10 experiment. Current source is deliberately rejected;
# this is not a production install path or an automatic compatibility route.
$ErrorActionPreference='Stop'
$root='E:\VC\CubaseMCP'
if((Split-Path -Parent $PSScriptRoot) -ine $root){throw 'Unexpected workspace.'}
$dir=Join-Path $root 'artifacts\command-input-28'
$fixture=Join-Path $root 'artifacts\live-smoke\Command Input 28.cpr'
$source=Join-Path $root 'artifacts\live-smoke\MCP Device Test 20261110.cpr'
foreach($p in @($root,(Join-Path $root 'artifacts'),(Join-Path $root 'artifacts\live-smoke'),$source)){
    if(([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Unexpected reparse point.'}
}
if(Test-Path -LiteralPath $dir){throw 'Diagnostic preparation already exists.'}
$controller=[IO.File]::ReadAllText((Join-Path $root 'remote\controller.js'))
if(-not $controller.Contains("var BRIDGE_REVISION = '2026-11-10-coverage-3.10';")){throw 'Unexpected controller baseline.'}
$anchor="            method(record.binding, 'canPerform');"
if([regex]::Matches($controller,[regex]::Escape($anchor)).Count -ne 1){throw 'Command initialization anchor mismatch.'}
$addition=@'
            method(record.binding, 'canPerform');
            if (definition.key === 'project.save') {
                var midiBinding = invoke(record.surface.mMidiBinding, 'setInputPort', [input]);
                invoke(midiBinding, 'setIsConsuming', [true]);
                invoke(midiBinding, 'bindToNote', [15, 126]);
                record.surface.mOnProcessValueChange = function (device, value) {
                    if (device === activeDevice && activeMapping) trace('diagnostic28 save surface ' + value);
                };
                record.binding.mOnValueChange = function (device, mapping, value) {
                    if (device === activeDevice && mapping === activeMapping) trace('diagnostic28 save binding ' + value);
                };
            }
'@
$controller=$controller.Replace($anchor,$addition)
$profile='bridgeRevision: BRIDGE_REVISION,'
if([regex]::Matches($controller,[regex]::Escape($profile)).Count -ne 1){throw 'Status profile anchor mismatch.'}
$controller=$controller.Replace($profile,"bridgeRevision: BRIDGE_REVISION, diagnosticProfile: 'command-input-28',")
[void][IO.Directory]::CreateDirectory($dir)
[IO.File]::WriteAllText((Join-Path $dir 'controller.js'),$controller,[Text.UTF8Encoding]::new($false))
foreach($name in @('CubaseAI_MCP.js','commands.js','protocol.js')){[IO.File]::Copy((Join-Path $root ('remote\'+$name)),(Join-Path $dir $name),$false)}
& node.exe --check (Join-Path $dir 'controller.js')
if($LASTEXITCODE -ne 0){throw 'Diagnostic controller syntax failed.'}
$inputFile=[IO.File]::Open($source,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
try {
    if($inputFile.Length -ne 93085){throw 'Fixture source size mismatch.'}
    $outputFile=[IO.File]::Open($fixture,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try {$inputFile.CopyTo($outputFile);$outputFile.Flush($true)} finally {$outputFile.Dispose()}
} finally {$inputFile.Dispose()}
[ordered]@{status='prepared_not_installed';directory=$dir;fixture=$fixture;noteChannel=15;note=126;command='File/Save';profile='command-input-28'}|ConvertTo-Json
