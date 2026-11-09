'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('Cubase script entry runs as a top-level script without a CommonJS module', () => {
    const api = {};
    const driver = {};
    const logger = { log() {} };
    const calls = [];
    const context = {
        console: logger,
        require(name) {
            calls.push(name);
            if (name === 'midiremote_api_v1') return api;
            if (name === './controller') return { createController(value, receivedLogger) {
                assert.equal(value, api);
                assert.equal(receivedLogger, logger);
                return { deviceDriver: driver };
            } };
            throw new Error('Unexpected import: ' + name);
        }
    };
    const source = fs.readFileSync(path.join(__dirname, '../remote/CubaseAI_MCP.js'), 'utf8');
    vm.runInNewContext(source, context, { filename: 'CubaseAI_MCP.js' });
    assert.equal(context.deviceDriver, driver);
    assert.deepEqual(calls, ['midiremote_api_v1', './controller']);
});
