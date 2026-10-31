import { test, expect } from '@playwright/test';
import { mockWorkspaces } from './minutes-workspace-fixture.mjs';

const quote = '周宁负责整理需求清单，本周五前完成，优先级高。';
const minutes = `迭代周会\n参会人：周宁、林晓\n${quote}\n林晓负责发布。`;
const fixture = { title: '迭代周会', summary: '确认需求和交付分工。', participants: ['周宁', '林晓'], notice: '', tasks: [{ id: 'task-1', title: '整理需求清单', description: '整理新版工作台需求并评审', owner: '周宁', involvement: '负责人', deadline: '本周五', priority: 'high', sourceQuote: quote, expertId: 'product', expertReason: '协助拆解验收范围', needsConfirmation: false }] };

async function mockMinutes(page) {
  await mockWorkspaces(page);
  await page.route('**/api/minutes/config', route => route.fulfill({ json: { ready: true, model: 'test-model' } }));
  await page.route('**/api/minutes', route => route.fulfill({ json: { meeting: fixture, model: 'test-model' } }));
}
async function importMeeting(page, fromFile = false) {
  await page.getByRole('button', { name: '导入纪要，整理我的任务' }).click();
  await page.getByLabel('本人姓名').fill('周宁');
  if (fromFile) {
    await page.getByRole('dialog').locator('input[type=file]').setInputFiles({ name: '会议纪要.txt', mimeType: 'text/plain', buffer: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(minutes, 'utf16le')]) });
    await expect(page.getByLabel('纪要文本', { exact: true })).toHaveValue(minutes);
  } else await page.getByLabel('纪要文本', { exact: true }).fill(minutes);
  await page.getByRole('button', { name: '提取我的任务', exact: true }).click();
  await expect(page.locator('.task-card')).toHaveCount(1);
}

test('minutes, personal tasks, optional experts, mention routing, retries, evidence and confirmation', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message)); const requests = []; let fail = false;
  await mockMinutes(page);
  await page.route('**/api/chat', async route => {
    requests.push(route.request().postDataJSON());
    if (fail) { fail = false; return route.fulfill({ status: 502, json: { error: '模型暂时不可用' } }); }
    await route.fulfill({ json: { model: 'test-model', answer: { answerTitle: '先明确验收标准', answerBody: '先梳理范围，再确认业务验收条件。', evidence: [quote], action: '整理验收标准供周会确认', confidence: 85 } } });
  });
  await page.goto('/'); await expect(page.getByRole('button', { name: '邀请专家加入', exact: true })).toBeDisabled();
  await importMeeting(page); expect(requests).toHaveLength(0);
  await page.getByText('查看纪要原文依据', { exact: true }).click(); await expect(page.locator('.task-source blockquote')).toHaveText(quote);
  await page.getByLabel('标记任务完成：整理需求清单').check(); await expect(page.locator('.session-indicator')).toContainText('0 项待办');
  const composer = page.getByLabel('任务讨论与专家提问');
  await composer.fill('验收范围还需要确认'); await page.getByRole('button', { name: '发送讨论' }).click(); expect(requests).toHaveLength(0);
  await composer.fill('@林晓 请核对验收范围'); await page.getByRole('button', { name: '发送讨论' }).click(); expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: /我的任务/ }).click(); await page.getByRole('button', { name: '请专家协助', exact: true }).click();
  await expect(page.getByRole('dialog').locator('.selected')).toContainText('产品专家');
  await page.getByRole('button', { name: '添加并准备提问' }).click(); expect(requests).toHaveLength(0);
  await expect(composer).toHaveValue(/@产品专家/); await page.getByRole('button', { name: '发送讨论' }).click();
  await expect(page.locator('.expert-panel .finding')).toContainText('先明确验收标准'); expect(requests).toHaveLength(1);
  expect(requests[0].context).toContain(minutes); expect(requests[0].context).toContain('验收范围还需要确认'); expect(requests[0].context).toContain('整理需求清单');
  await page.getByLabel('搜索专家回答').fill('不存在的关键词'); await expect(page.getByText('没有匹配的回答')).toBeVisible();
  await page.getByLabel('搜索专家回答').fill('验收'); await expect(page.locator('.expert-panel .finding')).toHaveCount(1);
  await page.locator('.expert-panel').getByText('参考依据 · 1 条').click(); await expect(page.locator('.expert-panel blockquote')).toHaveText(quote);
  await page.locator('.expert-panel').getByText('建议动作', { exact: true }).click(); await page.locator('.expert-panel').getByRole('button', { name: '确认建议动作' }).click();
  await page.getByRole('button', { name: '确认并模拟执行' }).click(); await expect(page.locator('.expert-panel')).toContainText('已确认 · 模拟执行');
  await page.getByLabel('搜索专家回答').fill('');
  fail = true; await composer.fill('@产品专家 还有哪些风险？'); await page.getByRole('button', { name: '发送讨论' }).click();
  await page.locator('.expert-panel').getByRole('button', { name: '重试回答' }).click(); await expect(page.locator('.expert-panel .finding')).toHaveCount(2); expect(requests).toHaveLength(3);
  await composer.fill('@'); await expect(page.getByRole('listbox')).toContainText('产品专家'); await page.getByRole('option', { name: /产品专家/ }).click(); await expect(composer).toHaveValue('@产品专家 ');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '导出会议记录' }).click(); expect((await download).suggestedFilename()).toBe('meeting-tasks.md');
  await page.screenshot({ path: 'test-results/seat-minutes-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('failed reimport preserves work; custom expert, whole-meeting scope and reset work on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await mockMinutes(page); await page.goto('/'); await importMeeting(page, true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '重新导入会议纪要' }).click();
  await page.route('**/api/minutes', route => route.fulfill({ status: 502, json: { error: '提取失败，请重试' } }));
  await page.getByRole('button', { name: '提取我的任务', exact: true }).click(); await expect(page.getByRole('dialog')).toContainText('提取失败');
  await page.getByRole('button', { name: '取消', exact: true }).click(); await expect(page.locator('.task-card')).toHaveCount(1);
  await page.getByRole('button', { name: '取消任务选择' }).click(); await page.getByRole('button', { name: '邀请专家加入', exact: true }).click();
  await page.getByLabel('自定义专家角色').fill('项目管理专家'); await page.getByRole('button', { name: '添加并准备提问' }).click();
  await expect(page.locator('.expert-tabs')).toContainText('项目管理专家'); await expect(page.locator('.selected-task-bar')).toContainText('整份会议纪要');
  await page.screenshot({ path: 'test-results/seat-minutes-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '移除项目管理专家' }).click(); await expect(page.locator('.expert-tabs')).toHaveCount(0);
  await page.getByRole('button', { name: '清空工作台', exact: true }).click(); await page.getByRole('button', { name: '清空并导入新纪要' }).click(); await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('.task-card')).toHaveCount(0); await expect(page.getByRole('button', { name: '导入纪要，整理我的任务' })).toBeVisible();
});
