import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { createApplication } from '../server/app.mjs';

test('Qwen bridge sends queue state and recovers failed segments without fatal socket errors', async () => {
  const originalFetch = globalThis.fetch; const requests = [], events = [];
  globalThis.fetch = (url, options) => {
    if (String(url) !== 'https://api.openai-next.com/v1/chat/completions') return originalFetch(url, options);
    assert.equal(JSON.parse(options.body).model, 'qwen3-omni-flash');
    return new Promise((resolve, reject) => requests.push({ resolve, reject }));
  };
  const app = createApplication({ root: fileURLToPath(new URL('..', import.meta.url)), database: ':memory:', config: { asrProvider: 'next_omni', nextApiKey: 'fake-test-key' } });
  let socket;
  const wait = async predicate => {
    const deadline = Date.now() + 3000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('Timed out waiting for bridge flow');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  };
  const separator = String.fromCharCode(10).repeat(2);
  const complete = text => requests.shift().resolve(new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] }) + separator + 'data: [DONE]' + separator, { headers: { 'content-type': 'text/event-stream' } }));
  try {
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const port = app.server.address().port;
    const session = await (await originalFetch('http://127.0.0.1:' + port + '/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Qwen flow test' }) })).json();
    socket = new WebSocket('ws://127.0.0.1:' + port + '/ws/meeting?session=' + session.id);
    socket.on('message', data => events.push(JSON.parse(data.toString())));
    await wait(() => socket.readyState === WebSocket.OPEN);
    socket.send(JSON.stringify({ type: 'stream.start', mode: 'next_omni' }));
    await wait(() => events.some(e => e.type === 'stream.ready'));
    const audio = Buffer.alloc(16000);
    for (let i = 0; i < audio.length; i += 2) audio.writeInt16LE(6000, i);
    const turn = () => { socket.send(audio); socket.send(JSON.stringify({ type: 'stream.flush' })); };
    for (let i = 0; i < 4; i++) turn();
    await wait(() => events.some(e => e.type === 'asr.state' && e.paused && e.pending === 3));
    turn(); // In-flight frames are tolerated while paused.
    complete('第一段讨论');
    await wait(() => requests.length > 0);
    requests.shift().reject(new Error('simulated network failure'));
    await wait(() => events.some(e => e.type === 'asr.notice' && e.text.includes('fetch failed')) && requests.length > 0);
    await wait(() => events.some(e => e.type === 'asr.state' && !e.paused && e.pending === 1));
    complete('[听不清]');
    await wait(() => requests.length > 0);
    complete('后续讨论');
    await wait(() => events.filter(e => e.type === 'segment').length === 2);
    turn(); await wait(() => requests.length > 0); complete('恢复后的讨论');
    socket.send(JSON.stringify({ type: 'stream.sync' }));
    await wait(() => events.some(e => e.type === 'stream.synced'));
    assert.deepEqual(events.filter(e => e.type === 'segment').map(e => e.segment.text), ['第一段讨论', '后续讨论', '恢复后的讨论']);
    assert(events.filter(e => e.type === 'segment').every(e => e.segment.source === 'next_omni'));
    assert(events.some(e => e.type === 'asr.notice' && e.text.includes('未听清')));
    assert.equal(events.filter(e => e.type === 'error').length, 0);
  } finally {
    socket?.terminate(); await app.close(); globalThis.fetch = originalFetch;
  }
});
