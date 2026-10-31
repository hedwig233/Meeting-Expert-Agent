import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findCachedRuntime } from '../scripts/whisper-cache.mjs';

test('a completed runtime installation can be reused while the model download is incomplete', () => {
  const directory = mkdtempSync(join(tmpdir(), 'seat-runtime-'));
  const release = join(directory, 'runtime', 'b4938'), build = join(release, 'Release'), binary = join(build, 'whisper-cli.exe');
  mkdirSync(build, { recursive: true }); writeFileSync(binary, 'test fixture');
  try { assert.deepEqual(findCachedRuntime(directory), { binary, release: 'b4938' }); }
  finally { unlinkSync(binary); rmdirSync(build); rmdirSync(release); rmdirSync(join(directory, 'runtime')); rmdirSync(directory); }
});
test('missing runtime stays missing rather than attempting an invalid cache reuse', () => {
  const directory = mkdtempSync(join(tmpdir(), 'seat-runtime-'));
  try { assert.equal(findCachedRuntime(directory), null); }
  finally { rmdirSync(directory); }
});
