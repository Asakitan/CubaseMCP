#!/usr/bin/env node
import { resolve } from 'node:path';
import { loadConfig } from './config.js';
import { cleanupTempFiles, DEFAULT_KEEP_RECENT_LIFECYCLE } from './cleanup.js';

const HOUR_MS = 60 * 60 * 1000;
const USAGE = 'Usage: npm run cleanup:temp -- [--dry-run] [--verbose] [--root DIR] [--retention-hours N] [--scratch-retention-hours N] [--keep-recent N]';

function hours(name: string, value: string): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 720) throw new Error(`${name} must be a number of hours from 1 to 720. ${USAGE}`);
    return parsed;
}

async function main(): Promise<void> {
    const argumentsList = process.argv.slice(2);
    let dryRun = false, verbose = false, root: string | undefined;
    let retentionHours: number | undefined, scratchRetentionHours: number | undefined, keepRecent: number | undefined;
    for (let index = 0; index < argumentsList.length; index += 1) {
        const argument = argumentsList[index];
        const value = (): string => {
            const next = argumentsList[index + 1];
            if (next === undefined) throw new Error(`${argument} needs a value. ${USAGE}`);
            index += 1;
            return next;
        };
        if (argument === '--dry-run') dryRun = true;
        else if (argument === '--verbose') verbose = true;
        else if (argument === '--root') root = resolve(value());
        else if (argument === '--retention-hours') retentionHours = hours(argument, value());
        else if (argument === '--scratch-retention-hours') scratchRetentionHours = hours(argument, value());
        else if (argument === '--keep-recent') {
            const parsed = Number(value());
            if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10000) throw new Error(`--keep-recent must be an integer from 0 to 10000. ${USAGE}`);
            keepRecent = parsed;
        } else throw new Error(`Unknown argument ${argument}. ${USAGE}`);
    }

    const cleanup = loadConfig().cleanup;
    const retention = retentionHours ?? cleanup.retentionHours;
    const scratchRetention = scratchRetentionHours ?? cleanup.scratchRetentionHours;
    const result = await cleanupTempFiles({
        root,
        retentionMs: retention * HOUR_MS,
        scratchRetentionMs: scratchRetention * HOUR_MS,
        keepRecentLifecycle: keepRecent ?? DEFAULT_KEEP_RECENT_LIFECYCLE,
        dryRun
    });
    const report: Record<string, unknown> = {
        root: result.root,
        artifacts: result.artifacts,
        dryRun: result.dryRun,
        retentionHours: result.retentionHours,
        scratchRetentionHours: result.scratchRetentionHours,
        scanned: result.scanned,
        matched: result.matched,
        removed: result.removed,
        failed: result.failed,
        skipped: result.skipped,
        bytesMatched: result.bytesMatched,
        bytesFreed: result.bytesFreed,
        errors: result.errors,
        nextAction: result.failed
            ? 'Close the process that holds a matching entry and run the command again; the background pass retries on its next hour.'
            : result.dryRun && result.matched
                ? 'Run the same command without --dry-run to remove the matched entries.'
                : 'No temporary output older than the retention window remains.'
    };
    if (verbose) report.removals = result.removals;
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (result.failed) process.exitCode = 2;
}

void main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
