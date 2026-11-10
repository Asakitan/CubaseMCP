'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { Client, InMemoryTransport } = require('@modelcontextprotocol/client');
const lifecycle = require('../dist/src/lifecycle.js');
const { MidiClient } = require('../dist/src/midi.js');
const { EXPECTED_BRIDGE_REVISION } = require('../dist/src/bridge-contract.js');
const { createServer } = require('../dist/src/server.js');
const { readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

test('startup recovery rejects native admission and stops only the sampled license-blocked instance', () => {
    const source = readFileSync(join(__dirname, '../scripts/Project-Runtime.ps1'), 'utf8');
    const body = source.slice(source.indexOf('function Recover-LicenseStartup('), source.indexOf('\ntry {\n    $operation='));
    assert.ok(body.startsWith('function Recover-LicenseStartup('));
    const script = String.raw`
$ErrorActionPreference='Stop'
$env:CommonProgramFiles='C:\Program Files\Common Files'
$directory='E:\fixture';$startupRecovery=@();$nativeSubmitted=$false;$calls=@()
$helper=[pscustomobject]@{Id=90;SessionId=1;Handle=1;Path='C:\Program Files\Common Files\Steinberg\Activation Manager\SteinbergLicenseEngine.exe';StartTime=[datetime]'2026-11-10';HasExited=$false}
$helper|Add-Member ScriptMethod Refresh {}
$helper|Add-Member ScriptMethod Kill {$script:calls+=@('helper');$this.HasExited=$true}
$helper|Add-Member ScriptMethod WaitForExit {param($milliseconds) return $true}
$helper|Add-Member ScriptMethod Dispose {}
function Test-Path { param($LiteralPath) return $script:nativeSubmitted }
function Get-Process { param($Name,$ErrorAction) if($Name -eq 'SteinbergLicenseEngine'){return $script:helper};return @() }
function Write-AtomicJson { param($Path,$Value) }
function Stop-Owned { param($Owned,[switch]$StartupRecovery) if(-not $StartupRecovery){throw 'Missing startup admission'};$script:calls+=@($Owned.target.Id) }
${body}
$owned=@{target=@{Id=12;SessionId=1};creation='123'}
$windows=@{status='observed';pid=12;creation='123';windows=@(@{visible=$true;className='SteinbergWindowClass';title='Checking licenses...'})}
Recover-LicenseStartup $owned $windows
if($calls.Count -ne 2 -or $calls[0] -ne 12 -or $calls[1] -ne 'helper' -or $startupRecovery[0].state -ne 'stopped_before_native_submission'){throw 'Recovery shutdown order failed'}
$nativeSubmitted=$true
try{Recover-LicenseStartup $owned $windows;throw 'Admission bypassed'}catch{if($_.Exception.Message -ne 'Startup recovery identity mismatch.'){throw}}
$nativeSubmitted=$false;$windows.windows[0].title='Save project?'
try{Recover-LicenseStartup $owned $windows;throw 'Dialog bypassed'}catch{if($_.Exception.Message -ne 'Startup is not blocked exclusively at license checking.'){throw}}
if($calls.Count -ne 2){throw 'Rejected operation stopped a process'}
'STARTUP_RECOVERY_PASSED'
`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /STARTUP_RECOVERY_PASSED/);
});

test('lifecycle PowerShell scripts parse and the empty holder uses an independent fixed launch', () => {
    const root = join(__dirname, '..');
    const files = ['Project-Runtime.ps1', 'Start-CubaseEmptyBackground.ps1'];
    const script = `$ErrorActionPreference='Stop';foreach($file in @(${files.map(file => `'${join(root, 'scripts', file)}'`).join(',')})) { $parseErrors=$null;[void][System.Management.Automation.Language.Parser]::ParseFile($file,[ref]$null,[ref]$parseErrors);if($parseErrors.Count){throw ($parseErrors|Out-String)} };'PARSE_PASSED'`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PARSE_PASSED/);
    const launcher = readFileSync(join(root, 'scripts/Start-CubaseEmptyBackground.ps1'), 'utf8');
    assert.match(launcher, /Invoke-CimMethod -ClassName Win32_Process -MethodName Create/);
    assert.match(launcher, /CreateFlags=\[uint32\]0x01000008/);
    assert.match(launcher, /start-empty-holder\.cjs/);
    assert.match(launcher, /CubaseDesktop\]::StartEmpty/);
    assert.doesNotMatch(launcher, /StartDetachedHolder/);
});

test('lifecycle tools use the explicit initializer and one new-host handshake without Save replay', async () => {
    const originalRun = lifecycle.runLifecycle, originalRequest = MidiClient.prototype.request;
    const calls = [];
    lifecycle.runLifecycle = async (action, args) => {
        calls.push({ action, args });
        return { ok: true, action, owned: true, managedProject: { projectPath: args.projectPath } };
    };
    MidiClient.prototype.request = async function (op) {
        calls.push({ op });
        assert.equal(op, 'bridge.status');
        return { session: 'new-runtime', active: true, appVersion: '16.0.5', bridgeRevision: EXPECTED_BRIDGE_REVISION };
    };
    const runtime = createServer(), client = new Client({ name: 'lifecycle-contract', version: '1' });
    const [left, right] = InMemoryTransport.createLinkedPair();
    const body = response => JSON.parse(response.content.find(p => p.type === 'text').text);
    try {
        await Promise.all([runtime.server.connect(right), client.connect(left)]);
        assert.equal((await client.listTools()).tools.length, 53);
        const status = body(await client.callTool({ name: 'cubase_runtime_status', arguments: {} }));
        assert.equal(status.ok, true);
        assert.deepEqual(calls, [{ action: 'status', args: {} }]); calls.length = 0;
        const args = { projectPath: 'E:\\Projects\\New\\Song.cpr', replaceCurrent: true, confirmDiscardChanges: true };
        const created = body(await client.callTool({ name: 'cubase_project_create', arguments: args }));
        assert.equal(created.data.host.session, 'new-runtime');
        assert.deepEqual(calls, [{ action: 'create', args }, { op: 'bridge.status' }]); calls.length = 0;
        const opened = body(await client.callTool({ name: 'cubase_project_open', arguments: args }));
        assert.equal(opened.data.host.session, 'new-runtime');
        assert.deepEqual(calls, [{ action: 'open', args }, { op: 'bridge.status' }]); calls.length = 0;
        const asArgs = { session: 'new-runtime', projectPath: 'E:\\Projects\\New\\Other.cpr', confirmSaveAs: true };
        const saved = body(await client.callTool({ name: 'cubase_project_save_as', arguments: asArgs }));
        assert.equal(saved.data.host.session, 'new-runtime');
        assert.deepEqual(calls, [{ op: 'bridge.status' }, { action: 'save_as', args: asArgs }, { op: 'bridge.status' }]); calls.length = 0;
        const stopped = body(await client.callTool({ name: 'cubase_runtime_stop', arguments: { confirmDiscardChanges: true } }));
        assert.equal(stopped.ok, true);
        assert.deepEqual(calls, [{ action: 'stop', args: { confirmDiscardChanges: true } }]);
    } finally {
        await client.close(); await runtime.server.close(); runtime.close();
        lifecycle.runLifecycle = originalRun; MidiClient.prototype.request = originalRequest;
    }
});
