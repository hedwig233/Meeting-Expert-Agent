import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../server/store.mjs';
import { createApplication } from '../server/app.mjs';
import { documentsForExpert, searchKnowledge } from '../server/knowledge.mjs';
import { localExpert, modelExpert } from '../server/expert.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const documents = [
  { id: 'shared', scope: 'shared', title: '评审记录', content: '评审记录：先确认会议事实。', origin: 'test' },
  { id: 'palace', scope: 'palace', title: '评审记录', content: '评审记录：检查证人是否亲历。', origin: 'test' },
  { id: 'technical', scope: 'technical', title: '评审记录', content: '评审记录：确认重试的幂等契约。', origin: 'test' }
];

test('expert retrieval includes shared knowledge and excludes the other specialty', () => {
  assert.deepEqual(documentsForExpert(documents, 'evidence').map(d => d.id), ['shared', 'palace']);
  assert.deepEqual(documentsForExpert(documents, 'architecture').map(d => d.id), ['shared', 'technical']);
  assert.throws(() => documentsForExpert(documents, 'unknown'), /未知专家角色/);
  const result = localExpert({ segments: [{ speaker: 'A', text: '创建订单超时重试' }], question: '', documents: [{ id: 'blocked', scope: 'palace', title: '创建订单', content: '# 创建订单\n不支持幂等。', origin: 'test' }] });
  assert.equal(result.citations.length, 0);
  assert.equal(result.confidence, '资料不足');
});

test('legacy document payloads keep content and gain compatible scopes without overwriting uploads', () => {
  const directory = mkdtempSync(join(tmpdir(), 'seat-scope-'));
  const database = join(directory, 'test.sqlite');
  let store;
  try {
    const db = new DatabaseSync(database);
    db.exec('CREATE TABLE documents (id TEXT PRIMARY KEY, payload TEXT NOT NULL)');
    const insert = db.prepare('INSERT INTO documents VALUES (?, ?)');
    insert.run('sample-evidence-guide.md', JSON.stringify({ id: 'sample-evidence-guide.md', title: '用户修改的演示资料', content: '保留修改', origin: '演示资料' }));
    insert.run('old-upload', JSON.stringify({ id: 'old-upload', title: '旧上传', content: '保留上传', origin: '本地上传' }));
    db.close();
    store = createStore(root, database);
    let docs = store.documents();
    assert.equal(docs.find(d => d.id === 'sample-evidence-guide.md').scope, 'palace');
    assert.equal(docs.find(d => d.id === 'sample-evidence-guide.md').content, '保留修改');
    assert.equal(docs.find(d => d.id === 'old-upload').scope, 'shared');
    const upload = store.addDocument('新资料', '保留内容', 'technical');
    store.setDocumentScope('old-upload', 'palace');
    store.close(); store = createStore(root, database); docs = store.documents();
    assert.equal(docs.find(d => d.id === upload.id).scope, 'technical');
    assert.equal(docs.find(d => d.id === 'old-upload').scope, 'palace');
    assert.equal(docs.find(d => d.id === 'old-upload').content, '保留上传');
  } finally {
    store?.close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert(basename(directory).startsWith('seat-scope-'));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('document API validates scopes and preserves content when changing scope', async () => {
  const application = createApplication({ root, database: ':memory:' });
  await new Promise(resolve => application.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + application.server.address().port + '/api/documents';
  async function request(path, method, body) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }
  try {
    const uploaded = await request('', 'POST', { title: '证据资料', content: '核查操作记录', scope: 'palace' });
    assert.equal(uploaded.status, 201); assert.equal(uploaded.data.scope, 'palace');
    const changed = await request('/' + uploaded.data.id, 'PATCH', { scope: 'shared', content: '不应覆盖' });
    assert.equal(changed.status, 200); assert.equal(changed.data.content, '核查操作记录');
    assert.equal(changed.data.scope, 'shared');
    const defaulted = await request('', 'POST', { title: '公司资料', content: '公共信息' });
    assert.equal(defaulted.data.scope, 'shared');
    assert.equal((await request('', 'POST', { title: '坏范围', content: '信息', scope: 'all' })).status, 400);
    assert.equal((await request('/' + uploaded.data.id, 'PATCH', { scope: 'all' })).status, 400);
    assert.equal((await request('/missing', 'PATCH', { scope: 'shared' })).status, 404);
  } finally { await application.close(); }
});

for (const provider of ['openai_next', 'openai']) {
  for (const expertRole of ['evidence', 'architecture']) {
    test(provider + ' selects the role prompt and filters every retrieval round for ' + expertRole, async () => {
      const originalFetch = globalThis.fetch;
      let calls = 0;
      const allowedIds = expertRole === 'evidence' ? ['shared', 'palace'] : ['shared', 'technical'];
      globalThis.fetch = async (url, options) => {
        const body = JSON.parse(options.body); calls++;
        const prompt = provider === 'openai' ? body.instructions : body.messages[0].content;
        assert(prompt.includes(expertRole === 'evidence' ? '宫廷证据评审专家' : '技术方案评审专家'));
        assert(prompt.includes('工具实际返回的 id'));
        if (expertRole === 'evidence') assert(prompt.includes('不能因为熟悉影视作品'));
        const previousOutputs = provider === 'openai' ? body.input.filter(item => item.type === 'function_call_output').map(item => JSON.parse(item.output)) : body.messages.filter(item => item.role === 'tool').map(item => JSON.parse(item.content));
        for (const sources of previousOutputs) {
          assert.equal(sources.length, 2);
          assert.deepEqual(sources.map(source => source.documentId).sort(), [...allowedIds].sort());
        }
        if (calls <= 2) {
          const args = JSON.stringify({ query: '评审记录' });
          return provider === 'openai' ? Response.json({ status: 'completed', output: [{ type: 'function_call', call_id: 'c' + calls, name: 'search_company_docs', arguments: args }] }) : Response.json({ choices: [{ message: { tool_calls: [{ id: 'c' + calls, type: 'function', function: { name: 'search_company_docs', arguments: args } }] } }] });
        }
        const result = { contextSummary: '评审', finding: '需核实', impact: '结论待确认', question: '依据是什么', proposal: '补齐记录', confidence: '待确认', citationIds: previousOutputs[0].map(source => source.id) };
        return provider === 'openai' ? Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }] }) : Response.json({ choices: [{ message: { content: JSON.stringify(result) } }] });
      };
      try {
        const result = await modelExpert({ provider, expertRole, apiKey: 'test', baseUrl: 'https://example.invalid/v1', model: 'test', segments: [], question: '', documents });
        assert.equal(calls, 3);
        assert.deepEqual(result.citations.map(source => source.documentId).sort(), [...allowedIds].sort());
      } finally { globalThis.fetch = originalFetch; }
    });
  }
}

test('a model cannot cite a document from the other expert specialty', async () => {
  const originalFetch = globalThis.fetch; let calls = 0;
  const blockedCitation = searchKnowledge(documents.filter(d => d.scope === 'technical'), '评审记录')[0].id;
  globalThis.fetch = async () => {
    if (++calls === 1) return Response.json({ choices: [{ message: { tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search_company_docs', arguments: JSON.stringify({ query: '评审记录' }) } }] } }] });
    return Response.json({ choices: [{ message: { content: JSON.stringify({ contextSummary: '', finding: '', impact: '', question: '', proposal: '', confidence: '', citationIds: [blockedCitation] }) } }] });
  };
  try { await assert.rejects(() => modelExpert({ expertRole: 'evidence', provider: 'openai_next', apiKey: 'test', baseUrl: 'https://example.invalid', model: 'test', segments: [], question: '', documents }), /未检索到/); }
  finally { globalThis.fetch = originalFetch; }
});
