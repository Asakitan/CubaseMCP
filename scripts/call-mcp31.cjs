'use strict';

// Developer acceptance client, not an MCP backend. One requested tool call; no mutation retry.
// Usage: node scripts/call-mcp31.cjs cubase_TOOL '{"arguments":"..."}' E:\absolute\new-evidence.jsonl
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/client');
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');

async function main() {
    const [name, json, evidencePath] = process.argv.slice(2);
    if (!/^cubase_[a-z_]+$/.test(name || '') || !json || !evidencePath || !path.isAbsolute(evidencePath)) {
        throw new Error('Expected a Cubase MCP tool, JSON arguments and a new absolute evidence path.');
    }
    const args = JSON.parse(json);
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Arguments must be an object.');
    const handle = fs.openSync(evidencePath, 'wx');
    const record = value => { fs.writeSync(handle, JSON.stringify({ utc: new Date().toISOString(), ...value }) + '\n'); fs.fsyncSync(handle); };
    const root = path.resolve(__dirname, '..');
    const client = new Client({ name: 'native-acceptance31', version: '1' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dist/src/server.js')],
        env: { ...process.env, CUBASE_MCP_CONFIG: path.join(root, 'cubase.config.json') }, stderr: 'pipe' });
    transport.stderr.on('data', data => process.stderr.write(data));
    const body = reply => reply.structuredContent ?? JSON.parse(reply.content.find(item => item.type === 'text').text);
    try {
        record({ stage: 'connect', tool: name });
        await client.connect(transport);
        const tool = (await client.listTools()).tools.find(item => item.name === name);
        if (!tool) throw new Error('Tool is not exposed: ' + name);
        if (tool.inputSchema.properties?.session && args.session === undefined) {
            const status = body(await client.callTool({ name: 'cubase_status', arguments: {} }));
            record({ stage: 'session', result: status });
            if (!status.ok) throw new Error('Host session was not admitted.');
            args.session = status.data.session;
        }
        record({ stage: 'submit_once', tool: name, arguments: args });
        const reply = body(await client.callTool({ name, arguments: args }, { timeout: Math.min(600000, Number(args.timeoutMs) || 180000) + 60000 }));
        record({ stage: 'result', result: reply });
        process.stdout.write(JSON.stringify(reply, null, 2) + '\n');
        if (!reply.ok) process.exitCode = 1;
    } catch (error) {
        record({ stage: 'client_error', error: String(error), noReplay: true });
        throw error;
    } finally {
        await client.close();
        fs.closeSync(handle);
    }
}

main().catch(error => { process.stderr.write(String(error) + '\n'); process.exitCode = 1; });