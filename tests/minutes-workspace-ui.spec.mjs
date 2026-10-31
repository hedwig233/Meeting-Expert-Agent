import { test, expect } from '@playwright/test';
import express from 'express';
import { once } from 'node:events';
import { join } from 'node:path';
import { createApplication } from '../server/app.mjs';
import { emptyWorkspace } from './minutes-workspace-fixture.mjs';

const quote = '周宁负责整理需求清单，本周五前完成。';
const fixture = { title: '迭代周会', summary: '核对需求', participants: ['周宁'], notice: '', tasks: [{ id: 'task-1', title: '整理需求清单', description: '整理需求', owner: '周宁', involvement: '负责人', deadline: '本周五', priority: 'high', sourceQuote: quote, expertId: 'product', expertReason: '核对需求', needsConfirmation: false }] };
const answer = { answerTitle: '先明确验收标准', answerBody: '先梳理范围，再确认验收条件。', evidence: [quote], action: '整理验收标准', confidence: 85 };
let application; let base;
test.beforeEach(async () => {
  application = createApplication({ root: process.cwd(), database: ':memory:' });
  application.app.use(express.static(join(process.cwd(), 'dist')));
  application.app.get('/{*path}', (req, res) => res.sendFile(join(process.cwd(), 'dist', 'index.html')));
  application.server.listen(0, '127.0.0.1'); await once(application.server, 'listening');
  base = 'http://127.0.0.1:' + application.server.address().port;
});
test.afterEach(async () => { await application.close(); });

async function importMeeting(page) {
  await page.route('**/api/minutes/config', route => route.fulfill({ json: { ready: true, model: 'test-model' } }));
  await page.route('**/api/minutes', route => route.fulfill({ json: { meeting: fixture, model: 'test-model' } }));
  await page.goto(base);
  await page.getByRole('button', { name: '导入纪要，整理我的任务', exact: true }).click();
  await page.getByLabel('本人姓名').fill('周宁'); await page.getByLabel('纪要文本', { exact: true }).fill(quote);
  await page.getByRole('button', { name: '提取我的任务', exact: true }).click();
  await expect(page.locator('.task-card')).toHaveCount(1);
}
const saved = page => expect(page.getByLabel('工作台保存状态')).toContainText('已保存到本机 SQLite');

test('an old backend reports restart instructions, allows navigation, and retains pending edits until retry succeeds', async ({ page }) => {
  const id = 'b9646a71-87e4-4142-bf42-7e4a1d0e47fe';
  const cached = JSON.stringify({ ...emptyWorkspace(), person: '周宁', minutes: quote });
  await page.addInitScript(({ id, cached }) => {
    sessionStorage.setItem('seat-minutes-workspace', id);
    if (!sessionStorage.getItem('seat-minutes-pending-' + id)) sessionStorage.setItem('seat-minutes-pending-' + id, cached);
  }, { id, cached });
  let available = false; let writes = 0;
  await page.route('**/api/minutes/workspaces/*', route => {
    if (route.request().method() === 'PUT') writes++;
    return available ? route.fallback() : route.fulfill({ status: 404, json: { error: '接口不存在。' } });
  });
  await page.goto(base);
  await expect(page.getByRole('alert')).toContainText('请重启后端服务');
  await expect(page.getByRole('status')).toHaveText('纪要工作台恢复失败');
  await expect(page.getByRole('button', { name: '导入纪要，整理我的任务', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '实时会议中枢', exact: true }).click();
  await expect(page.locator('h1')).toContainText('让现场讨论');
  await page.getByRole('link', { name: '专家会议室', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('请重启后端服务');
  expect(writes).toBe(0);
  expect(await page.evaluate(id => sessionStorage.getItem('seat-minutes-pending-' + id), id)).toBe(cached);
  available = true; await page.getByRole('button', { name: '重试恢复' }).click();
  await page.getByRole('button', { name: '导入纪要，整理我的任务', exact: true }).click();
  await expect(page.getByLabel('本人姓名')).toHaveValue('周宁');
  await expect(page.getByLabel('纪要文本', { exact: true })).toHaveValue(quote);
  await saved(page);
  expect((await (await page.request.get(base + '/api/minutes/workspaces/' + id)).json()).workspace.minutes).toBe(quote);
});

test('SQLite restores tasks, experts, answers, confirmation, discussion and drafts across navigation and refresh; clearing persists', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/chat', route => { calls++; return route.fulfill({ json: { answer, model: 'test-model' } }); });
  await importMeeting(page);
  await page.getByLabel('标记任务完成：整理需求清单').check();
  const composer = page.getByLabel('任务讨论与专家提问');
  await composer.fill('验收范围还需确认'); await page.getByRole('button', { name: '发送讨论' }).click();
  await page.getByRole('button', { name: '邀请专家加入', exact: true }).click();
  await page.getByRole('button', { name: '添加并准备提问' }).click(); await page.getByRole('button', { name: '发送讨论' }).click();
  await expect(page.locator('.expert-panel .finding')).toContainText(answer.answerBody);
  await page.locator('.expert-panel').getByText('建议动作', { exact: true }).click();
  await page.locator('.expert-panel').getByRole('button', { name: '确认建议动作' }).click();
  await page.getByRole('button', { name: '确认并模拟执行' }).click();
  await page.getByRole('button', { name: '取消任务选择' }).click();
  await page.getByLabel('搜索专家回答').fill('验收'); await composer.fill('@产品专家 尚未发送的问题');
  await page.getByRole('link', { name: '实时会议中枢', exact: true }).click();
  await expect(page.locator('h1')).toContainText('让现场讨论');
  await page.getByRole('link', { name: '专家会议室', exact: true }).click();
  await expect(page.locator('.tabs button.selected')).toContainText('任务讨论');
  await page.getByRole('button', { name: /我的任务/ }).click();
  await expect(page.getByLabel('标记任务完成：整理需求清单')).toBeChecked();
  await page.getByRole('button', { name: /任务讨论/ }).click();
  await expect(composer).toHaveValue('@产品专家 尚未发送的问题');
  await expect(page.locator('.selected-task-bar')).toContainText('整份会议纪要');
  await expect(page.getByLabel('搜索专家回答')).toHaveValue('验收');
  await expect(page.locator('.expert-panel')).toContainText('已确认 · 模拟执行');
  await expect(page.locator('.transcript-scroll')).toContainText('验收范围还需确认');
  await composer.fill('@产品专家 刚刚修改的草稿'); await page.reload();
  await expect(composer).toHaveValue('@产品专家 刚刚修改的草稿'); await saved(page);
  expect(calls).toBe(1);
  const id = await page.evaluate(() => sessionStorage.getItem('seat-minutes-workspace'));
  const stored = await (await page.request.get(base + '/api/minutes/workspaces/' + id)).json();
  expect(stored.workspace.meeting.minutes).toBe(quote); expect(stored.workspace.tasks[0].completed).toBe(true);
  expect(stored.workspace.records[0].confirmed).toBe(true); expect(stored.workspace.records[0].answer).toEqual(answer);
  await page.getByRole('button', { name: '清空工作台', exact: true }).click();
  await page.getByRole('button', { name: '清空并导入新纪要' }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click(); await page.reload();
  await expect(page.locator('.task-card')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '导入纪要，整理我的任务', exact: true })).toBeVisible(); await saved(page);
  expect((await (await page.request.get(base + '/api/minutes/workspaces/' + id)).json()).workspace).toEqual(emptyWorkspace());
});

test('saved in-flight answers restore as interrupted without automatic model requests and can be retried', async ({ page }) => {
  const id = 'c7b6c4ba-ec22-4d71-bc74-5d69ec6c70d1';
  const expert = { id: 'product', key: 'product', name: '产品专家', description: '核对需求' };
  const workspace = { ...emptyWorkspace(), meeting: { ...fixture, person: '周宁', minutes: quote, model: 'test-model' }, tasks: fixture.tasks, experts: [expert], activeExpert: expert.key, records: [{ id: 'r1', expert, task: fixture.tasks[0], text: '下一步？', displayText: '@产品专家 下一步？', context: quote, status: 'loading' }], discussion: [{ id: 'r1', text: '@产品专家 下一步？', taskTitle: fixture.tasks[0].title, taskId: 'task-1' }] };
  expect((await page.request.put(base + '/api/minutes/workspaces/' + id, { data: { workspace, revision: 0 } })).ok()).toBe(true);
  await page.addInitScript(id => sessionStorage.setItem('seat-minutes-workspace', id), id);
  let calls = 0; await page.route('**/api/chat', route => { calls++; return route.fulfill({ json: { answer, model: 'test-model' } }); });
  await page.goto(base); await expect(page.locator('.expert-panel')).toContainText('上一次回答因页面离开或刷新中断');
  expect(calls).toBe(0);
  await page.locator('.expert-panel').getByRole('button', { name: '重试回答' }).click();
  await expect(page.locator('.expert-panel .finding')).toContainText(answer.answerBody); expect(calls).toBe(1);
});

test('save errors remain visible, prevent navigation and allow retry without losing edits', async ({ page }) => {
  await importMeeting(page); await saved(page);
  let fail = true;
  await page.route('**/api/minutes/workspaces/*', route => route.request().method() === 'PUT' && fail ? route.fulfill({ status: 503, json: { error: '本机数据库暂时不可用' } }) : route.fallback());
  await page.getByLabel('标记任务完成：整理需求清单').check();
  await expect(page.getByRole('alert')).toContainText('工作台尚未保存');
  await page.getByRole('link', { name: '实时会议中枢', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('本机数据库暂时不可用'); expect(page.url()).toBe(base + '/');
  await expect(page.getByLabel('标记任务完成：整理需求清单')).toBeChecked();
  fail = false; await page.reload();
  await expect(page.getByLabel('标记任务完成：整理需求清单')).toBeChecked(); await saved(page);
  fail = true; await page.getByLabel('标记任务完成：整理需求清单').uncheck();
  await expect(page.getByRole('alert')).toContainText('工作台尚未保存');
  fail = false; await page.getByRole('button', { name: '重试保存' }).click(); await saved(page);
  await page.reload(); await expect(page.getByLabel('标记任务完成：整理需求清单')).not.toBeChecked();
});
