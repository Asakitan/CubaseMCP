$ErrorActionPreference='Stop'
Add-Type -Path (Join-Path $PSScriptRoot '..\native\FirstOpen26JobAudit.cs')
for($i=0;$i -lt 3;$i++) {
 $rejected=$false
 try { [CubaseAiMcp.FirstOpen26JobAudit]::Verify([IntPtr]::Zero,1,1,[IntPtr]::Zero,2,2) | Out-Null } catch {$rejected=$true}
 if(!$rejected){throw 'Invalid handles accepted.'}
}
'FirstOpen26 Job invalid-handle tests passed.'
