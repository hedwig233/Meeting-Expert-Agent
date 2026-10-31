import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, existsSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../server/app.mjs';
import { isMinutesWorkspace } from '../src/minutes-workspace.mjs';
import { emptyWorkspace } from './minutes-workspace-fixture.mjs';

test('workspace validation checks nested records and rejects unsupported versions', () => {
  assert(isMinutesWorkspace(emptyWorkspace()));
  assert(!isMinutesWorkspace(null));
  assert(!isMinutesWorkspace({ ...emptyWorkspace(), version: 2 }));
  assert(!isMinutesWorkspace({ ...emptyWorkspace(), tasks: [null] }));
  assert(!isMinutesWorkspace({ ...emptyWorkspace(), discussion: [{ id: 'd', text: 'text', taskTitle: 'task', taskId: 1 }] }));
  const record = { id: 'r', expert: { id: 'product', key: 'product', name: 'Expert', description: '' }, task: null, text: 'question', displayText: 'question', context: 'context', status: 'ready' };
  assert(!isMinutesWorkspace({ ...emptyWorkspace(), records: [record] }));
  assert(isMinutesWorkspace({ ...emptyWorkspace(), records: [{ ...record, answer: { answerTitle: 'title', answerBody: 'body', evidence: [], action: '', confidence: null } }] }));
});

test('SQLite workspaces survive restart, isolate IDs, reject stale writes and preserve data on invalid or oversized saves', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'seat-workspace-'));
  const database = join(directory, 'seat.sqlite');
  let application;
  const start = async () => {
    application = createApplication({ root: process.cwd(), database });
    application.server.listen(0, '127.0.0.1'); await once(application.server, 'listening');
    return 'http://127.0.0.1:' + application.server.address().port;
  };
  try {
    let base = await start(); const id = randomUUID(); const other = randomUUID();
    const get = () => fetch(base + '/api/minutes/workspaces/' + id).then(response => response.json());
    const put = (workspace, revision, target = id) => fetch(base + '/api/minutes/workspaces/' + target, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace, revision }) });
    assert.deepEqual(await get(), { workspace: null, revision: 0 });
    const workspace = { ...emptyWorkspace(), person: 'Alice', question: 'Draft' };
    assert.equal((await put(workspace, 0)).status, 200);
    assert.equal((await put({ ...workspace, question: 'Stale' }, 0)).status, 409);
    assert.equal((await put({ ...workspace, tasks: [null] }, 1)).status, 400);
    assert.equal((await put(workspace, 0, 'invalid-id')).status, 400);
    assert.equal((await put(emptyWorkspace(), 0, other)).status, 200);
    assert.deepEqual((await get()).workspace, workspace);
    await application.close(); application = null; base = await start();
    assert.deepEqual(await get(), { workspace, revision: 1 });
    const large = { ...workspace, records: Array.from({ length: 5 }, (_, i) => ({ id: String(i), expert: { id: 'product', key: 'product', name: 'Expert', description: '' }, task: null, text: 'Question', displayText: 'Question', context: 'x'.repeat(120000), status: 'error', error: 'Interrupted' })) };
    assert(Buffer.byteLength(JSON.stringify(large)) > 512 * 1024);
    assert.equal((await put(large, 1)).status, 200);
    assert.deepEqual((await get()).workspace, large);
    const oversized = await put({ ...workspace, question: 'x'.repeat(16 * 1024 * 1024) }, 2);
    assert.equal(oversized.status, 413); assert.match((await oversized.json()).error, /16 MiB/);
    assert.deepEqual((await get()).workspace, large);
    assert.equal((await put(emptyWorkspace(), 2)).status, 200);
    await application.close(); application = null; base = await start();
    assert.deepEqual((await get()).workspace, emptyWorkspace());
    assert.deepEqual((await fetch(base + '/api/minutes/workspaces/' + other).then(response => response.json())).workspace, emptyWorkspace());
  } finally {
    if (application) await application.close();
    for (const file of [database, database + '-wal', database + '-shm']) if (existsSync(file)) unlinkSync(file);
    rmdirSync(directory);
  }
});
