# Dot-source before session compilers or child helpers so new scratch stays on E:.
$workspaceTemp='E:\VC\CubaseMCP\artifacts\scratch-temp'
foreach($tempParent in @('E:\VC\CubaseMCP','E:\VC\CubaseMCP\artifacts')){
    if(([IO.File]::GetAttributes($tempParent) -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Unexpected scratch parent reparse point.'}
}
[void][IO.Directory]::CreateDirectory($workspaceTemp)
if(([IO.File]::GetAttributes($workspaceTemp) -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Unexpected scratch directory reparse point.'}
$env:TEMP=$workspaceTemp
$env:TMP=$workspaceTemp
