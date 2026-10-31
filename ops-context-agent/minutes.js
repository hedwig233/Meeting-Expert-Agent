// Imported minutes stay in memory. Only display preferences use localStorage.
const minutesDraft = { person: '周宁', minutes: '', filename: '' };
let importSequence = 0;
let importController = null;

function cancelMinutesImport() {
  importSequence += 1;
  importController?.abort();
  importController = null;
}
function selectedTask() {
  return state.tasks.find(task => task.id === state.selectedTaskId) || null;
}
function openMinutesImport() {
  cancelMinutesImport();
  if (!minutesDraft.minutes && state.meeting) {
    minutesDraft.minutes = state.meeting.minutes;
    minutesDraft.person = state.person;
  }
  openModal(`<div class="minutes-import"><div class="eyebrow">STEP 01 · IMPORT</div><h3>导入会议纪要</h3><p>填写纪要中使用的本人姓名，GPT 会整理你负责、协作或需要确认的任务。</p><label class="field-label" for="minutesPerson">本人姓名</label><input id="minutesPerson" class="minutes-person" maxlength="40" value="${escapeHtml(minutesDraft.person)}" placeholder="与纪要里的姓名一致，例如：周宁"><div class="minutes-input-head"><label class="field-label" for="minutesText">纪要文本</label><label class="file-button">导入 .txt / .md<input id="minutesFile" type="file" accept=".txt,.md,.markdown,.text,text/plain,text/markdown"></label></div><textarea id="minutesText" maxlength="30000" rows="10" placeholder="粘贴会议纪要，保留负责人、截止时间等原始信息…">${escapeHtml(minutesDraft.minutes)}</textarea><div class="minutes-input-foot"><span id="minutesFileName">${escapeHtml(minutesDraft.filename || '支持 UTF-8、UTF-16、GB18030 文本')}</span><span id="minutesLength"></span></div><div id="minutesError" class="import-error" role="alert" hidden></div><p class="import-notice">点击提取后，纪要和姓名会发送给当前配置的 GPT 服务。重新提取成功后将替换当前任务、讨论和专家记录；刷新页面后需重新导入。</p><div class="modal-actions"><button class="button ghost" id="sampleMinutes">填入示例</button><button class="button ghost" data-close-modal>取消</button><button class="button primary" id="extractTasks">提取我的任务</button></div><div id="minutesProgress" class="import-progress" role="status" hidden>GPT 正在阅读纪要、核对任务归属，请稍候…</div></div>`);
  const updateDraft = () => {
    minutesDraft.person = $('#minutesPerson').value;
    minutesDraft.minutes = $('#minutesText').value;
    $('#minutesLength').textContent = `${minutesDraft.minutes.length.toLocaleString()} / 30,000 字`;
  };
  $('#minutesPerson').addEventListener('input', updateDraft);
  $('#minutesText').addEventListener('input', () => { minutesDraft.filename = ''; $('#minutesFileName').textContent = '已编辑文本'; updateDraft(); });
  $('#sampleMinutes').addEventListener('click', () => {
    $('#minutesPerson').value = '周宁';
    $('#minutesText').value = '产品迭代周会纪要\n参会人：周宁、林晓、张三\n1. 周宁负责整理新版工作台的需求清单，本周五前提交评审，优先级高。\n2. 张三负责数据库迁移方案，周宁协助确认业务验收范围，下周三前完成。\n3. 林晓负责更新帮助文档，周宁上周已完成旧版文档的校对。\n4. 团队建议由周宁牵头梳理跨部门反馈，负责人和截止时间仍待确认。';
    minutesDraft.filename = '';
    $('#minutesFileName').textContent = '示例纪要 · 可自由修改';
    updateDraft();
  });
  $('#minutesFile').addEventListener('change', readMinutesFile);
  $('#extractTasks').addEventListener('click', extractMyTasks);
  updateDraft();
  $('#minutesPerson').focus();
}
function importError(message) {
  const node = $('#minutesError');
  if (!node) return;
  node.textContent = message;
  node.hidden = !message;
}
async function readMinutesFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const form = $('#minutesText');
  const sequence = importSequence;
  try {
    if (!/\.(txt|md|markdown|text)$/i.test(file.name)) throw new Error('请选择 .txt 或 .md 文本文件；其他格式请先复制为文本。');
    if (file.size > 200000) throw new Error('文件过大，请导入不超过 30,000 字的纪要文本。');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let content;
    if (bytes[0] === 0xff && bytes[1] === 0xfe) content = new TextDecoder('utf-16le').decode(bytes);
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) content = new TextDecoder('utf-16be').decode(bytes);
    else {
      try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { content = new TextDecoder('gb18030', { fatal: true }).decode(bytes); }
    }
    if (content.includes('\0')) throw new Error('文件包含非文本内容，请另存为 UTF-8 文本后重试。');
    if (content.length > 30000) throw new Error('纪要超过 30,000 字，请精简或分段导入。');
    if (sequence !== importSequence || form !== $('#minutesText')) return;
    form.value = content;
    minutesDraft.minutes = content;
    minutesDraft.filename = file.name;
    $('#minutesFileName').textContent = file.name;
    $('#minutesLength').textContent = `${content.length.toLocaleString()} / 30,000 字`;
    importError('');
  } catch (error) {
    if (sequence === importSequence && form === $('#minutesText')) importError(error.message);
  } finally { event.target.value = ''; }
}
async function extractMyTasks() {
  const person = $('#minutesPerson').value.trim();
  const minutes = $('#minutesText').value.trim();
  if (!person) { importError('请填写本人在纪要中的姓名。'); $('#minutesPerson').focus(); return; }
  if (!minutes) { importError('请先粘贴或导入会议纪要。'); $('#minutesText').focus(); return; }
  if (minutes.length > 30000) return importError('纪要不能超过 30,000 字。');
  cancelMinutesImport();
  const sequence = importSequence;
  const controller = new AbortController();
  importController = controller;
  const timeout = setTimeout(() => controller.abort(), 100000);
  importError('');
  $('#minutesProgress').hidden = false;
  $$('#modalContent input, #modalContent textarea, #extractTasks, #sampleMinutes').forEach(node => node.disabled = true);
  $('#extractTasks').textContent = '正在提取…';
  try {
    const response = await fetch('/api/minutes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ person, minutes }), signal: controller.signal });
    const payload = await response.json();
    if (!response.ok || !payload.meeting || !Array.isArray(payload.meeting.tasks)) throw new Error(payload.error || `任务提取失败（HTTP ${response.status}）`);
    if (sequence !== importSequence) return;
    resetDemo(false);
    state.person = person;
    state.meeting = { ...payload.meeting, minutes, model: payload.model || 'GPT' };
    state.tasks = payload.meeting.tasks.map(task => ({ ...task, completed: false }));
    state.selectedTaskId = state.tasks[0]?.id || null;
    minutesDraft.person = person;
    minutesDraft.minutes = minutes;
    renderMinutesWorkspace();
    renderAgent();
    showToast(`已整理 ${state.tasks.length} 项与你相关的任务，请核对原文`);
  } catch (error) {
    if (sequence !== importSequence) return;
    importError(error.name === 'AbortError' ? '任务提取超时，请重试或缩短纪要。' : error.message || '提取失败，请检查服务后重试。');
  } finally {
    clearTimeout(timeout);
    if (sequence === importSequence && $('#extractTasks')) {
      importController = null;
      $$('#modalContent input, #modalContent textarea, #extractTasks, #sampleMinutes').forEach(node => node.disabled = false);
      $('#extractTasks').textContent = '重试提取我的任务';
      $('#minutesProgress').hidden = true;
    }
  }
}
function resetMinutesWorkspace() {
  cancelMinutesImport();
  state.meeting = null;
  state.tasks = [];
  state.selectedTaskId = null;
  state.person = '周宁';
  renderMinutesWorkspace();
}
function selectTask(id) {
  state.selectedTaskId = state.tasks.some(task => task.id === id) ? id : null;
  renderMinutesWorkspace();
  renderAgent();
}
function renderMinutesWorkspace() {
  const meeting = state.meeting;
  const task = selectedTask();
  const pending = state.tasks.filter(item => !item.completed).length;
  $('#workspaceTitle').textContent = meeting?.title || '把会议纪要，变成你的行动清单';
  $('#workspaceSubtitle').textContent = meeting ? `${state.person}的任务安排 · ${state.tasks.length} 项相关任务，${pending} 项待办` : '先整理与自己相关的安排，再按需请专家协助。';
  $('#sideMeetingTitle').textContent = meeting?.title || '尚未导入';
  $('#sidePersonLabel').textContent = meeting ? `本人：${state.person}` : '先找到与自己相关的安排';
  $('#sideTaskCount').textContent = String(pending);
  $('#userName').textContent = `${state.person} · 本人`;
  $('#userInitial').textContent = state.person.slice(0, 1);
  $('#importMinutes').textContent = meeting ? '↥ 重新导入 / 更改姓名' : '＋ 导入会议纪要';
  $('#stepImport').classList.toggle('done', !!meeting);
  $('#stepImport').classList.toggle('active', !meeting);
  $('#stepTasks').classList.toggle('active', !!meeting);
  $('#stepExpert').classList.toggle('active', state.experts.length > 0);
  $('#taskStepLabel').textContent = meeting ? `${state.tasks.length} 项相关 · ${pending} 项待办` : '根据姓名提取安排';
  $('#meetingInput').disabled = !meeting;
  $('#sendMeeting').disabled = !meeting;
  $('#meetingInput').placeholder = meeting ? '记录任务问题，输入 @ 选择成员或专家…' : '先导入纪要，再记录问题或 @专家提问…';
  const workspace = $('#taskWorkspace');
  if (!meeting) {
    workspace.innerHTML = `<div class="minutes-empty"><span class="empty-document">▤</span><h3>从一份会议纪要开始</h3><p>不必翻找整场讨论。导入纪要后，先看清自己要做什么、何时完成，以及需要谁来协助。</p><button class="button primary" data-open-import>导入纪要，整理我的任务</button><small>支持粘贴文本和 .txt / .md 文件</small><div class="empty-features"><span>✓ 按姓名识别分工</span><span>✓ 原文依据可核对</span><span>✓ 专家按需介入</span></div></div>`;
  } else {
    const cards = state.tasks.map(item => `<article class="task-card ${item.id === state.selectedTaskId ? 'selected' : ''} ${item.completed ? 'completed' : ''}" data-task-card="${escapeHtml(item.id)}"><div class="task-card-top"><label class="task-check"><input type="checkbox" data-complete-task="${escapeHtml(item.id)}" ${item.completed ? 'checked' : ''} aria-label="标记任务完成：${escapeHtml(item.title)}"><span>${item.completed ? '已完成' : '待办'}</span></label><span class="task-involvement">${escapeHtml(item.involvement)}</span>${item.needsConfirmation ? '<span class="task-uncertain">分工待确认</span>' : ''}${item.priority !== 'unspecified' ? `<span class="task-priority">${escapeHtml(({ high: '高', medium: '中', low: '低' })[item.priority] || '未注明')}优先级</span>` : ''}</div><button type="button" class="task-select" data-select-task="${escapeHtml(item.id)}" aria-pressed="${item.id === state.selectedTaskId}"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p></button><div class="task-facts"><span>负责人 <b>${escapeHtml(item.owner)}</b></span><span>截止 <b>${escapeHtml(item.deadline)}</b></span></div><details class="task-source"><summary>查看纪要原文依据</summary><blockquote>${escapeHtml(item.sourceQuote)}</blockquote></details><div class="task-expert-suggestion"><p>${escapeHtml(item.expertReason)}</p><button type="button" data-task-expert="${escapeHtml(item.id)}">请专家协助 ↗</button></div></article>`).join('');
    workspace.innerHTML = `<div class="minutes-summary"><div><b>与 ${escapeHtml(state.person)} 相关的任务</b><button class="text-button" data-show-minutes>查看原始纪要 ↗</button></div>${meeting.summary ? `<p>${escapeHtml(meeting.summary)}</p>` : ''}<small>由 ${escapeHtml(meeting.model)} 整理 · 请结合原文核对分工与截止时间</small></div>${meeting.notice ? `<p class="task-notice">${escapeHtml(meeting.notice)}</p>` : ''}<div class="task-list">${cards || `<div class="no-tasks"><h3>未找到明确分配给你的任务</h3><p>检查姓名是否与纪要一致，或查看原文确认是否记录了你的安排。不会将其他人的工作自动指派给你。</p><button class="button ghost" data-open-import>更改姓名 / 重新导入</button></div>`}</div><div class="discussion-divider"><span>任务讨论</span><small>选择任务后记录问题，需要时再 @专家</small></div>`;
  }
  const bar = $('#selectedTaskBar');
  bar.hidden = !meeting;
  bar.innerHTML = task ? `<div><small>当前讨论任务</small><b>${escapeHtml(task.title)}</b></div><button type="button" data-clear-task aria-label="取消任务选择" title="改为讨论整份纪要">×</button>` : '<div><small>当前讨论范围</small><b>整份会议纪要 · 点击任务标题可切换</b></div>';
  updateMeetingStats();
}
function showMinutesSource() {
  if (!state.meeting) return openMinutesImport();
  openModal(`<h3>原始会议纪要</h3><p>当前本人：${escapeHtml(state.person)} · 下列原文与当前任务一同提供给专家。</p><pre class="minutes-source-text">${escapeHtml(state.meeting.minutes)}</pre><div class="modal-actions"><button class="button ghost" id="editImportedMinutes">更改姓名 / 重新提取</button><button class="button primary" data-close-modal>返回工作台</button></div>`);
  $('#editImportedMinutes').addEventListener('click', openMinutesImport);
}
function prefillExpertQuestion(expert) {
  const task = selectedTask();
  if (!task) return;
  const input = $('#meetingInput');
  input.value = `@${expert.name} 请帮我分析任务「${task.title}」的难点、风险和下一步安排。`;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  updateComposerHighlight();
  closeMemberMentions();
}
function initializeMinutesWorkflow() {
  $('#importMinutes').addEventListener('click', openMinutesImport);
  $('#viewMinutes').addEventListener('click', showMinutesSource);
  document.addEventListener('click', event => {
    if (event.target.closest('[data-open-import]')) openMinutesImport();
    if (event.target.closest('[data-show-minutes]')) showMinutesSource();
    const select = event.target.closest('[data-select-task]');
    if (select) selectTask(select.dataset.selectTask);
    const assist = event.target.closest('[data-task-expert]');
    if (assist) { selectTask(assist.dataset.taskExpert); inviteAgent(); }
    if (event.target.closest('[data-clear-task]')) selectTask(null);
  });
  document.addEventListener('change', event => {
    const id = event.target.dataset.completeTask;
    if (!id) return;
    const task = state.tasks.find(item => item.id === id);
    if (task) { task.completed = event.target.checked; renderMinutesWorkspace(); }
  });
  renderMinutesWorkspace();
}
