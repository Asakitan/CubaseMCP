import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { MidiClient, BridgeError } from './midi.js';
import { inspectBridge, verifyBridge } from './bridge-contract.js';

async function main() {
    const argumentsList = process.argv.slice(2);
    if (argumentsList.some(argument => argument !== '--live')) throw new Error('Usage: npm run doctor -- [--live]');
    const config = loadConfig();
    const ports = MidiClient.ports();
    const inputMatches = ports.inputs.filter(name => name === config.midi.input).length;
    const outputMatches = ports.outputs.filter(name => name === config.midi.output).length;
    const executables = existsSync(config.target.installationDirectory)
        ? readdirSync(config.target.installationDirectory).filter(name => /^Cubase.*\.exe$/i.test(name))
        : [];
    const report: Record<string, unknown> = {
        target: config.target,
        policy: config.policy,
        installation: { found: executables.length > 0, executables: executables.map(name => join(config.target.installationDirectory, name)) },
        midi: { configured: config.midi, available: ports, exactInputMatches: inputMatches, exactOutputMatches: outputMatches },
        readyForHandshake: executables.length > 0 && inputMatches === 1 && outputMatches === 1,
        readyForOperations: false,
        liveVerification: 'not_requested',
        nextAction: inputMatches === 1 && outputMatches === 1
            ? 'Run npm run doctor -- --live while Cubase has the installed MIDI Remote driver active.'
            : 'Provide the two configured virtual MIDI ports, then activate the installed Cubase MIDI Remote driver. No alternative route will be used.'
    };
    if (argumentsList.includes('--live')) {
        const client = new MidiClient(config.midi);
        try {
            const host = await client.request('bridge.status', {}) as Record<string, unknown>;
            const compatibility = inspectBridge(host);
            report.host = { ...host, serverCompatibility: compatibility };
            report.readyForOperations = compatibility.readyForOperations;
            verifyBridge(host, host.session);
            report.liveVerification = 'handshake_received';
            report.nextAction = 'The required bridge is active. Use its current session and discover targets before requesting operations.';
        } catch (error) {
            report.liveVerification = 'failed';
            report.error = error instanceof BridgeError
                ? { code: error.code, message: error.message, execution: error.execution }
                : { code: 'HANDSHAKE_FAILED', message: error instanceof Error ? error.message : String(error) };
            report.nextAction = error instanceof BridgeError && error.code === 'BRIDGE_UPGRADE_REQUIRED'
                ? 'The installed controller must become active before host operations are admitted. No older-controller execution is permitted.'
                : 'Resolve the reported connection or active-host error before requesting operations.';
            process.exitCode = 2;
        } finally {
            client.close();
        }
    } else if (!report.readyForHandshake) {
        process.exitCode = 2;
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

void main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
