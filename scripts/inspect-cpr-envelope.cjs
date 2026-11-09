'use strict';

// Read-only inspection of the observed Cubase 16 NUND envelope, not a CPR validator.
const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');

const MAX_CHUNKS = 8192;
const MAX_ROOT_BYTES = 16384;
const MAX_ROOT_FIELDS = 32;
const MAX_ROOT_FIELD_BYTES = 4096;

function error(code, message) {
    const value = new Error(message);
    value.code = code;
    return value;
}

function readExact(fd, offset, length) {
    const buffer = Buffer.alloc(length);
    let count = 0;
    while (count < length) {
        const read = fs.readSync(fd, buffer, count, length - count, offset + count);
        if (!read) throw error('TRUNCATED', 'The file ended while reading its envelope.');
        count += read;
    }
    return buffer;
}

function rootFields(buffer) {
    const fields = [];
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let position = 0;
    while (position < buffer.length) {
        if (fields.length >= MAX_ROOT_FIELDS || buffer.length - position < 4)
            throw error('INVALID_ROOT', 'The observed ROOT descriptor is incomplete or exceeds its field limit.');
        const length = buffer.readUInt32BE(position);
        position += 4;
        if (length > MAX_ROOT_FIELD_BYTES || length > buffer.length - position)
            throw error('INVALID_ROOT', 'A ROOT descriptor field exceeds its bounds.');
        try { fields.push(decoder.decode(buffer.subarray(position, position + length))); }
        catch { throw error('INVALID_ROOT_ENCODING', 'A ROOT descriptor field is not UTF-8.'); }
        position += length;
    }
    return fields;
}

function sameStat(left, right) {
    return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
        left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function inspectCprEnvelope(filename) {
    if (typeof filename !== 'string' || !filename) throw error('INVALID_PATH', 'A file path is required.');
    const fullPath = path.resolve(filename);
    const fd = fs.openSync(fullPath, 'r');
    try {
        const before = fs.fstatSync(fd, { bigint: true });
        if (!before.isFile()) throw error('NOT_FILE', 'The opened path is not a regular file.');
        if (before.size < 12n || before.size > 4294967307n)
            throw error('INVALID_SIZE', 'The file size is outside the observed 32-bit envelope.');
        const size = Number(before.size);
        const header = readExact(fd, 0, 12);
        if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'NUND')
            throw error('UNRECOGNIZED_ENVELOPE', 'Expected the observed RIFF/NUND signature.');
        const declaredSize = header.readUInt32BE(4);
        if (declaredSize !== size - 12)
            throw error('SIZE_MISMATCH', 'The big-endian envelope length does not match the file size.');
        const chunks = [];
        let offset = 12;
        while (offset < size) {
            if (chunks.length >= MAX_CHUNKS) throw error('CHUNK_LIMIT', 'The chunk count exceeds the inspection bound.');
            if (size - offset < 8) throw error('TRUNCATED_CHUNK', 'A complete chunk header is missing.');
            const chunkHeader = readExact(fd, offset, 8);
            if ([...chunkHeader.subarray(0, 4)].some(value => value < 0x20 || value > 0x7e))
                throw error('INVALID_CHUNK_TAG', 'A chunk tag is not printable ASCII.');
            const tag = chunkHeader.toString('ascii', 0, 4);
            const length = chunkHeader.readUInt32BE(4);
            if (length > size - offset - 8) throw error('TRUNCATED_CHUNK', 'A chunk exceeds the declared envelope.');
            const chunk = { tag, offset, length };
            if (tag === 'ROOT') {
                if (length > MAX_ROOT_BYTES) throw error('ROOT_LIMIT', 'A ROOT descriptor exceeds the inspection bound.');
                chunk.fields = rootFields(readExact(fd, offset + 8, length));
            }
            chunks.push(chunk);
            offset += 8 + length;
        }
        if (!chunks.length) throw error('NO_CHUNKS', 'The envelope contains no observed chunks.');
        const after = fs.fstatSync(fd, { bigint: true });
        const named = fs.statSync(fullPath, { bigint: true });
        if (!sameStat(before, after) || !sameStat(after, named))
            throw error('FILE_CHANGED', 'The file identity, size or timestamps changed during inspection.');
        return {
            file: fullPath,
            size,
            modifiedTimeNs: after.mtimeNs.toString(),
            fileIdentity: { device: after.dev.toString(), inode: after.ino.toString() },
            container: 'RIFF/NUND',
            declaredSize,
            chunks,
            limitation: 'Observed envelope framing only; ARCH content, project semantics, save completion and durability are not validated. File metadata checks are not an atomic snapshot.'
        };
    } finally { fs.closeSync(fd); }
}

module.exports = { inspectCprEnvelope };

if (require.main === module) {
    try {
        if (process.argv.length !== 3) throw error('USAGE', 'Usage: node scripts/inspect-cpr-envelope.cjs PROJECT.cpr');
        process.stdout.write(JSON.stringify({ ok: true, data: inspectCprEnvelope(process.argv[2]) }, null, 2) + '\n');
    } catch (cause) {
        process.stdout.write(JSON.stringify({ ok: false, error: { code: cause.code || 'INSPECTION_FAILED', message: cause.message } }, null, 2) + '\n');
        process.exitCode = 1;
    }
}
