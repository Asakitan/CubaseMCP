const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { readFileSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ps = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const root = path.resolve(__dirname, '..');
const run = (args) => new Promise((resolve, reject) => execFile(ps, ['-NoProfile', '-NonInteractive', ...args], { windowsHide: true, timeout: 12000 }, (error, stdout, stderr) => error ? reject(new Error(`${error}\n${stderr}\n${stdout}`)) : resolve(stdout)));
const quote = s => "'" + s.replace(/'/g, "''") + "'";
test('background host pipe isolation and delayed readiness', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cubase-midi-fixture-'));
  try {
    const state = path.join(dir, 'state.json'), child = path.join(dir, 'child.ps1');
    const runtime = path.join(root, 'scripts/Project-Runtime.ps1');
    writeFileSync(child, `param([string]$HolderStdoutPath,[string]$HolderStderrPath)
Start-Sleep -Milliseconds 700\n@{pid=$PID;status='ready'}|ConvertTo-Json|Set-Content -Encoding UTF8 -LiteralPath ${quote(state)}\nStart-Sleep -Milliseconds 7000\n`);
    const src = readFileSync(path.join(root, 'scripts/Start-MidiPorts.ps1'), 'utf8');
    assert.match(src, /CubaseDesktop\]::StartDetachedHolder/);
    const parent = path.join(dir, 'parent.ps1');
    writeFileSync(parent, `
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile(${quote(runtime)},[ref]$tokens,[ref]$errors)
if($errors.Count){throw $errors[0]}
$fn=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Wait-MidiPortsReady'},$true)
Invoke-Expression $fn.Extent.Text
function node.exe { '{"readyForHandshake":true}' }
$root=${quote(root)}
Add-Type -Path ${quote(path.join(root, 'native/CubaseDesktop.cs'))}
$hostId=[CubaseAiMcp.CubaseDesktop]::StartDetachedHolder(${quote(ps)},${quote(child)},$null,${quote(path.join(dir,'stdout'))},${quote(path.join(dir,'stderr'))},${quote(root)})
if(Test-Path -LiteralPath ${quote(state)}){throw 'fixture unexpectedly ready'}
$r=Wait-MidiPortsReady -HostPid $hostId -StatePath ${quote(state)} -TimeoutMs 6000
if(-not $r.readyForHandshake){throw 'missing ready'}
Write-Output 'ready-after-delay'
`);
    const start = Date.now();
    const out = await run(['-File', parent]);
    const elapsed = Date.now() - start;
    assert.match(out, /ready-after-delay/);
    assert.ok(elapsed < 6500, `parent result delayed: ${elapsed}ms`);
    console.log(JSON.stringify({ fixture: 'delayed-ready-isolated-pipe', elapsed_ms: elapsed, result: out.trim() }));
    await new Promise(r => setTimeout(r, 7500));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test('empty launcher selects one Node executable when two are discoverable', async () => {
  const source = readFileSync(path.join(root, 'scripts/Start-CubaseEmptyBackground.ps1'), 'utf8');
  const statement = source.match(/\$node = Get-Command node\.exe -CommandType Application \| Select-Object -First 1 -ExpandProperty Source/);
  assert.ok(statement, 'launcher must select one executable');
  const command = `function Get-Command { [pscustomobject]@{Source=${quote(process.execPath)}}; [pscustomobject]@{Source='Z:\\fake\\node.exe'} }\n${statement[0]}\nif($node -is [array]){throw 'multiple executables'}\n$startup=New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ShowWindow=[uint16]0;CreateFlags=[uint32]0x01000008}\n$result=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=('"'+$node+'" -e "process.exit(0)"');CurrentDirectory=${quote(root)};ProcessStartupInformation=$startup}\nif($result.ReturnValue -ne 0){throw ('create returned '+$result.ReturnValue)}\n'one-node-created'`;
  const out = await run(['-Command', command]);
  assert.match(out, /one-node-created/);
});
