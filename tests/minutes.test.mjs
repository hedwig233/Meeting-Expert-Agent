import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mountMinutesRoutes, parseMinutes, parseAnswer, resolveMinutesConfig } from '../server/minutes.mjs';

const minutes = '参会人：周宁、林晓。周宁负责需求清单，本周五前完成。林晓负责发布。';
const quote = '周宁负责需求清单，本周五前完成。';
const response = value => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });

test('personal tasks require a verbatim quote naming the user; unrelated or fabricated tasks are excluded', () => {
  const parsed = parseMinutes(response({ title: '周会', participants: ['周宁', '林晓', '编造姓名'], tasks: [
    { title: '需求清单', sourceQuote: quote, involvement: '负责人', priority: 'high', needsConfirmation: false, deadline: '本周五' },
    { title: '发布', sourceQuote: '林晓负责发布。' }, { title: '伪造任务', sourceQuote: '周宁负责数据库迁移。' }, null,
  ] }), minutes, '周宁');
  assert.equal(parsed.tasks.length, 1); assert.equal(parsed.tasks[0].sourceQuote, quote); assert.equal(parsed.tasks[0].deadline, '本周五');
  assert.equal(parsed.tasks[0].needsConfirmation, false); assert.deepEqual(parsed.participants, ['周宁', '林晓']); assert(parsed.notice);
  assert.deepEqual(parseMinutes(response({ tasks: [] }), minutes, '周宁').tasks, []);
});

test('invalid, incomplete and empty model responses never become usable tasks or answers', () => {
  assert.throws(() => parseMinutes(response({}), minutes, '周宁'), /任务列表/);
  assert.throws(() => parseMinutes({ status: 'incomplete' }, minutes, '周宁'), /未完成/);
  assert.throws(() => parseAnswer(response({ answerTitle: '缺少正文' })), /正文/);
  assert.throws(() => parseAnswer({ output_text: '' }), /文本/);
  assert.equal(parseAnswer(response({ answerBody: '需要补充材料', confidence: 200, evidence: ['纪要', 2] })).confidence, 100);
  assert.deepEqual(parseAnswer(response({ answerBody: '需要补充材料', evidence: ['纪要', 2] })).evidence, ['纪要']);
});

test('minutes model settings honor overrides and do not reuse an incompatible Chat Completions provider', () => {
  const configured = resolveMinutesConfig({ llmProvider: 'qwen', qwenModel: 'qwen-plus' }, { MINUTES_API_KEY: 'test', MINUTES_MODEL: 'chosen', MINUTES_BASE_URL: 'https://example.invalid/v1' });
  assert.equal(configured.model, 'chosen'); assert.equal(configured.apiKey, 'test');
  assert.equal(resolveMinutesConfig({ llmProvider: 'qwen', qwenModel: 'qwen-plus' }, { MINUTES_API_KEY: 'test' }).model, 'gpt-6.1-sol');
  const next = resolveMinutesConfig({ llmProvider: 'openai_next', qwenApiKey: 'next-key', qwenBaseUrl: 'https://next.invalid/v1', qwenModel: 'next-model' }, { OPENAI_BASE_URL: 'https://api.openai.com/v1', OPENAI_MODEL: 'unused', NEXT_API_KEY: 'next-key' });
  assert.equal(next.apiKey, 'next-key'); assert.equal(next.baseUrl, 'https://next.invalid/v1'); assert.equal(next.model, 'next-model');
});

test('API validates inputs, uses Responses with the original context, and redacts upstream errors', async () => {
  const app = express(); app.use(express.json()); const requests = []; let fail = false;
  mountMinutesRoutes(app, { apiKey: 'server-only-secret', baseUrl: 'https://example.invalid/v1/', model: 'configured-model' }, { fetchModel: async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    if (fail) return Response.json({ error: 'server-only-secret' }, { status: 401 });
    const extracting = JSON.parse(options.body).instructions.includes('任务整理助手');
    return Response.json({ ...response(extracting ? { title: '周会', tasks: [{ title: '需求清单', sourceQuote: quote }] } : { answerTitle: '先核对需求', answerBody: '从纪要中的需求清单开始。', evidence: [quote], action: '列出验收标准', confidence: 70 }), model: 'actual-model' });
  } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('/api/minutes', { person: '', minutes })).status, 400);
    assert.equal((await post('/api/minutes', { person: '周宁', minutes: '字'.repeat(30001) })).status, 400); assert.equal(requests.length, 0);
    const extraction = await post('/api/minutes', { person: '周宁', minutes, task: 'question' });
    assert.equal(extraction.status, 200); assert.equal((await extraction.json()).meeting.tasks[0].sourceQuote, quote);
    assert.equal(requests[0].url, 'https://example.invalid/v1/responses'); assert.equal(requests[0].body.store, false);
    assert.equal(requests[0].body.model, 'configured-model'); assert.equal(requests[0].body.max_output_tokens, 6000);
    assert.equal(JSON.parse(requests[0].body.input).minutes, minutes);
    const context = `原始纪要：${minutes}\n当前任务：需求清单\n讨论：验收标准待确认`;
    assert.equal((await post('/api/chat', { question: '下一步？', expert: { id: 'product', name: '产品专家' }, context })).status, 200);
    assert.equal(JSON.parse(requests[1].body.input).context, context); assert.equal(requests[1].body.max_output_tokens, 4096);
    assert.equal((await post('/api/chat', { question: '', context })).status, 400);
    fail = true; const failed = await post('/api/minutes', { person: '周宁', minutes }); assert.equal(failed.status, 502);
    assert(!(await failed.text()).includes('server-only-secret'));
    const configText = await (await fetch(base + '/api/minutes/config')).text(); assert(!configText.includes('server-only-secret'));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
