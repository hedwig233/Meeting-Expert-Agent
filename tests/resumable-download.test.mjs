import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resumableDownload } from '../scripts/resumable-download.mjs';

function files() { const directory = mkdtempSync(join(tmpdir(), 'seat-download-')); const target = join(directory, 'model.bin'); return { target, cleanup() { for (const path of [target, target + '.part']) { try { unlinkSync(path); } catch {} } rmdirSync(directory); } }; }
test('retry appends only the remaining bytes to the existing partial download', async () => {
  const f = files(); writeFileSync(f.target + '.part', 'abc');
  try {
    await resumableDownload('https://example.invalid/model', f.target, { log: () => {}, fetchImpl: async (url, options) => { assert.equal(options.headers.Range, 'bytes=3-'); return new Response('def', { status: 206, headers: { 'content-range': 'bytes 3-5/6' } }); } });
    assert.equal(readFileSync(f.target, 'utf8'), 'abcdef'); assert.equal(existsSync(f.target + '.part'), false);
  } finally { f.cleanup(); }
});
test('a server ignoring range requests replaces rather than duplicates partial data', async () => {
  const f = files(); writeFileSync(f.target + '.part', 'abc');
  try { await resumableDownload('https://example.invalid/model', f.target, { log: () => {}, fetchImpl: async () => new Response('abcdef', { headers: { 'content-length': '6' } }) }); assert.equal(readFileSync(f.target, 'utf8'), 'abcdef'); }
  finally { f.cleanup(); }
});
test('invalid resume responses preserve the previously downloaded bytes', async () => {
  const f = files(); writeFileSync(f.target + '.part', 'abc');
  try { await assert.rejects(() => resumableDownload('https://example.invalid/model', f.target, { log: () => {}, fetchImpl: async () => new Response('wrong', { status: 206, headers: { 'content-range': 'bytes 2-6/7' } }) }), /unexpected resume range/); assert.equal(readFileSync(f.target + '.part', 'utf8'), 'abc'); }
  finally { f.cleanup(); }
});
test('a completed partial file can be promoted after a range-not-satisfiable response', async () => {
  const f = files(); writeFileSync(f.target + '.part', 'abcdef');
  try { await resumableDownload('https://example.invalid/model', f.target, { log: () => {}, fetchImpl: async () => new Response('', { status: 416, headers: { 'content-range': 'bytes */6' } }) }); assert.equal(readFileSync(f.target, 'utf8'), 'abcdef'); }
  finally { f.cleanup(); }
});
