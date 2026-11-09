'use strict';

// Diagnostic port enumeration only; this does not open a MIDI port.
const INPUT = 'CubaseAI Binding26 To Cubase';
const OUTPUT = 'CubaseAI Binding26 From Cubase';

function list(port) {
    const result = [];
    for (let index = 0; index < port.getPortCount(); index++) result.push(port.getPortName(index));
    return result;
}

function inspect() {
    const midi = require('@julusian/midi/lazy');
    let input, output;
    try {
        input = new midi.Input();
        output = new midi.Output();
        const inputs = list(input), outputs = list(output);
        return { inputName: INPUT, outputName: OUTPUT,
            inputMatches: inputs.filter(name => name === INPUT).length,
            outputMatches: outputs.filter(name => name === OUTPUT).length,
            reverseInputMatches: inputs.filter(name => name === OUTPUT).length,
            reverseOutputMatches: outputs.filter(name => name === INPUT).length };
    } finally {
        if (input) input.destroy();
        if (output) output.destroy();
    }
}

try {
    if (process.argv.length !== 2) throw new Error('This fixed diagnostic does not accept arguments.');
    process.stdout.write(JSON.stringify(inspect()) + '\n');
} catch (error) {
    process.stderr.write(String(error.message || error) + '\n');
    process.exitCode = 1;
}
