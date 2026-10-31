import test from 'node:test';
import assert from 'node:assert/strict';
import { describeNetworkFailure } from '../server/network-error.mjs';
test('nested DNS failures expose error code and host without exposing credentials', () => {
  const message = describeNetworkFailure({ cause: { code: 'ENOTFOUND', message: 'secret Bearer sk-test' } }, 'https://user:password@api.example.invalid/v1?key=sk-test');
  assert(message.includes('ENOTFOUND')); assert(message.includes('api.example.invalid')); assert(!message.includes('password')); assert(!message.includes('sk-test'));
});
test('aggregate timeouts and certificate errors retain actionable diagnoses', () => {
  assert(describeNetworkFailure({ cause: { errors: [{ code: 'ETIMEDOUT' }] } }, 'https://example.invalid').includes('连接超时'));
  assert(describeNetworkFailure({ cause: { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' } }, 'https://example.invalid').includes('保留证书校验'));
});
