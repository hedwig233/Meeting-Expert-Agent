import test from 'node:test';
import assert from 'node:assert/strict';
import { speechFailure } from '../server/local-speech.mjs';
test('Windows TTS failure distinguishes missing voices, broken engines and process errors without disclosing spoken text', () => {
  assert(speechFailure({ stdout: JSON.stringify({ code: 'NO_CHINESE_VOICE' }) }).includes('没有可用中文音色'));
  assert(speechFailure({ stdout: JSON.stringify({ code: 'ALL_VOICES_FAILED', stage: 'select_voice' }) }).includes('select_voice'));
  assert(speechFailure({ code: 'ENOENT', stderr: 'private spoken text' }).includes('ENOENT'));
  assert(!speechFailure({ code: 'ENOENT', stderr: 'private spoken text' }).includes('private spoken text'));
});
