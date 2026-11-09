'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const args = process.argv.slice(2);
let output;
for (let index = 0; index < args.length; index++) {
    if (args[index] === '--output' && args[index + 1]) output = path.resolve(args[++index]);
    else throw new Error('Usage: node scripts/inspect-cubase-ipc.cjs [--output PATH]');
}
if (output && fs.existsSync(output)) throw new Error('Refusing to overwrite: ' + output);

const installation = 'C:\\Program Files\\Steinberg\\Cubase 16';
const candidates = [
    'Cubase 16.exe', 'Components/hostchannelaccess.dll', 'Components/projectplugin.dll',
    'Components/linkservice.dll', 'Components/mediaservice.dll', 'Components/hubservice.dll',
    'Components/euconadapter.dll', 'Components/araservice.dll', 'Components/vstconnect.dll',
    'Components/vstscannermaster.exe'
];
const ipcImport = /^(Rpc|Ndr|CoCreate|CoGet|CoRegister|RegisterActiveObject|GetActiveObject|CreateNamedPipe|ConnectNamedPipe|WaitNamedPipe|CallNamedPipe|CreateFileMapping|OpenFileMapping|MapViewOfFile|SendMessage|PostMessage|WSA|socket$|bind$|listen$|accept$|connect$|send$|recv$)|WinHttp|WebSocket/i;
const protocolString = /\\pipe\\|ncacn_|ncalrpc|grpc|protobuf|jsonrpc|websocket|RpcServer|RpcClient|CreateNamedPipe|WaitNamedPipe|OpenFileMapping|CreateFileMapping|WM_COPYDATA|IProject|ITrack|IMidi|IDocument|IDispatch|RemoteService|MessageChannel/i;

function inspectBinary(relativePath) {
    const filename = path.join(installation, relativePath);
    if (!fs.existsSync(filename)) return { path: filename, exists: false };
    const stat = fs.statSync(filename);
    const descriptor = fs.openSync(filename, 'r');
    function read(offset, size) {
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 ||
            offset + size > stat.size || size > 1024 * 1024) throw new Error('PE read out of bounds');
        const data = Buffer.alloc(size);
        if (fs.readSync(descriptor, data, 0, size, offset) !== size) throw new Error('Short PE read');
        return data;
    }
    try {
        const dos = read(0, 64);
        if (dos.toString('ascii', 0, 2) !== 'MZ') throw new Error('Not a PE file');
        const headerOffset = dos.readUInt32LE(60);
        const header = read(headerOffset, 24);
        if (header.readUInt32LE(0) !== 0x4550) throw new Error('Invalid PE signature');
        const sectionCount = header.readUInt16LE(6);
        const optionalSize = header.readUInt16LE(20);
        const optional = read(headerOffset + 24, optionalSize);
        const magic = optional.readUInt16LE(0);
        if (magic !== 0x20b && magic !== 0x10b) throw new Error('Unsupported PE optional header');
        if (sectionCount > 96) throw new Error('Too many PE sections');
        const directoryOffset = magic === 0x20b ? 112 : 96;
        const directoryCount = optional.readUInt32LE(directoryOffset - 4);
        const sections = [];
        for (let index = 0; index < sectionCount; index++) {
            const section = read(headerOffset + 24 + optionalSize + index * 40, 40);
            sections.push({ name: section.toString('ascii', 0, 8).replace(/\0.*$/, ''),
                rva: section.readUInt32LE(12), rawSize: section.readUInt32LE(16),
                rawOffset: section.readUInt32LE(20), characteristics: section.readUInt32LE(36) });
        }
        function fileOffset(rva) {
            if (rva < optional.readUInt32LE(60)) return rva;
            const section = sections.find(item => rva >= item.rva && rva - item.rva < item.rawSize);
            if (!section) throw new Error('RVA has no file-backed section: ' + rva.toString(16));
            return section.rawOffset + rva - section.rva;
        }
        function cstring(rva) {
            const offset = fileOffset(rva);
            const data = read(offset, Math.min(512, stat.size - offset));
            const end = data.indexOf(0);
            if (end < 0) throw new Error('Unterminated PE name');
            return data.toString('ascii', 0, end);
        }
        function directory(index) {
            if (index >= directoryCount || directoryOffset + index * 8 + 8 > optional.length) return { rva: 0, size: 0 };
            return { rva: optional.readUInt32LE(directoryOffset + index * 8),
                size: optional.readUInt32LE(directoryOffset + index * 8 + 4) };
        }
        const imports = [];
        const importedIpcFunctions = [];
        const importDirectory = directory(1);
        if (importDirectory.rva) {
            const start = fileOffset(importDirectory.rva);
            for (let index = 0; index < Math.min(256, Math.floor(importDirectory.size / 20)); index++) {
                const entry = read(start + index * 20, 20);
                const nameRva = entry.readUInt32LE(12);
                if (!nameRva) break;
                const moduleName = cstring(nameRva);
                imports.push(moduleName);
                const thunkRva = entry.readUInt32LE(0) || entry.readUInt32LE(16);
                const stride = magic === 0x20b ? 8 : 4;
                for (let thunkIndex = 0; thunkIndex < 8192 && thunkRva; thunkIndex++) {
                    const thunk = read(fileOffset(thunkRva + thunkIndex * stride), stride);
                    const address = stride === 8 ? thunk.readBigUInt64LE() : BigInt(thunk.readUInt32LE());
                    if (address === 0n) break;
                    if ((address & (1n << BigInt(stride * 8 - 1))) !== 0n) continue;
                    if (address > 0xffffffffn) throw new Error('Invalid import name RVA');
                    const name = cstring(Number(address) + 2);
                    if (ipcImport.test(name)) importedIpcFunctions.push({ module: moduleName, name });
                }
            }
        }
        const exportedNames = [];
        const exportDirectory = directory(0);
        let exportNameCount = 0;
        if (exportDirectory.rva) {
            const entry = read(fileOffset(exportDirectory.rva), 40);
            exportNameCount = entry.readUInt32LE(24);
            const namesRva = entry.readUInt32LE(32);
            for (let index = 0; index < Math.min(128, exportNameCount); index++) {
                exportedNames.push(cstring(read(fileOffset(namesRva + index * 4), 4).readUInt32LE()));
            }
        }
        const stringHits = [];
        for (const section of sections) {
            if ((section.characteristics & 0x40) === 0 || !section.rawSize) continue;
            for (let position = 0; position < section.rawSize && stringHits.length < 80; position += 1024 * 1024 - 1024) {
                const length = Math.min(1024 * 1024, section.rawSize - position);
                const data = read(section.rawOffset + position, length);
                for (const [encoding, expression] of [
                    ['ascii', /[\x20-\x7e]{6,512}/g],
                    ['utf16le', /(?:[\x20-\x7e]\x00){6,512}/g]
                ]) {
                    const raw = data.toString('latin1');
                    for (const match of raw.matchAll(expression)) {
                        const value = encoding === 'ascii' ? match[0] : Buffer.from(match[0], 'latin1').toString('utf16le');
                        if (!protocolString.test(value) || stringHits.some(hit => hit.value === value)) continue;
                        stringHits.push({ encoding, fileOffset: '0x' + (section.rawOffset + position + match.index).toString(16),
                            rva: '0x' + (section.rva + position + match.index).toString(16), value });
                        if (stringHits.length >= 80) break;
                    }
                }
            }
        }
        return { path: filename, exists: true, bytes: stat.size, modifiedUtc: stat.mtime.toISOString(),
            machine: '0x' + header.readUInt16LE(4).toString(16), imports, importedIpcFunctions,
            exportNameCount, exportedNames, exportsTruncated: exportNameCount > exportedNames.length,
            protocolStringCandidates: stringHits, stringsLimitReached: stringHits.length >= 80,
            scope: 'Normal PE imports, named exports and selected file-backed initialized-data strings; not proof of a callable automation endpoint.' };
    } finally { fs.closeSync(descriptor); }
}

const liveScript = String.raw`
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$processes = @(Get-CimInstance Win32_Process -Filter "Name = 'Cubase 16.exe' OR Name = 'VSTAudioEngine.exe' OR Name = 'VSTscannermaster.exe' OR Name = 'SteinbergMediaBay.exe'")
$processIds = @($processes | ForEach-Object { [int]$_.ProcessId })
$errors = @()
$tcp = @()
$udp = @()
try { $tcp = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.OwningProcess -in $processIds } | Select-Object OwningProcess, LocalAddress, LocalPort) } catch { $errors += $_.Exception.Message }
try { $udp = @(Get-NetUDPEndpoint -ErrorAction Stop | Where-Object { $_.OwningProcess -in $processIds } | Select-Object OwningProcess, LocalAddress, LocalPort) } catch { $errors += $_.Exception.Message }
$pipes = @()
try { $pipes = @(Get-ChildItem -LiteralPath '\\.\pipe\' -ErrorAction Stop | Where-Object { $_.Name -match 'Cubase|Steinberg|VST|MediaBay|SMTG' } | Select-Object -ExpandProperty Name) } catch { $errors += $_.Exception.Message }
$modules = @()
foreach ($item in $processes) {
    try { $modules += @((Get-Process -Id $item.ProcessId -ErrorAction Stop).Modules | Where-Object { $_.FileName -like 'C:\Program Files\Steinberg\*' } | Select-Object @{Name='ProcessId';Expression={$item.ProcessId}}, ModuleName, FileName, ModuleMemorySize) } catch { $errors += $_.Exception.Message }
}
[pscustomobject]@{ processes = @($processes | Select-Object Name, ProcessId, ParentProcessId, ExecutablePath); tcpListeners = $tcp; udpBindings = $udp; namedPipeNameCandidates = $pipes; pipeOwnershipVerified = $false; steinbergModules = $modules; errors = $errors } | ConvertTo-Json -Depth 5 -Compress
`;

const live = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(liveScript, 'utf16le').toString('base64')], {
    encoding: 'utf8', windowsHide: true, timeout: 45000, maxBuffer: 4 * 1024 * 1024
});
let runtime;
if (live.error || live.status !== 0) {
    runtime = { error: String(live.error || live.stderr || 'Process exited: ' + live.status) };
} else {
    try { runtime = JSON.parse(live.stdout.replace(/^\uFEFF/, '').trim()); }
    catch (error) { runtime = { error: 'Invalid runtime JSON: ' + error.message }; }
}
const report = { timestamp: new Date().toISOString(), installation, policy: {
    readOnly: true, endpointRequestsSent: false, processInjection: false, processMemoryWritten: false,
    processSuspension: false, foregroundAutomation: false, backendChanged: false
}, runtime, binaries: candidates.map(candidate => {
    try { return inspectBinary(candidate); }
    catch (error) { return { path: path.join(installation, candidate), error: error.message }; }
}) };
const json = JSON.stringify(report, null, 2) + '\n';
if (output) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, json, { flag: 'wx' });
    process.stdout.write(JSON.stringify({ report: output, processes: runtime.processes || [],
        tcpListeners: runtime.tcpListeners || [], udpBindings: runtime.udpBindings || [],
        namedPipeNameCandidates: runtime.namedPipeNameCandidates || [],
        binaryCount: report.binaries.length,
        errors: [runtime.error, ...(runtime.errors || []), ...report.binaries.map(item => item.error)].filter(Boolean) }, null, 2) + '\n');
} else process.stdout.write(json);
if (runtime.error || report.binaries.some(item => item.error)) process.exitCode = 1;