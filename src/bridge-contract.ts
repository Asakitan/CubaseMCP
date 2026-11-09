import { BridgeError } from './midi.js';

export const EXPECTED_BRIDGE_REVISION = '2026-11-10-coverage-3.10';

export function inspectBridge(status: unknown) {
    const host = status && typeof status === 'object' ? status as Record<string, unknown> : {};
    const hostVersionMatches = typeof host.appVersion === 'string' && /^16(?:\.|$)/.test(host.appVersion);
    const upgradeRequired = host.bridgeRevision !== EXPECTED_BRIDGE_REVISION;
    const active = host.active === true;
    const hasSession = typeof host.session === 'string' && host.session.length > 0;
    return {
        expectedBridgeRevision: EXPECTED_BRIDGE_REVISION,
        observedBridgeRevision: host.bridgeRevision ?? null,
        hostVersionMatches,
        upgradeRequired,
        active,
        hasSession,
        readyForOperations: hostVersionMatches && !upgradeRequired && active && hasSession
    };
}

export function verifyBridge(status: unknown, session: unknown): void {
    const host = status && typeof status === 'object' ? status as Record<string, unknown> : {};
    const compatibility = inspectBridge(host);
    if (!compatibility.hostVersionMatches) {
        throw new BridgeError('HOST_VERSION_MISMATCH', 'Only a live Cubase 16 host is accepted.', 'not_started');
    }
    if (compatibility.upgradeRequired) {
        throw new BridgeError('BRIDGE_UPGRADE_REQUIRED',
            'The active Cubase MIDI Remote script does not match the required bridge revision.',
            'not_started', { expected: EXPECTED_BRIDGE_REVISION, observed: host.bridgeRevision ?? null });
    }
    if (!compatibility.active || !compatibility.hasSession) {
        throw new BridgeError('BRIDGE_INACTIVE', 'The required Cubase mapping is not active.', 'not_started');
    }
    if (host.session !== session) {
        throw new BridgeError('STALE_SESSION', 'The active Cubase mapping changed; obtain a new session.', 'not_started');
    }
}
