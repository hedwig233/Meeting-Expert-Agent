import { test, expect } from '@playwright/test';
import { wavHeader } from '../server/asr.mjs';
import { mockWorkspaces } from './minutes-workspace-fixture.mjs';

test('shared enterprise knowledge uploads, previews and changes scope from either page', async ({ page }) => {
  await mockBridge(page);
  const docs = [{ id: 'd1', title: '团队规范', content: '先核对来源。', scope: 'shared' }];
  let rejectScope = true;
  await page.route('**/api/documents**', async route => {
    const request = route.request();
    if (request.method() === 'POST') {
      const doc = { id: 'd2', ...request.postDataJSON() }; docs.push(doc);
      return route.fulfill({ status: 201, json: doc });
    }
    if (request.method() === 'PATCH') {
      if (rejectScope) { rejectScope = false; return route.fulfill({ status: 503, json: { error: '保存失败，请重试' } }); }
      const doc = docs.find(item => request.url().endsWith('/' + item.id));
      Object.assign(doc, request.postDataJSON()); return route.fulfill({ json: doc });
    }
    return route.fulfill({ json: docs });
  });
  await page.goto('/');
  await expect(page.getByText('等待导入会议纪要', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '企业知识库', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '企业知识库' });
  await expect(dialog.getByText('团队规范', { exact: true })).toBeVisible();
  await dialog.getByLabel('上传知识范围').selectOption('technical');
  await dialog.locator('input[type=file]').setInputFiles({ name: '交付规范.md', mimeType: 'text/markdown', buffer: Buffer.from('先评审，再交付。') });
  await dialog.getByText('交付规范.md', { exact: true }).click();
  await expect(dialog.locator('pre').last()).toHaveText('先评审，再交付。');
  const scope = dialog.getByLabel('知识范围：交付规范.md');
  await expect(scope).toHaveValue('technical');
  await scope.selectOption('palace'); await expect(dialog.getByRole('alert')).toContainText('保存失败');
  await expect(scope).toHaveValue('technical');
  await scope.selectOption('palace'); await expect(scope).toHaveValue('palace');
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
  await page.getByRole('link', { name: '实时会议中枢', exact: true }).click();
  await expect(page.locator('h1')).toHaveText('让现场讨论，汇成共识。');
  await expect(page.locator('.bridge-knowledge')).toHaveCount(0);
  await page.getByRole('button', { name: '企业知识库', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '企业知识库' });
  await dialog.getByText('交付规范.md', { exact: true }).click();
  await expect(dialog.getByLabel('知识范围：交付规范.md')).toHaveValue('palace');
});

test('appearance settings persist across pages and reloads with matching typography and responsive themes', async ({ page }) => {
  await mockBridge(page); await page.goto('/');
  const typography = async () => {
    await expect(page.locator('.page-heading h1')).toBeVisible();
    return page.evaluate(() => ['.page-heading h1', '.page-heading p'].map(selector => {
      const style = getComputedStyle(document.querySelector(selector)); return [style.fontFamily, style.fontSize];
    }));
  };
  const background = () => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  const defaultType = await typography(); const darkBackground = await background();
  expect(darkBackground).toBe('rgb(11, 14, 21)');
  await page.getByRole('button', { name: '显示设置' }).click();
  let dialog = page.getByRole('dialog', { name: '显示设置' });
  await dialog.getByRole('radio', { name: '浅色模式' }).check();
  await dialog.getByRole('slider', { name: '字体大小' }).press('ArrowRight');
  await dialog.getByRole('slider', { name: '字体大小' }).press('ArrowRight');
  await dialog.getByRole('slider', { name: '页面缩放' }).press('ArrowRight');
  await dialog.getByRole('slider', { name: '页面缩放' }).press('ArrowRight');
  const largerType = await typography(); expect(parseFloat(largerType[1][1])).toBeGreaterThan(parseFloat(defaultType[1][1]));
  expect(await background()).not.toBe(darkBackground);
  await dialog.getByRole('button', { name: '完成' }).click();
  await page.getByRole('link', { name: '实时会议中枢', exact: true }).click();
  expect(await typography()).toEqual(largerType);
  await page.reload(); expect(await typography()).toEqual(largerType);
  await page.getByRole('button', { name: '显示设置' }).click();
  dialog = page.getByRole('dialog', { name: '显示设置' });
  await expect(dialog.getByRole('radio', { name: '浅色模式' })).toBeChecked();
  await expect(dialog.getByRole('slider', { name: '字体大小' })).toHaveValue('18');
  await expect(dialog.getByRole('slider', { name: '页面缩放' })).toHaveValue('110');
  await dialog.getByRole('radio', { name: '跟随系统' }).check();
  await page.emulateMedia({ colorScheme: 'dark' }); expect(await background()).toBe(darkBackground);
  await page.emulateMedia({ colorScheme: 'light' }); expect(await background()).not.toBe(darkBackground);
  await dialog.getByRole('button', { name: '恢复默认' }).click();
  await expect(dialog.getByRole('slider', { name: '字体大小' })).toHaveValue('16');
  await dialog.getByRole('radio', { name: '浅色模式' }).check();
  await dialog.getByRole('button', { name: '完成' }).click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: `test-results/workspace-bridge-light-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('link', { name: '专家会议室', exact: true }).click();
    const minutesType = await typography();
    await page.screenshot({ path: `test-results/workspace-minutes-light-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('link', { name: '实时会议中枢', exact: true }).click();
    expect(await typography()).toEqual(minutesType);
  }
});

async function mockBridge(page, withAudio = true) {
  const session = { id: 'bridge-test-session', title: '宫廷证据评审会', expertRole: 'evidence', status: 'active', segments: [], messages: [], decisions: [], audioSeconds: 0 };
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/config')) return route.fulfill({ json: { expert: 'qwen', provider: 'openai_next', asr: 'local', asrReady: true, asrModel: 'Whisper 本地分段转写', speech: true, model: 'gpt-5.6-terra', sources: 1 } });
    if (url.pathname.endsWith('/documents')) return route.fulfill({ json: [{ id: 'd1', title: '证据规范', content: '先核对水样来源。', origin: 'test' }] });
    if (url.pathname.endsWith('/expert')) return route.fulfill({ json: { id: 'm1', provider: 'openai_next', mode: 'qwen', request: '评审', contextSummary: '当前讨论涉及水样条件。', finding: '水样来源尚未确认，现有现象不足以支持结论。', impact: '条件变化可能影响观察。', question: '是否有独立检查记录？', proposal: '先核对水样来源再形成结论。', confidence: '需核验', citations: [{ id: 'c1', title: '证据规范', heading: '核验条件', text: '先核对水样来源。', documentId: 'd1', origin: 'test' }] } });
    if (url.pathname.endsWith('/speech')) return route.fulfill({ status: 200, contentType: 'audio/wav', body: Buffer.concat([wavHeader(4800, 24000), Buffer.alloc(4800)]) });
    if (url.pathname.endsWith('/cancel')) return route.fulfill({ json: { ok: true } });
    return route.fulfill({ json: session });
  });
  await mockWorkspaces(page);
  await page.addInitScript(({ withAudio }) => {
    window.__bridgeAudioFrames = 0; window.__routedSink = ''; window.__bridgeCaptureRequests = 0;
    HTMLMediaElement.prototype.setSinkId = async function(id) { window.__routedSink = id; };
    const makeStream = () => {
      const ctx = new AudioContext(); const destination = ctx.createMediaStreamDestination();
      const oscillator = ctx.createOscillator(); oscillator.frequency.value = 180; oscillator.connect(destination); oscillator.start();
      return destination.stream;
    };
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => makeStream() });
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { value: async () => [{ kind: 'audiooutput', deviceId: 'cable-input-test', label: 'CABLE Input (VB-Audio Virtual Cable)' }] });
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: async () => { window.__bridgeCaptureRequests++; return withAudio ? makeStream() : new MediaStream(); } });
    class FakeSocket extends EventTarget {
      static OPEN = 1; readyState = 0; bufferedAmount = 0; sentTranscript = false;
      constructor() { super(); window.__bridgeSocket = this; setTimeout(() => { this.readyState = 1; this.onopen?.(new Event('open')); }, 5); }
      receive(data) { const event = new MessageEvent('message', { data: JSON.stringify(data) }); this.onmessage?.(event); this.dispatchEvent(event); }
      send(data) {
        if (data instanceof ArrayBuffer) {
          window.__bridgeAudioFrames++;
          if (!this.sentTranscript && window.__bridgeAudioFrames > 3) {
            this.sentTranscript = true;
            this.receive({ type: 'segment', segment: { id: 's1', text: '我们正在讨论水样是否有独立检查记录。', speaker: '会议音频', start: 0, end: 1, source: 'local_whisper' } });
          }
          return;
        }
        const message = JSON.parse(data);
        if (message.type === 'stream.start') setTimeout(() => this.receive({ type: 'stream.ready' }), 5);
        if (message.type === 'stream.sync') setTimeout(() => this.receive({ type: 'stream.synced' }), 5);
      }
      close() { this.readyState = 3; this.onclose?.(); this.dispatchEvent(new Event('close')); }
    }
    window.WebSocket = FakeSocket;
  }, { withAudio });
}

test('desktop bridge captures real browser audio frames, displays suggestions, and selects the virtual output', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await mockBridge(page); await page.goto('/bridge.html');
  await expect(page.getByText('会议控制台连接就绪')).toBeVisible();
  await page.getByRole('button', { name: '识别输出设备' }).click();
  await expect(page.getByLabel('专家输出设备')).toHaveValue('cable-input-test');
  await page.getByRole('button', { name: '测试发言' }).click();
  await expect.poll(() => page.evaluate(() => window.__routedSink)).toBe('cable-input-test');
  await expect(page.getByRole('button', { name: '测试发言' })).toBeEnabled();
  await page.getByRole('button', { name: '监听腾讯会议' }).click();
  await expect(page.locator('.bridge-transcripts')).toContainText('独立检查记录');
  await expect(page.locator('.bridge-transcripts')).toContainText('Whisper 本地转写');
  await expect.poll(() => page.evaluate(() => window.__bridgeAudioFrames)).toBeGreaterThan(0);
  await page.getByRole('button', { name: '请专家发言', exact: true }).click();
  await expect(page.locator('.bridge-experts')).toContainText('水样来源尚未确认');
  await page.getByText('证据规范 · 核验条件').click();
  await expect(page.locator('.bridge-experts pre')).toContainText('先核对水样来源');
  await expect(page.getByRole('button', { name: '请专家发言', exact: true })).toBeEnabled();
  await page.screenshot({ path: 'test-results/seat-bridge.png', fullPage: true });
  await page.getByRole('button', { name: '停止监听', exact: true }).click();
  await expect(page.getByText('监听已停止，会议记录已保留')).toBeVisible();
  expect(errors).toEqual([]);
});
test('uninstalled local model is explained before requesting screen capture', async ({ page }) => {
  await mockBridge(page); await page.route('**/api/config', route => route.fulfill({ json: { expert: 'qwen', provider: 'openai_next', asr: 'local', asrReady: false, speech: true, model: 'gpt-5.6-terra' } }));
  await page.goto('/bridge.html'); await page.getByRole('button', { name: '监听腾讯会议' }).click();
  await expect(page.getByRole('alert')).toContainText('本地 Whisper 尚未安装');
  expect(await page.evaluate(() => window.__bridgeAudioFrames)).toBe(0);
});
test('screen sharing without an audio track fails visibly rather than showing false live transcription', async ({ page }) => {
  await mockBridge(page, false); await page.goto('/bridge.html');
  await page.getByRole('button', { name: '识别输出设备' }).click();
  await page.getByRole('button', { name: '监听腾讯会议' }).click();
  await expect(page.getByRole('alert')).toContainText('没有取得系统音频');
  await expect(page.getByRole('button', { name: '监听腾讯会议' })).toBeVisible();
  expect(await page.evaluate(() => window.__bridgeAudioFrames)).toBe(0);
});

async function startQwenBridge(page) {
  await mockBridge(page);
  await page.route('**/api/config', route => route.fulfill({ json: { expert: 'qwen', provider: 'openai_next', asr: 'next_omni', asrReady: true, asrModel: 'qwen3-omni-flash', speech: true, speechProvider: 'next_omni', speechModel: 'qwen3-omni-flash', speechVoice: 'Cherry', model: 'gpt-5.6-terra' } }));
  await page.goto('/bridge.html');
  await expect(page.getByText('会议控制台连接就绪')).toBeVisible();
  await page.getByRole('button', { name: '识别输出设备' }).click();
  await page.getByRole('button', { name: '监听腾讯会议' }).click();
  await expect.poll(() => page.evaluate(() => window.__bridgeAudioFrames)).toBeGreaterThan(3);
}

test('Qwen queue pressure resumes audio without requesting screen sharing again', async ({ page }) => {
  await startQwenBridge(page);
  await page.evaluate(() => window.__bridgeSocket.receive({ type: 'asr.state', pending: 3, processing: true, paused: true }));
  await expect(page.getByLabel('Qwen 转写状态')).toContainText('转写积压');
  const paused = await page.evaluate(() => window.__bridgeAudioFrames);
  await expect(page.getByLabel('Qwen 转写状态')).toContainText('系统音频未转写');
  expect(await page.evaluate(() => window.__bridgeAudioFrames)).toBe(paused);
  await expect(page.getByRole('button', { name: '停止监听', exact: true })).toBeVisible();
  await page.evaluate(() => window.__bridgeSocket.receive({ type: 'asr.state', pending: 1, processing: true, paused: false }));
  await expect.poll(() => page.evaluate(() => window.__bridgeAudioFrames)).toBeGreaterThan(paused);
  expect(await page.evaluate(() => window.__bridgeCaptureRequests)).toBe(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('Qwen expert speech displays its voice, pauses transmission while generating, and uses the virtual output', async ({ page }) => {
  await startQwenBridge(page);
  await expect(page.getByText(/专家语音：qwen3-omni-flash · Cherry/)).toBeVisible();
  let release; const held = new Promise(resolve => { release = resolve; });
  await page.route('**/api/sessions/*/speech', async route => { await held; await route.fallback(); });
  try {
    await page.getByRole('button', { name: '请专家发言', exact: true }).click();
    await expect(page.locator('.bridge-thinking')).toContainText('正在生成 Qwen 专家语音');
    const frames = await page.evaluate(() => window.__bridgeAudioFrames);
    await page.waitForTimeout(200); expect(await page.evaluate(() => window.__bridgeAudioFrames)).toBe(frames);
    release();
    await expect.poll(() => page.evaluate(() => window.__routedSink)).toBe('cable-input-test');
    await expect.poll(() => page.evaluate(() => window.__bridgeAudioFrames)).toBeGreaterThan(frames);
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally { release(); }
});

test('uncertain Qwen results clear temporary text and leave listening active', async ({ page }) => {
  await startQwenBridge(page);
  await page.evaluate(() => window.__bridgeSocket.receive({ type: 'partial', segment: { text: '[听不清]' } }));
  await expect(page.locator('.bridge-partial')).toContainText('[听不清]');
  const previous = await page.evaluate(() => window.__bridgeAudioFrames);
  await page.evaluate(() => window.__bridgeSocket.receive({ type: 'asr.notice', text: 'Qwen 未听清该片段，后续片段将继续识别。' }));
  await expect(page.locator('.bridge-partial')).toHaveCount(0);
  await expect(page.getByText('Qwen 未听清该片段，后续片段将继续识别。')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__bridgeAudioFrames)).toBeGreaterThan(previous);
  await expect(page.getByRole('button', { name: '停止监听', exact: true })).toBeVisible();
  await expect(page.locator('.bridge-transcripts')).not.toContainText('[听不清]');
});

test('queue recovery during an expert request cannot bypass the audio feedback guard', async ({ page }) => {
  await startQwenBridge(page);
  let release; const held = new Promise(resolve => { release = resolve; });
  await page.route('**/api/sessions/*/expert', async route => { await held; await route.fallback(); });
  try {
    await page.evaluate(() => window.__bridgeSocket.receive({ type: 'asr.state', pending: 3, processing: true, paused: true }));
    await page.getByRole('button', { name: '请专家发言', exact: true }).click();
    await expect(page.locator('.bridge-thinking')).toContainText('专家正在检索知识');
    await page.evaluate(() => window.__bridgeSocket.receive({ type: 'asr.state', pending: 0, processing: false, paused: false }));
    const frames = await page.evaluate(() => window.__bridgeAudioFrames);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__bridgeAudioFrames)).toBe(frames);
    release();
    await expect(page.locator('.bridge-experts')).toContainText('水样来源尚未确认');
    await expect.poll(() => page.evaluate(() => window.__bridgeAudioFrames)).toBeGreaterThan(frames);
  } finally { release(); }
});
