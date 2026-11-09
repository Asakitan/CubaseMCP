import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

export const configSchema = z.object({
    backend: z.literal('midi'),
    policy: z.object({
        backgroundOnly: z.literal(true),
        fallback: z.literal(false),
        automaticRetry: z.literal(false)
    }).strict(),
    target: z.object({
        majorVersion: z.literal(16),
        edition: z.literal('AI'),
        installationDirectory: z.string().min(1),
        installerDirectory: z.string().min(1)
    }).strict(),
    midi: z.object({
        input: z.string().min(1),
        output: z.string().min(1),
        timeoutMs: z.number().int().min(500).max(60000)
    }).strict()
}).strict().refine(value => value.midi.input !== value.midi.output, {
    message: 'The two directional MIDI ports must have different names.'
});

export type Configuration = z.infer<typeof configSchema>;

export function loadConfig(
    path = process.env.CUBASE_MCP_CONFIG ?? resolve(__dirname, '../../cubase.config.json'),
    environment: NodeJS.ProcessEnv = process.env
): Configuration {
    if (environment.CUBASE_ADAPTER && environment.CUBASE_ADAPTER !== 'midi') {
        throw new Error('Only CUBASE_ADAPTER=midi is permitted. No fallback backend exists.');
    }
    const config = configSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    return configSchema.parse({
        ...config,
        midi: {
            ...config.midi,
            input: environment.CUBASE_MIDI_INPUT ?? config.midi.input,
            output: environment.CUBASE_MIDI_OUTPUT ?? config.midi.output
        }
    });
}