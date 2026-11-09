'use strict';

const midi = require('@julusian/midi/lazy');
const input = new midi.Input();
const wanted = process.argv[2];
let index = -1;
for (let i = 0; i < input.getPortCount(); i++) {
    if (input.getPortName(i) === wanted) index = i;
}
if (index < 0) throw new Error('The temporary MIDI input was not enumerated.');
input.openPort(index);
process.stdout.write('open\n');
process.stdin.resume();
process.stdin.on('end', () => {
    input.closePort();
    input.destroy();
});
