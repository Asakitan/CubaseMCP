'use strict';

var HEADER = [240, 125, 67, 65, 49, 54, 1];
var MAX_BYTES = 131072;
var FRAGMENT_SIZE = 320;
var MAX_TRANSFERS = 16;

function integer(value, minimum, maximum) {
    return typeof value === 'number' && isFinite(value) &&
        Math.floor(value) === value && value >= minimum && value <= maximum;
}

function asciiJson(value) {
    return JSON.stringify(value).replace(/[\u007f-\uffff]/g, function (character) {
        return '\\u' + ('0000' + character.charCodeAt(0).toString(16)).slice(-4);
    });
}

function checksum(text) {
    var result = 2166136261;
    for (var index = 0; index < text.length; index++) {
        result ^= text.charCodeAt(index);
        result = (result + (result << 1) + (result << 4) + (result << 7) +
            (result << 8) + (result << 24)) >>> 0;
    }
    return ('00000000' + result.toString(16)).slice(-8);
}

function encode(message) {
    if (!message || !/^[a-f0-9]{32}$/.test(message.id)) throw new Error('INVALID_REQUEST_ID');
    var text = asciiJson(message);
    if (text.length > MAX_BYTES) throw new Error('PAYLOAD_TOO_LARGE');
    var count = Math.ceil(text.length / FRAGMENT_SIZE);
    var digest = checksum(text);
    var frames = [];
    for (var index = 0; index < count; index++) {
        var envelope = asciiJson({
            id: message.id, i: index, n: count, h: digest, length: text.length,
            p: text.slice(index * FRAGMENT_SIZE, (index + 1) * FRAGMENT_SIZE)
        });
        var frame = HEADER.slice();
        for (var offset = 0; offset < envelope.length; offset++) frame.push(envelope.charCodeAt(offset));
        frame.push(247);
        if (frame.length > 1024) throw new Error('FRAME_TOO_LARGE');
        frames.push(frame);
    }
    return frames;
}

function createDecoder() {
    var transfers = Object.create(null);
    return {
        reset: function () { transfers = Object.create(null); },
        accept: function (bytes, now) {
            var index;
            if (!bytes || bytes.length < HEADER.length + 2) return null;
            for (index = 0; index < HEADER.length; index++) {
                if (bytes[index] !== HEADER[index]) return null;
            }
            if (bytes.length > 1024 || bytes[bytes.length - 1] !== 247) throw new Error('INVALID_FRAME');
            var text = '';
            for (index = HEADER.length; index < bytes.length - 1; index++) {
                if (!integer(bytes[index], 0, 127)) throw new Error('INVALID_MIDI_DATA');
                text += String.fromCharCode(bytes[index]);
            }
            var part = JSON.parse(text);
            if (!part || !/^[a-f0-9]{32}$/.test(part.id) || !/^[a-f0-9]{8}$/.test(part.h) ||
                !integer(part.length, 1, MAX_BYTES) ||
                !integer(part.n, 1, Math.ceil(MAX_BYTES / FRAGMENT_SIZE)) ||
                part.n !== Math.ceil(part.length / FRAGMENT_SIZE) ||
                !integer(part.i, 0, part.n - 1) || typeof part.p !== 'string' ||
                part.p.length !== Math.min(FRAGMENT_SIZE, part.length - part.i * FRAGMENT_SIZE)) {
                throw new Error('INVALID_FRAGMENT');
            }
            for (var key in transfers) {
                if (now - transfers[key].created > 10000) delete transfers[key];
            }
            var state = transfers[part.id];
            if (!state) {
                if (Object.keys(transfers).length >= MAX_TRANSFERS) throw new Error('TOO_MANY_TRANSFERS');
                state = { created: now, n: part.n, h: part.h, length: part.length, parts: [], received: 0 };
                transfers[part.id] = state;
            }
            if (state.n !== part.n || state.h !== part.h || state.length !== part.length ||
                (state.parts[part.i] !== undefined && state.parts[part.i] !== part.p)) {
                delete transfers[part.id];
                throw new Error('CONFLICTING_FRAGMENT');
            }
            if (state.parts[part.i] === undefined) state.received++;
            state.parts[part.i] = part.p;
            if (state.received !== state.n) return null;
            delete transfers[part.id];
            var complete = state.parts.join('');
            if (complete.length !== state.length || checksum(complete) !== state.h) throw new Error('CHECKSUM_MISMATCH');
            var decoded = JSON.parse(complete);
            if (!decoded || decoded.id !== part.id || decoded.v !== 1) throw new Error('PROTOCOL_MISMATCH');
            return decoded;
        }
    };
}

module.exports = { encode: encode, createDecoder: createDecoder, checksum: checksum, maxBytes: MAX_BYTES };