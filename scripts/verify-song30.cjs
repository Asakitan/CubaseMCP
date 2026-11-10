'use strict';

// Session-30 live acceptance: build a small song in the owned private-desktop instance using
// only the real stdio MCP server, read every step back from Cubase, save, reopen in a fresh
// process and read the song again. Nothing is retried and no window is touched.
// Usage (from a PowerShell-started process): node scripts/verify-song30.cjs <label>
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/client');
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');

const root = path.resolve(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function buildSong() {
    const progression = [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]], bars = 8;
    const piano = [], bass = [], lead = [], drums = [];
    for (let bar = 0; bar < bars; bar++) {
        const chord = progression[bar % 4], start = bar * 4;
        chord.forEach(pitch => piano.push({ pitch, start, duration: 3.75, velocity: 84 }));
        [0, 1.5, 2, 3].forEach((offset, index) => bass.push({ pitch: chord[0] - 24, start: start + offset, duration: index === 1 ? 0.5 : 0.75, velocity: 104 }));
        [0, 1, 2, 2.5, 3].forEach((offset, index) => lead.push({ pitch: chord[index % 3] + 12 + (index === 3 ? 2 : 0), start: start + offset, duration: offset === 2 ? 0.5 : 0.9, velocity: 96 - index * 4 }));
        for (let step = 0; step < 8; step++) drums.push({ pitch: 42, start: start + step * 0.5, duration: 0.25, velocity: step % 2 ? 70 : 92 });
        [0, 2].forEach(offset => drums.push({ pitch: 36, start: start + offset, duration: 0.25, velocity: 112 }));
        [1, 3].forEach(offset => drums.push({ pitch: 38, start: start + offset, duration: 0.25, velocity: 104 }));
    }
    return { tracks: [
        { name: 'Piano', channel: 0, program: 0, notes: piano },
        { name: 'Bass', channel: 1, program: 33, notes: bass, controlChanges: [{ controller: 7, value: 110, beat: 0 }] },
        { name: 'Lead', channel: 2, program: 80, notes: lead, pitchBends: [{ value: 0, beat: 0 }] },
        { name: 'Drums', channel: 9, notes: drums }
    ] };
}

const noteKey = note => `${note.pitch}@${note.start}+${note.duration}v${note.velocity}`;
const expectedByTrack = song => Object.fromEntries(song.tracks.map(track => [track.name, track.notes.map(note => noteKey({ ...note, velocity: note.velocity ?? 100 })).sort()]));

async function main() {
    const label = process.argv[2];
    if (!label || !/^[a-z0-9-]+$/.test(label)) throw new Error('usage: verify-song30.cjs <label>');
    const directory = path.join(root, 'artifacts', 'managed-projects', 'session-30', `song-${label}`);
    const projectPath = path.join(directory, 'Song.cpr');
    const evidencePath = path.join(root, 'artifacts', 'ipc', `song30-live-${label}.json`);
    if (fs.existsSync(projectPath) || fs.existsSync(evidencePath)) throw new Error('label already used: ' + label);
    const evidence = { label, projectPath, startedUtc: new Date().toISOString(), steps: [], checks: [] };
    const client = new Client({ name: 'song30-live', version: '0.1.0' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dist/src/server.js')],
        env: { ...process.env, CUBASE_MCP_CONFIG: path.join(root, 'cubase.config.json') }, stderr: 'pipe' });
    transport.stderr.on('data', data => process.stderr.write(data));
    let session = null;
    async function call(name, args = {}) {
        const sessionless = /^cubase_(status|runtime_|project_(create|open)|connection_reset)/.test(name);
        const response = await client.callTool({ name, arguments: sessionless ? args : { session, ...args } });
        const body = JSON.parse(response.content.find(item => item.type === 'text').text);
        if (!body.ok) throw new Error(`${name}: ${body.error.code} ${body.error.message} ${JSON.stringify(body.error.details || {}).slice(0, 400)}`);
        if (body.data && typeof body.data.session === 'string') session = body.data.session;
        if (body.data && body.data.host && typeof body.data.host.session === 'string') session = body.data.host.session;
        if (body.data && body.data.save && typeof body.data.save.session === 'string') session = body.data.save.session;
        return body.data;
    }
    const step = (name, detail) => { evidence.steps.push({ at: new Date().toISOString(), name, ...detail }); process.stdout.write(`- ${name}: ${JSON.stringify(detail).slice(0, 300)}\n`); };
    const check = (name, passed, detail) => {
        evidence.checks.push({ name, passed: !!passed, detail });
        process.stdout.write(`${passed ? 'PASS' : 'FAIL'} ${name}${passed ? '' : ' ' + JSON.stringify(detail).slice(0, 600)}\n`);
    };
    const channels = async () => (await call('cubase_channels_list', {})).items;
    const find = async title => { const item = (await channels()).find(channel => channel.title === title); if (!item) throw new Error('channel missing: ' + title); return item; };
    const setField = async (title, field, value) => {
        const item = await find(title);
        return call('cubase_channel_set', { objectId: item.objectId, expectedUniqueId: item.uniqueIdString, field, value });
    };
    async function readAll() {
        const first = await call('cubase_midi_read', { noteLimit: 2000, includeControllers: true });
        const byTrack = {};
        for (const track of first.tracks) if (track.name !== null && track.noteCount) byTrack[track.name] = first.notes.filter(note => note.track === track.index).map(noteKey).sort();
        return { read: first, byTrack };
    }
    const command = async key => { const result = await call('cubase_command_execute', { key, confirmCurrentSelection: true, settleMs: 1500 }); await sleep(350); return result.bindingObserved; };
    const windows = async () => (await call('cubase_runtime_windows')).unexpected.map(item => item.title);

    try {
        await client.connect(transport);
        const created = await call('cubase_project_create', { projectPath, replaceCurrent: true, confirmDiscardChanges: true });
        step('project created', { bytes: fs.statSync(projectPath).size, session, revision: created.host.bridgeRevision, activation: created.host.activation });
        check('main page finished activating', created.host.activation && created.host.activation.surfaceInput !== 'stalled', created.host.activation);

        // Tempo and time signature
        await call('cubase_tempo_set', { bpm: 104 });
        const waltz = await call('cubase_transport_set', { field: 'signature', value: '3/4' });
        const common = await call('cubase_transport_set', { field: 'signature', value: '4/4' });
        await sleep(300);
        const transportState = await call('cubase_transport_state', {});
        check('tempo 104 observed', transportState.tempo && Math.abs(transportState.tempo.bpm - 104) < 0.001, transportState.tempo);
        check('time signature written and restored', waltz.after.signature === '3/4' && common.after.signature === '4/4' && transportState.signature === '4/4',
            [waltz.after.signature, common.after.signature, transportState.signature]);

        // Notes
        const song = buildSong(), expected = expectedByTrack(song);
        const imported = await call('cubase_midi_import', { song, confirmImport: true });
        step('midi imported', { file: imported.source.path, bytes: imported.source.bytes, native: imported.native && imported.native.stage, added: imported.channels.added.map(item => `${item.typeName}:${item.title}`) });
        check('import added one MIDI channel per song track', ['Piano', 'Bass', 'Lead', 'Drums'].every(name => imported.channels.added.some(item => item.typeName === 'MidiChannel' && item.title === name)) &&
            imported.channels.added.filter(item => item.typeName === 'MidiChannel').length === 4, imported.channels.added);
        let content = await readAll();
        check('Cubase returns exactly the imported notes', JSON.stringify(content.byTrack) === JSON.stringify(expected),
            { expected: Object.fromEntries(Object.entries(expected).map(([name, notes]) => [name, notes.length])), actual: Object.fromEntries(Object.entries(content.byTrack).map(([name, notes]) => [name, notes.length])) });
        check('programs and controller data survive', [0, 33, 80].every(program => content.read.tracks.some(track => track.programs.some(item => item.program === program))) &&
            content.read.controlChanges.some(change => change.controller === 7 && change.value === 110), { programs: content.read.tracks.map(track => track.programs), cc: content.read.controlChanges.length });
        check('written tempo is the project tempo', content.read.tempos.length === 1 && Math.abs(content.read.tempos[0].bpm - 104) < 0.01, content.read.tempos);

        // Event editing on one track: transpose the bass up one octave with twelve semitone steps
        await setField('Bass', 'selected', true);
        await sleep(250);
        const selectedEvents = await command('edit.selectAllOnTracks');
        let transposed = 0;
        for (let count = 0; count < 12; count++) if (await command('edit.transposeUp')) transposed++;
        content = await readAll();
        const octaveUp = song.tracks[1].notes.map(note => noteKey({ ...note, pitch: note.pitch + 12 })).sort();
        check('bass transposed one octave, other tracks untouched', selectedEvents && transposed === 12 && JSON.stringify(content.byTrack.Bass) === JSON.stringify(octaveUp) &&
            JSON.stringify(content.byTrack.Piano) === JSON.stringify(expected.Piano) && JSON.stringify(content.byTrack.Drums) === JSON.stringify(expected.Drums), { transposed, bass: content.byTrack.Bass && content.byTrack.Bass.slice(0, 3) });
        const legato = await command('midi.legato');
        content = await readAll();
        const bassDuration = notes => notes.reduce((total, key) => total + Number(/\+([\d.]+)v/.exec(key)[1]), 0);
        check('legato lengthened the selected bass notes', legato && bassDuration(content.byTrack.Bass) > bassDuration(octaveUp) + 1, { before: bassDuration(octaveUp), after: bassDuration(content.byTrack.Bass) });
        const expectedBass = content.byTrack.Bass;

        // Mixer and names
        const renamed = await setField('Lead', 'name', 'Lead Synth');
        const synth = (await channels()).find(channel => channel.typeName === 'Synth');
        const volume = await call('cubase_channel_set', { objectId: synth.objectId, expectedUniqueId: synth.uniqueIdString, field: 'volume', value: '-3' });
        const pan = await call('cubase_channel_set', { objectId: synth.objectId, expectedUniqueId: synth.uniqueIdString, field: 'pan', value: 0.4 });
        await setField('Drums', 'mute', true);
        await sleep(200);
        const mutedRead = await call('cubase_midi_read', { noteLimit: 0 });
        await setField('Drums', 'mute', false);
        await sleep(200);
        let list = await channels();
        check('rename, volume and pan are reported by the host', renamed.after.display === 'Lead Synth' && list.some(channel => channel.title === 'Lead Synth') &&
            volume.after.display === '-3.00' && Math.abs(pan.after.value - 0.4) < 0.01, { name: renamed.after.display, volume: volume.after.display, pan: pan.after });
        check('a muted track is left out of the written file and reported as muted', !mutedRead.tracks.some(track => track.name === 'Drums' && track.noteCount) &&
            mutedRead.mutedChannels.some(item => item.title === 'Drums'), { tracks: mutedRead.tracks.map(track => track.name), muted: mutedRead.mutedChannels.map(item => item.title) });

        // Track structure
        const lead = await find('Lead Synth');
        const duplicated = await call('cubase_track_edit', { objectId: lead.objectId, expectedUniqueId: lead.uniqueIdString, action: 'duplicate', confirmEdit: true });
        check('duplicate added one channel and opened no window', duplicated.added.length === 1 && duplicated.sequenceCompleted && !duplicated.windows.unexpected.length, { added: duplicated.added, windows: duplicated.windows });
        const copy = duplicated.added[0];
        const moved = await call('cubase_track_edit', { objectId: (await find(copy.title)).objectId, expectedUniqueId: copy.uniqueIdString, action: 'moveFirst', confirmEdit: true });
        check('moveFirst changed the channel order', JSON.stringify(moved.orderBefore) !== JSON.stringify(moved.orderAfter) && moved.sequenceCompleted, { before: moved.orderBefore, after: moved.orderAfter });
        const removed = await call('cubase_track_edit', { objectId: (await find(copy.title)).objectId, expectedUniqueId: copy.uniqueIdString, action: 'remove', confirmEdit: true });
        check('remove emptied and removed the copy without a prompt', removed.removed.length === 1 && removed.removed[0].uniqueIdString === copy.uniqueIdString && !removed.windows.unexpected.length,
            { steps: removed.steps, removed: removed.removed, windows: removed.windows });
        const audioAdded = await command('track.add.audioMono');
        list = await channels();
        check('a mono audio track was added', audioAdded && list.filter(channel => channel.typeName === 'AudioChannel').length === 1, list.map(channel => `${channel.typeName}:${channel.title}`));

        // Binding writes that were unconfirmed since session 24: selected-track volume and a bank-channel volume
        const audio = list.find(channel => channel.typeName === 'AudioChannel');
        await call('cubase_channel_set', { objectId: audio.objectId, expectedUniqueId: audio.uniqueIdString, field: 'selected', value: true });
        await sleep(300);
        const selectedTrack = await call('cubase_selected_track', {});
        const trackVolume = await call('cubase_control_set', { key: 'track.volume', value: 0.6, expectedTrackUniqueId: selectedTrack.uniqueId, expectedTrackRuntimeId: selectedTrack.runtimeId, settleMs: 1500 });
        check('selected-track volume binding write confirmed by host feedback', trackVolume.confirmation.state === 'feedback_observed' && trackVolume.confirmation.matchesRequest, trackVolume.confirmation);
        const afterBinding = (await channels()).find(channel => channel.objectId === audio.objectId);
        check('the DirectAccess volume of that channel shows the binding write', Math.abs(afterBinding.fields.volume.value - 0.6) < 0.01, afterBinding.fields.volume);
        const mixer = await call('cubase_page_activate', { page: 'mixer' });
        await sleep(500);
        const pages = await call('cubase_pages_list', {});
        step('mixer page', { changed: mixer.changed, activation: pages.activation });
        check('mixer page finished activating', pages.active === 'mixer' && pages.activation.surfaceInput !== 'stalled', pages.activation);
        const bankKey = 'mixer.channel.0.volume';
        const bank = (await call('cubase_control_get', { key: bankKey })).control;
        let bankWrite = null;
        if (bank.channel && bank.channel.uniqueId) {
            const target = bank.observed && Math.abs(bank.observed.value - 0.55) < 0.01 ? 0.65 : 0.55;
            bankWrite = await call('cubase_control_set', { key: bankKey, value: target, expectedChannelUniqueId: bank.channel.uniqueId, settleMs: 1500 });
        }
        check('bank-channel volume binding write confirmed by host feedback', !!bankWrite && bankWrite.confirmation.state === 'feedback_observed' && bankWrite.confirmation.matchesRequest,
            { channel: bank.channel, error: bank.error, confirmation: bankWrite && bankWrite.confirmation });
        await call('cubase_page_activate', { page: 'main' });
        await sleep(400);

        // Markers and transport
        await call('cubase_transport_action', { action: 'returnToZero' });
        for (let bar = 0; bar < 4; bar++) await call('cubase_transport_action', { action: 'stepBar', settleMs: 200 });
        const markerInserted = await command('marker.insert');
        await call('cubase_transport_action', { action: 'returnToZero' });
        await command('marker.locateNext');
        const atMarker = await call('cubase_transport_state', {});
        check('a marker inserted at bar 5 is found again', markerInserted && atMarker.position.primary === '5. 1. 1.  0', atMarker.position);
        await call('cubase_transport_action', { action: 'returnToZero' });
        const started = await call('cubase_transport_action', { action: 'start', settleMs: 1500 });
        const stopped = await call('cubase_transport_action', { action: 'stop', settleMs: 500 });
        check('playback started, advanced and stopped', started.after.playing === true && started.after.position.primary !== started.before.position.primary && stopped.after.playing === false,
            { start: [started.before.position.primary, started.after.position.primary], playing: [started.after.playing, stopped.after.playing] });
        await call('cubase_transport_action', { action: 'returnToZero' });

        // Audio mixdown through the host's own export, twice, so that the second run meets the first file
        const expectedSeconds = 8 * 4 * 60 / 104;
        const mixdown = await call('cubase_audio_export', { range: { left: '1.1.1.0', right: '9.1.1.0' }, confirmExport: true });
        step('audio exported', { file: mixdown.file, audio: mixdown.audio, elapsedMs: mixdown.elapsedMs });
        check('mixdown is a WAV file of the eight bars with sound in it', mixdown.audio.supported === true && fs.existsSync(mixdown.file.path) &&
            Math.abs(mixdown.audio.seconds - expectedSeconds) < 0.05 && mixdown.audio.silent === false && mixdown.audio.peakDb > -60 && !mixdown.windows.unexpected.length,
            { audio: mixdown.audio, expectedSeconds, windows: mixdown.windows });
        const mixdownAgain = await call('cubase_audio_export', { confirmExport: true });
        check('a second export writes another file and leaves no window', mixdownAgain.audio.supported === true && mixdownAgain.file.path !== mixdown.file.path &&
            fs.existsSync(mixdown.file.path) && fs.existsSync(mixdownAgain.file.path) && !mixdownAgain.windows.unexpected.length && mixdownAgain.audio.frames === mixdown.audio.frames,
            { first: mixdown.file.path, second: mixdownAgain.file.path, windows: mixdownAgain.windows });

        // Save, fresh process, read again
        content = await readAll();
        const beforeSave = content.byTrack;
        const sizeBefore = fs.statSync(projectPath).size;
        const saved = await call('cubase_project_save', { projectPath, confirmCurrentProjectPath: true, observationTimeoutMs: 15000 });
        step('saved', { state: saved.file.state, before: sizeBefore, after: saved.file.after && saved.file.after.size });
        check('Save changed the project file', saved.file.state === 'changed_stable' && saved.file.after.size > sizeBefore, saved.file);
        check('no unexpected window before reopening', (await windows()).length === 0, await windows());
        const reopened = await call('cubase_project_open', { projectPath, replaceCurrent: true, confirmDiscardChanges: true });
        step('reopened in a fresh process', { session, activation: reopened.host.activation });
        await sleep(500);
        const reopenedContent = await readAll();
        check('the reopened project holds the edited song', JSON.stringify(reopenedContent.byTrack) === JSON.stringify(beforeSave) &&
            JSON.stringify(reopenedContent.byTrack.Bass) === JSON.stringify(expectedBass) && JSON.stringify(reopenedContent.byTrack.Piano) === JSON.stringify(expected.Piano),
            { tracks: Object.fromEntries(Object.entries(reopenedContent.byTrack).map(([name, notes]) => [name, notes.length])) });
        const reopenedList = await channels();
        const reopenedSynth = reopenedList.find(channel => channel.typeName === 'Synth');
        check('names, volume and tempo persisted', reopenedList.some(channel => channel.title === 'Lead Synth') && reopenedSynth && reopenedSynth.fields.volume.display === '-3.00' &&
            Math.abs(reopenedContent.read.tempos[0].bpm - 104) < 0.01, { channels: reopenedList.map(channel => channel.title), volume: reopenedSynth && reopenedSynth.fields.volume.display, tempo: reopenedContent.read.tempos });
        check('no unexpected window at the end', (await windows()).length === 0, await windows());
    } catch (error) {
        evidence.error = String(error && error.stack || error);
        process.stdout.write('ERROR ' + evidence.error + '\n');
        process.exitCode = 1;
    } finally {
        evidence.finishedUtc = new Date().toISOString();
        evidence.passed = evidence.checks.filter(item => item.passed).length;
        evidence.failed = evidence.checks.filter(item => !item.passed).length;
        fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), { flag: 'wx' });
        await client.close().catch(() => {});
        process.stdout.write(`checks passed ${evidence.passed}, failed ${evidence.failed}; evidence ${evidencePath}\n`);
        if (evidence.failed) process.exitCode = 1;
    }
}

main().catch(error => { process.stderr.write(String(error && error.stack || error) + '\n'); process.exitCode = 1; });
