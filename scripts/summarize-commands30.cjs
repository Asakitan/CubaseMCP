'use strict';

// Aggregates the session-30 command verification ledgers (scripts/verify-commands30.cjs) into
// one result per allowlisted command, writes artifacts/ipc/command-verify30-summary.json and
// docs/command-allowlist-30.md, and with --apply stores the result in the `live` field of
// remote/commands.js. A command that opened a window in any run is reported as "dialog" and
// must be removed from the table by hand; this script never edits the set of commands.
// Usage: node scripts/summarize-commands30.cjs [--apply]
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const ipc = path.join(root, 'artifacts', 'ipc');
const tablePath = path.join(root, 'remote', 'commands.js');
const table = require(tablePath);
const rank = { dialog: 5, effect_observed: 4, submitted: 3, binding_not_observed: 2, not_performable: 1, probe_error: 0 };

const entries = new Map();
const ledgers = fs.readdirSync(ipc).filter(name => /^command-verify30-.*\.jsonl$/.test(name)).sort();
for (const name of ledgers) {
    for (const line of fs.readFileSync(path.join(ipc, name), 'utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        const entry = JSON.parse(line);
        if (entry.step !== 'command' || !(entry.outcome in rank)) continue;
        const list = entries.get(entry.key) || [];
        list.push({ ...entry, ledger: name });
        entries.set(entry.key, list);
    }
}

function numbers(text) {
    const found = {};
    for (const match of String(text || '').matchAll(/(notes|startSum|durSum|pitchSum|velSum|cc|markers)=(-?[\d.]+)/g)) found[match[1]] = Number(match[2]);
    const tracks = /tracks=(\S*)/.exec(String(text || ''));
    if (tracks) found.tracks = tracks[1];
    return found;
}

function describe(entry) {
    const parts = [];
    for (const change of entry.changes || []) {
        if (change === 'midi' && entry.before && entry.before.velocities) {
            parts.push(`note velocities ${JSON.stringify(entry.before.velocities)} → ${JSON.stringify(entry.after.velocities)}`);
        } else if (change === 'midi' && entry.before && entry.after && entry.before.midi) {
            const before = numbers(entry.before.midi), after = numbers(entry.after.midi);
            const labels = { notes: 'notes', startSum: 'note starts', durSum: 'note lengths', pitchSum: 'pitches', velSum: 'velocities', cc: 'controller events', markers: 'markers', tracks: 'written tracks' };
            // When the number of notes changed, the sums changed with it and say nothing more.
            const counted = before.notes !== after.notes;
            const changed = Object.keys(labels).filter(field => before[field] !== after[field] && field !== 'tracks' && !(counted && /Sum$/.test(field)))
                .map(field => ['notes', 'cc', 'markers'].includes(field) ? `${labels[field]} ${before[field]} → ${after[field]}` : `${labels[field]} changed`);
            parts.push('MIDI content: ' + (changed.join(', ') || 'changed'));
        } else if (change === 'tracks' && entry.before && entry.before.channels) {
            const names = list => list.map(item => item.split(':').slice(0, 2).join(':'));
            const before = names(entry.before.channels), after = names(entry.after.channels);
            const added = after.filter(item => after.filter(other => other === item).length > before.filter(other => other === item).length);
            const removed = before.filter(item => before.filter(other => other === item).length > after.filter(other => other === item).length);
            parts.push(added.length || removed.length ? `tracks: ${[...new Set(added)].map(item => '+' + item).concat([...new Set(removed)].map(item => '-' + item)).join(' ')}` : 'track order');
        } else if (change === 'channelFlags' && entry.before && entry.before.channels) {
            const fields = ['mute', 'solo', 'selected', 'recordEnable', 'monitor', 'automationRead', 'automationWrite'], touched = new Set();
            entry.before.channels.forEach((item, index) => {
                const before = item.split(':').pop(), after = (entry.after.channels[index] || '').split(':').pop();
                fields.forEach((field, position) => { if (before[position] !== after[position]) touched.add(field); });
            });
            parts.push('channel ' + [...touched].join(', '));
        } else if (change === 'marker') { parts.push('marker found again by Locate Next Marker');
        } else if (/^transport\./.test(change)) {
            const field = change.slice(10);
            const before = entry.before && (entry.before.transport ? entry.before.transport[field] : entry.before[field]);
            const after = entry.after && (entry.after.transport ? entry.after.transport[field] : entry.after[field]);
            parts.push(field === 'position' ? `cursor ${String(before).replace(/\s+/g, '')} → ${String(after).replace(/\s+/g, '')}` : `${field} ${before} → ${after}`);
        }
    }
    if (entry.undo) parts.push(entry.undo.restored ? 'undone by Edit/Undo' : 'Edit/Undo did not restore the previous content');
    return parts.join('; ');
}

// Five commands are not run by the generic loop because a tool has to prepare them. Their evidence
// is the named check of the acceptance run (scripts/verify-song30.cjs).
const VIA_TOOL = {
    'track.removeSelected': ['remove emptied and removed the copy without a prompt', 'through cubase_track_edit: the emptied track was removed and no window opened'],
    'export.openMixdownWindow': ['mixdown is a WAV file of the eight bars with sound in it', 'through cubase_audio_export: the host opened and closed its export window'],
    'export.perform': ['a second export writes another file and leaves no window', 'through cubase_audio_export: two mixdown files written'],
    'midi.writeFileToProjectFolder': ['Cubase returns exactly the imported notes', 'through cubase_midi_read: the written file held exactly the imported notes'],
    'project.save': ['the reopened project holds the edited song', 'through cubase_project_save: file changed and the reopened project held the edited song']
};
const acceptancePath = path.join(ipc, 'song30-live-e2e1.json');
const acceptance = fs.existsSync(acceptancePath) ? JSON.parse(fs.readFileSync(acceptancePath, 'utf8')) : { checks: [] };

const results = [];
for (const definition of table) {
    const viaTool = VIA_TOOL[definition.key];
    if (viaTool) {
        const passed = acceptance.checks.some(check => check.name === viaTool[0] && check.passed === true);
        results.push({ key: definition.key, group: definition.group, category: definition.category, name: definition.name, tool: definition.tool || null,
            outcome: passed ? 'effect_observed' : 'not_run', live: passed ? 'verified' : 'unverified', runs: passed ? 1 : 0, context: 'acceptance', bindingObserved: null,
            observed: passed ? viaTool[1] : '', windows: [], ledger: passed ? 'song30-live-e2e1.json' : null });
        continue;
    }
    const list = entries.get(definition.key) || [];
    // A window in any run decides; otherwise the strongest observation counts, the latest among equals.
    const best = list.slice().sort((left, right) => rank[right.outcome] - rank[left.outcome] || (left.at < right.at ? 1 : -1))[0];
    // A cursor move alone does not verify a command that is not about the cursor; it stays "submitted"
    // and the move is still listed under "Observed".
    const cursorOnly = best && best.outcome === 'effect_observed' && (best.changes || []).every(change => change === 'transport.position') &&
        !['transport', 'marker'].includes(definition.group);
    const outcome = !best ? 'not_run' : cursorOnly ? 'submitted' : best.outcome;
    results.push({ key: definition.key, group: definition.group, category: definition.category, name: definition.name, tool: definition.tool || null,
        outcome, live: outcome === 'effect_observed' ? 'verified' : outcome === 'submitted' ? 'submitted' : 'unverified',
        runs: list.length, context: best ? best.context : null, bindingObserved: best ? best.bindingObserved === true : null,
        observed: best ? describe(best) : '', windows: best && best.unexpectedWindows && best.unexpectedWindows.length ? best.unexpectedWindows : [], ledger: best ? best.ledger : null });
}
const unlisted = [...entries.keys()].filter(key => !table.some(definition => definition.key === key))
    .map(key => { const best = entries.get(key).slice().sort((left, right) => rank[right.outcome] - rank[left.outcome])[0]; return { key, outcome: best.outcome, windows: best.unexpectedWindows || [], ledger: best.ledger }; });

const counts = results.reduce((total, item) => { total[item.outcome] = (total[item.outcome] || 0) + 1; return total; }, {});
const summary = { generatedUtc: new Date().toISOString(), ledgers, commandTotal: table.length, counts, results, removedAfterDialog: unlisted.filter(item => item.outcome === 'dialog'), otherUnlisted: unlisted.filter(item => item.outcome !== 'dialog') };
fs.writeFileSync(path.join(ipc, 'command-verify30-summary.json'), JSON.stringify(summary, null, 2));

const label = { effect_observed: 'verified', submitted: 'submitted', not_performable: 'not performable', binding_not_observed: 'no binding event', dialog: 'OPENS A WINDOW', probe_error: 'probe error', not_run: 'not run' };
const contextText = { events: 'events of one MIDI track selected', track: 'one MIDI track selected', clipboard: 'events selected and copied', none: 'no selection prepared',
    playing: 'transport running', bar4: 'cursor at bar 4, locators at bars 2 and 3', muted: 'one track muted first', soloed: 'one track soloed first', mutedEvents: 'events muted first', acceptance: 'acceptance run `e2e1`', 'marker sequence': 'marker sequence', 'velocity sequence': 'preset selected, then Fixed Velocity on the selected notes', 'after edit.delete': 'after Edit/Delete', 'after edit.undo': 'after Edit/Undo' };
const groups = [...new Set(table.map(item => item.group))];
const lines = [
    '# Key-command allowlist: live results (session 30)', '',
    'Generated by `scripts/summarize-commands30.cjs` from the ledgers of `scripts/verify-commands30.cjs`; do not edit the table by hand.', '',
    `The allowlist in \`remote/commands.js\` has **${table.length}** commands. Each one was executed on the owned private-desktop Cubase AI 16.0.5.174 instance through the real MCP server, in a project with two imported MIDI tracks and one mono audio track. Before each command the script set the cursor to bar 2, selected the track or its events where the command needs a selection, and recorded the visible windows, the mixer channels, the transport and the MIDI content Cubase writes. Content changes were undone with Edit/Undo and the restored content was compared. Five commands that only run through a tool take their result from the acceptance run.`, '',
    '| Result | Meaning | Commands |', '| --- | --- | --- |',
    `| verified | the described effect was read back from the host | ${counts.effect_observed || 0} |`,
    `| submitted | the host reported the binding event; no change was visible in the available read-backs (selection, clipboard, grid settings and view state cannot be read) or the command had nothing to act on | ${counts.submitted || 0} |`,
    `| not performable | Cubase reported canPerform false in the prepared context (for example no range selection or no audio event) | ${counts.not_performable || 0} |`,
    `| other | no binding event, probe error or not run | ${(counts.binding_not_observed || 0) + (counts.probe_error || 0) + (counts.not_run || 0)} |`, '',
    'No command in the table opened a window in any run, apart from the export window that `cubase_audio_export` opens on purpose and the host closes. `live` in `remote/commands.js` and in `cubase_commands_list` carries the same result (`verified`, `submitted`, `unverified`).', ''
];
const editorOnly = summary.otherUnlisted.filter(item => item.outcome === 'not_performable');
if (summary.removedAfterDialog.length) {
    lines.push('## Removed because they opened a window', '',
        'These commands were probed and are **not** in the allowlist. The window was left untouched and the instance was replaced.', '',
        '| Key | Window |', '| --- | --- |', ...summary.removedAfterDialog.map(item => `| \`${item.key}\` | ${item.windows.join(', ')} |`), '',
        'An earlier probe of the same session (`command-probe30-*.jsonl`) removed for the same reason: Add Track Audio, Instrument, MIDI, FX Channel, Group Channel, Folder and Ruler (Add Track dialog), and Export Audio Mixdown Simple (alert, then a file selector). Remove Selected Tracks asks for confirmation when the track has content and Perform Audio Export asks before overwriting a file; both are therefore only reachable through tools that prevent the prompt. Save New Version opens no window but renames the host document behind the managed-project record, so it was removed as well.', '');
}
if (editorOnly.length) {
    lines.push('## Removed because they never became performable', '',
        `These were not performable with MIDI events selected in the project window; they belong to an open MIDI editor, which this server never opens: ${editorOnly.map(item => `\`${item.key}\``).join(', ')}.`, '');
}
for (const group of groups) {
    lines.push(`## ${group}`, '', '| Key | Cubase command | Result | Prepared context | Observed |', '| --- | --- | --- | --- | --- |');
    for (const item of results.filter(result => result.group === group)) {
        lines.push(`| \`${item.key}\` | ${item.category} / ${item.name} | ${label[item.outcome]}${item.tool ? ` (only through \`${item.tool}\`)` : ''} | ${contextText[item.context] || item.context || ''} | ${item.observed.replace(/\|/g, '/')} |`);
    }
    lines.push('');
}
lines.push('## Reading the results', '',
    '- "verified" is bound to the prepared context. A command can still do nothing, or be not performable, in another context; `cubase_command_get` reports `canPerform` at call time.',
    '- A command acts on the current Cubase selection and cursor. Select a track with `cubase_channel_set` (`selected`), its events with `edit.selectAllOnTracks`, and move the cursor with `cubase_transport_action` or `cubase_locator_set` first.',
    '- Audio event commands had no audio event to act on in this project; they are listed as submitted or not performable, not as verified.',
    '- Cubase writes only unmuted MIDI tracks with events, so mute and solo commands also change the written MIDI content.',
    '- The ledgers are `artifacts/ipc/command-verify30-*.jsonl`; the per-command summary is `artifacts/ipc/command-verify30-summary.json`.', '');
fs.writeFileSync(path.join(root, 'docs', 'command-allowlist-30.md'), lines.join('\n'));

if (process.argv.includes('--apply')) {
    let source = fs.readFileSync(tablePath, 'utf8');
    for (const item of results) {
        const pattern = new RegExp(`^(    command\\('${item.key.replace(/\./g, '\\.')}',.*?)(?:, '(?:verified|submitted|unverified)')?(\\),?)$`, 'm');
        if (item.tool) {
            const composite = new RegExp(`(command\\('${item.key.replace(/\./g, '\\.')}',[\\s\\S]*?)'(?:verified|submitted|unverified)', '${item.tool}'\\)`);
            if (!composite.test(source)) throw new Error('composite definition not found: ' + item.key);
            source = source.replace(composite, `$1'${item.live}', '${item.tool}')`);
            continue;
        }
        if (!pattern.test(source)) throw new Error('definition line not found: ' + item.key);
        source = source.replace(pattern, item.live === 'unverified' ? '$1$2' : `$1, '${item.live}'$2`);
    }
    fs.writeFileSync(tablePath, source);
}

process.stdout.write(JSON.stringify({ ledgers: ledgers.length, commandTotal: table.length, counts,
    dialog: results.filter(item => item.outcome === 'dialog').map(item => item.key), removedAfterDialog: summary.removedAfterDialog.map(item => item.key),
    notRun: results.filter(item => item.outcome === 'not_run').length,
    problems: results.filter(item => ['binding_not_observed', 'probe_error'].includes(item.outcome)).map(item => item.key) }, null, 1) + '\n');
