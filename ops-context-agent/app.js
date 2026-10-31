const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = { meeting: null, person: '周宁', tasks: [], selectedTaskId: null, agent: 'idle', pendingQuestion: '', questionAsked: false, answerShown: false, answerPhase: 'none', questions: [], messages: [], nextQuestionId: 1, experts: [], activeExpertId: 'ops', executionCount: 0, nextExpertSession: 1 };

function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
function formatMentions(value) {
  const text = String(value ?? '');
  const names = [...new Set([...getMeetingMembers().map(member => member.name), ...state.questions.map(record => record.expertName)])].filter(Boolean).sort((a, b) => b.length - a.length);
  if (!names.length) return escapeHtml(text);
  const pattern = names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const matcher = new RegExp(`(^|\\s)@(${pattern})(?=$|[\\s，。！？、,:：!?])`, 'g');
  let result = '', end = 0;
  for (const match of text.matchAll(matcher)) {
    const start = match.index + match[1].length;
    result += escapeHtml(text.slice(end, start)) + `<span class="member-mention">${escapeHtml(`@${match[2]}`)}</span>`;
    end = match.index + match[0].length;
  }
  return result + escapeHtml(text.slice(end));
}
function updateComposerHighlight() {
  const input = $('#meetingInput');
  const highlight = $('#meetingInputHighlight');
  if (!input || !highlight) return;
  highlight.innerHTML = `<span>${formatMentions(input.value)}</span>`;
  highlight.firstElementChild.style.transform = `translateX(${-input.scrollLeft}px)`;
}
function showToast(text) { $('#toastText').textContent = text; $('#toast').classList.add('show'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => $('#toast').classList.remove('show'), 2500); }
function openModal(html) { $('#modalContent').innerHTML = html; $('#modalBackdrop').classList.add('open'); $('#modalBackdrop').setAttribute('aria-hidden', 'false'); }
function closeModal() {
  if ($('#minutesText')) cancelMinutesImport();
  $('#modalBackdrop').classList.remove('open');
  $('#modalBackdrop').setAttribute('aria-hidden', 'true');
  $('#modalContent').innerHTML = '';
}

function setActiveExpert(expert) {
  state.expert = expert || expertCatalog.ops;
  state.activeExpertId = state.expert.id;
  state.agent = state.expert.status || 'idle';


}
function loadExpertContext(expert) {
  expert.meetingContext = buildMeetingContext();
  expert.status = 'ready';
  renderAgent();
}
function resolveQuestionTarget(rawQuestion) {
  const members = getMeetingMembers().sort((a, b) => b.name.length - a.name.length);
  const matches = members.map(member => {
    const token = `@${member.name}`;
    let index = rawQuestion.indexOf(token);
    while (index >= 0) {
      const before = rawQuestion[index - 1];
      const after = rawQuestion[index + token.length];
      if ((!before || /\s/.test(before)) && (!after || /[\s，。！？、,:：!?]/.test(after))) return { member, index, token };
      index = rawQuestion.indexOf(token, index + 1);
    }
    return null;
  }).filter(Boolean).sort((a, b) => a.index - b.index);
  const firstMention = rawQuestion.match(/(?:^|\s)@([^\s]+)/);
  const match = matches[0];
  if (firstMention && (!match || firstMention.index < match.index - 1)) {
    showToast('请选择已参加会议的成员；专家需先加入会议');
    return null;
  }
  if (match) {
    const text = (rawQuestion.slice(0, match.index) + rawQuestion.slice(match.index + match.token.length)).trim();
    if (!text) { showToast('请在 @成员 后输入消息或问题'); return null; }
    return { expert: match.member.expert, member: match.member, text, mention: match.token };
  }
  return { text: rawQuestion, mention: '' };
}
function updateExpertMentions() {
  updateComposerHighlight();
  if (!$('#memberMentions')?.hidden) renderMemberMentions();
}
function getMeetingMembers() {
  const members = new Map();
  state.experts.forEach(expert => members.set(expert.name, { name: expert.name, role: '专家 Agent', expert }));
  (state.meeting?.participants || []).forEach(name => {
    if (!members.has(name)) members.set(name, { name, role: name === state.person ? '本人' : '纪要中的参会成员' });
  });
  return [...members.values()];
}
const mentionState = { candidates: [], activeIndex: 0, start: 0, end: 0 };
function closeMemberMentions() {
  const menu = $('#memberMentions');
  if (menu) menu.hidden = true;
  const input = $('#meetingInput');
  input?.setAttribute('aria-expanded', 'false');
  input?.removeAttribute('aria-activedescendant');
  mentionState.candidates = [];
}
function highlightMemberMention() {
  $$('#memberMentions [data-member-index]').forEach((option, index) => {
    const active = index === mentionState.activeIndex;
    option.classList.toggle('selected', active);
    option.setAttribute('aria-selected', String(active));
    if (active) {
      $('#meetingInput').setAttribute('aria-activedescendant', option.id);
      option.scrollIntoView({ block: 'nearest' });
    }
  });
}
function renderMemberMentions() {
  const input = $('#meetingInput');
  const menu = $('#memberMentions');
  if (!input || !menu || document.activeElement !== input) return closeMemberMentions();
  const caret = input.selectionStart ?? input.value.length;
  const match = input.value.slice(0, caret).match(/(?:^|\s)@([^\s@]*)$/);
  if (!match || (input.selectionEnd !== caret)) return closeMemberMentions();
  const query = match[1].toLowerCase();
  mentionState.start = caret - query.length - 1;
  mentionState.end = caret;
  mentionState.candidates = getMeetingMembers().filter(member => member.name.toLowerCase().includes(query));
  mentionState.activeIndex = 0;
  menu.innerHTML = mentionState.candidates.length
    ? mentionState.candidates.map((member, index) => `<button type="button" role="option" tabindex="-1" id="member-option-${index}" data-member-index="${index}" aria-selected="${index === 0}"><span class="mention-avatar">${escapeHtml(member.expert?.icon || member.name.slice(0, 1))}</span><span><b>${escapeHtml(member.name)}</b><small>${escapeHtml(member.role)}</small></span><span class="mention-at">@</span></button>`).join('')
    : '<div class="mention-empty" role="option" aria-disabled="true">没有匹配的参会成员</div>';
  menu.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  if (mentionState.candidates.length) highlightMemberMention();
  else input.removeAttribute('aria-activedescendant');
}
function selectMemberMention(index) {
  const member = mentionState.candidates[index];
  if (!member) return;
  const input = $('#meetingInput');
  const suffix = input.value.slice(mentionState.end).replace(/^\s*/, '');
  const prefix = input.value.slice(0, mentionState.start) + `@${member.name} `;
  input.value = prefix + suffix;
  input.focus();
  input.setSelectionRange(prefix.length, prefix.length);
  updateComposerHighlight();
  closeMemberMentions();
}
function handleMeetingKeydown(event) {
  if (event.isComposing || event.keyCode === 229) return;
  if (!$('#memberMentions').hidden) {
    if (['ArrowDown', 'ArrowUp'].includes(event.key) && mentionState.candidates.length) {
      event.preventDefault();
      const count = mentionState.candidates.length;
      mentionState.activeIndex = (mentionState.activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
      highlightMemberMention();
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); closeMemberMentions(); return; }
    if (event.key === 'Enter' || event.key === 'Tab') {
      if (mentionState.candidates.length) { event.preventDefault(); selectMemberMention(mentionState.activeIndex); return; }
      if (event.key === 'Enter') { event.preventDefault(); return; }
    }
  }
  if (event.key === 'Enter') { event.preventDefault(); askWhileReading(); }
}
function isActiveQuestion(record) {
  return state.questions.includes(record) && state.experts.some(expert => expert === record.expert && expert.session === record.expertSession);
}
function answerFor(record) {
  if (record.readAborted) return { answerTitle: '专家已离开会议', answerBody: '本条回答已中止。', evidence: [], action: '' };
  if (record.answerStatus === 'ready' && record.aiAnswer) return record.aiAnswer;
  if (record.answerStatus === 'error') return { answerTitle: 'GPT 回答失败', answerBody: record.answerError || '请稍后重试。', evidence: [], action: '' };
  return { answerTitle: 'GPT 正在回答…', answerBody: '正在结合会议上下文分析，请稍候。', evidence: [], action: '' };
}
function answerStatusLabel(record) {
  if (record.readAborted) return '回答已中止';
  if (record.answerStatus === 'error') return 'GPT 请求失败';
  if (record.answerStatus !== 'ready') return 'GPT 正在回答…';
  const confidence = record.aiAnswer?.confidence;
  return `${record.answerModel || 'GPT'}${confidence == null ? '' : ` · 置信度 ${confidence}%`}`;
}
function buildMeetingContext(task = selectedTask()) {
  const messages = $$('#thread .message:not(.agent-answer) .message-body').map(body => body.innerText.trim()).filter(Boolean);
  return `会议：${state.meeting?.title || '尚未导入'}\n本人：${state.person}\n原始会议纪要：\n${state.meeting?.minutes || ''}\n\n本人任务清单（模型整理，需核对原文）：\n${JSON.stringify(state.tasks, null, 2)}\n\n本次提问关注的任务：\n${task ? JSON.stringify(task, null, 2) : '整份会议纪要，未限定任务'}\n\n后续任务讨论：\n${messages.slice(-30).join('\n')}`;
}
async function requestExpertAnswer(record) {
  if (!isActiveQuestion(record) || record.answerStatus === 'loading') return;
  record.answerStatus = 'loading';
  record.expert.meetingContext = buildMeetingContext(record.taskSnapshot);
  renderAgent();
  addAgentAnswerToThread(record);
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'question',
        question: record.text,
        expert: { id: record.expertId, name: record.expertName, description: record.expert.description },
        context: `${record.expert.meetingContext}\n\n本场会议最近问答：\n${state.questions.filter(item => item.id !== record.id && item.answerStatus === 'ready').slice(-5).map(item => `问题：${item.text}\n回答：${item.aiAnswer.answerBody}`).join('\n')}`
      })
    });
    const payload = await response.json();
    if (!response.ok || !payload.answer) throw new Error(payload.error || `模型请求失败（HTTP ${response.status}）`);
    if (!isActiveQuestion(record)) return;
    record.aiAnswer = payload.answer;
    record.answerStatus = 'ready';
    record.answerModel = payload.model || 'GPT';
    renderAgent();
    addAgentAnswerToThread(record);
    showToast(`${record.expertName} 已由 GPT 回答`);
  } catch (error) {
    if (!isActiveQuestion(record)) return;
    record.answerStatus = 'error';
    record.answerError = error.message || '模型请求失败';
    renderAgent();
    addAgentAnswerToThread(record);
    showToast(`GPT 回答失败：${record.answerError}`);
  }
}
function submitQuestion(question) {
  if (!question) return false;
  if (!state.meeting) { showToast('请先导入会议纪要'); return false; }
  const target = resolveQuestionTarget(question);
  if (!target) return false;
  if (!target.expert) {
    state.messages.push({ text: question, recipient: target.member?.name, taskId: state.selectedTaskId });
    const item = document.createElement('article');
    item.className = 'message own user-added';
    item.innerHTML = `<div class="message-avatar blue">${escapeHtml(state.person.slice(0, 1))}</div><div class="message-body"><div class="message-meta"><b>${escapeHtml(state.person)}</b><span>本人 · ${escapeHtml(selectedTask()?.title || '会议纪要')}</span></div><p>${formatMentions(question)}</p>${target.member ? `<div class="message-tag code">提及 ${escapeHtml(target.member.name)} · 仅工作台记录</div>` : ''}</div>`;
    $('#thread').appendChild(item);
    $('#thread').scrollTop = $('#thread').scrollHeight;
    return true;
  }
  const task = selectedTask();
  const record = { id: state.nextQuestionId++, taskId: task?.id || null, taskTitle: task?.title || '整份会议纪要', taskSnapshot: task ? { ...task } : null, text: target.text, displayText: question, mention: target.mention, expert: target.expert, expertId: target.expert.id, expertName: target.expert.name, expertSession: target.expert.session, phase: 'final', actionStatus: 'pending' };
  state.questions.push(record);
  state.pendingQuestion = question;
  state.questionAsked = true;
  state.answerShown = true;
  state.answerPhase = record.phase;
  setActiveExpert(target.expert);
  renderAgent();
  addQuestionToThread(record);
  addAgentAnswerToThread(record);
  requestExpertAnswer(record);

  return true;
}

function addQuestionToThread(recordOrQuestion) {
  const record = typeof recordOrQuestion === 'string' ? { id: state.nextQuestionId++, text: recordOrQuestion, displayText: recordOrQuestion, expert: state.expert || expertCatalog.ops } : recordOrQuestion;
  const thread = $('#thread');
  const item = document.createElement('article');
  item.className = 'message own';
  item.dataset.questionId = record.id;
  const expertName = record.expert?.name || expertCatalog.ops.name;
  item.innerHTML = `<div class="message-avatar blue">${escapeHtml(state.person.slice(0, 1))}</div><div class="message-body"><div class="message-meta"><b>${escapeHtml(state.person)}</b><span>本人 · ${escapeHtml(record.taskTitle || '会议纪要')}</span></div><p>${formatMentions(record.displayText || record.text)}</p><div class="message-tag code">已交给${escapeHtml(expertName)}</div></div>`;
  thread.appendChild(item);
  thread.scrollTop = thread.scrollHeight;
}
function askWhileReading() {
  const input = $('#meetingInput');
  const question = input.value.trim();
  if (!question) return showToast('先输入会议消息，向专家提问请使用 @专家名');
  if (submitQuestion(question)) {
    input.value = '';
    updateComposerHighlight();
    closeMemberMentions();
    updateMeetingStats();
  }
}
function resetDemo(show = true) {
  closeModal();
  state.agent = 'idle';


  state.pendingQuestion = '';
  state.answerShown = false;
  state.answerPhase = 'none';
  state.questionAsked = false;
  state.questions = [];
  state.messages = [];
  $('#meetingInput').value = '';
  closeMemberMentions();
  state.nextQuestionId = 1;
  state.experts = [];
  Object.values(expertCatalog).forEach(expert => {
    delete expert.status;



  });
  state.expert = expertCatalog.ops;
  delete state.expert.status;


  state.activeExpertId = 'ops';
  state.executionCount = 0;
  resetMinutesWorkspace();
  activateNav('meetingNav');
  updateExpertMentions();
  $$('#thread .agent-answer, #thread .message.own[data-question-id]').forEach(item => item.remove());
  $$('#thread .execution-event, #thread .message.user-added').forEach(item => item.remove());
  updateMeetingStats();
  renderAgent();
  if (show) { minutesDraft.minutes = ''; minutesDraft.filename = ''; minutesDraft.person = '周宁'; showToast('工作台已清空'); }
}
function showHelp() {
  openModal(`<h3>从纪要到个人任务</h3><div class="modal-quote">1. 导入或粘贴纪要，填写纪要中使用的本人姓名。
2. GPT 整理你负责、协作和分工待确认的任务；请核对截止时间与原文依据。
3. 点击任务标题切换讨论对象；完成后可勾选。
4. 遇到问题时点击“请专家协助”，选择合适的专家。专家加入只载入上下文，不自动回答。
5. 在任务讨论区输入 @专家名 和问题并发送，才会请求 GPT；普通消息仅保存在当前工作台。
6. 右侧可搜索当前专家的任务、问题与回答。

纪要与记录只保留在当前页面内存中。刷新或清空后需重新导入。任务状态为个人记录，不会通知其他成员或修改外部系统。</div><div class="modal-actions"><button class="button primary" data-close-modal>知道了</button></div>`);
}

function activateNav(activeId) {
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.id === activeId));
}
function showContextRepository() {
  activateNav('contextNav');
  showMinutesSource();
}

function showExpertModule() {
  activateNav('expertNav');
  inviteAgent();
}

function normalizeFontSize(value) {
  const legacySizes = { normal: 16, large: 17, xlarge: 18 };
  const size = Number(legacySizes[value] || value);
  return Number.isFinite(size) && size >= 14 && size <= 22 ? Math.round(size * 2) / 2 : 17;
}
const savedTheme = localStorage.getItem('contextops-display-version') === '2' ? localStorage.getItem('contextops-theme') : 'contrast';
const displaySettings = {
  fontSize: normalizeFontSize(localStorage.getItem('contextops-font-size')),
  theme: ['light', 'contrast', 'warm'].includes(savedTheme) ? savedTheme : 'contrast'
};
function applyDisplaySettings() {
  const root = document.documentElement;
  root.style.setProperty('--page-font-size', `${displaySettings.fontSize}px`);
  root.dataset.theme = displaySettings.theme;
  const slider = $('#fontSizeSlider');
  if (slider) {
    slider.value = displaySettings.fontSize;
    slider.setAttribute('aria-valuetext', `${displaySettings.fontSize} 像素`);
    slider.style.setProperty('--slider-fill', `${(displaySettings.fontSize - 14) / 8 * 100}%`);
  }
  const value = $('#fontSizeValue');
  if (value) value.textContent = `${displaySettings.fontSize} px`;
  $$('[data-theme]').forEach(button => {
    const selected = button.dataset.theme === displaySettings.theme;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  localStorage.setItem('contextops-font-size', displaySettings.fontSize);
  localStorage.setItem('contextops-theme', displaySettings.theme);
  localStorage.setItem('contextops-display-version', '2');
}
function setDisplaySetting(type, value) {
  displaySettings[type] = type === 'fontSize' ? normalizeFontSize(value) : value;
  applyDisplaySettings();
  if (type === 'theme') showToast('页面主题已更新');
}
function closeDisplaySettings() {
  const panel = $('#displaySettingsPanel');
  const trigger = $('#displaySettings');
  if (!panel || !trigger) return;
  panel.hidden = true;
  trigger.setAttribute('aria-expanded', 'false');
}
function toggleDisplaySettings() {
  const panel = $('#displaySettingsPanel');
  const trigger = $('#displaySettings');
  if (!panel || !trigger) return;
  panel.hidden = !panel.hidden;
  trigger.setAttribute('aria-expanded', String(!panel.hidden));
}


const expertCatalog = Object.fromEntries([
  ['ops', '运维专家', '⌁', '分析系统稳定性、上线安排和运维风险'],
  ['database', '数据库专家', '▦', '协助数据迁移、查询优化和数据库方案'],
  ['network', '网络专家', '↔', '分析网络架构、访问链路和连通性问题'],
  ['security', '安全专家', '◇', '协助权限、数据保护和安全风险评估'],
  ['product', '产品专家', '✦', '拆解需求、验收范围与产品交付安排'],
  ['custom', '任务规划专家', '✓', '梳理任务步骤、依赖、时间安排与协作']
].map(([id, name, icon, description]) => [id, { id, name, icon, description, sources: [{ name: '原始会议纪要', detail: '用户导入的文本', icon: '▤', tone: 'purple' }] }]));
state.expert = expertCatalog.ops;
function customExpert(name) {
  return { id: 'custom', name, icon: '✦', description: `以${name}的专业视角分析当前任务，资料不足时说明需要补充的信息`, sources: [{ name: '原始会议纪要', detail: '用户导入的文本', icon: '▤', tone: 'purple' }] };
}

function updateExpertHeader() {
  const expert = state.expert || expertCatalog.ops;
  $('.agent-title h2').textContent = expert.status ? expert.name : '专家协作';
  $('.agent-avatar span').textContent = expert.icon;
}
function evidenceDetail(record, label) {
  const quote = record.taskSnapshot?.sourceQuote;
  const exact = state.meeting?.minutes?.includes(label);
  return {
    source: { name: exact ? '纪要原文引用' : '相关纪要原文（请核对模型依据）', detail: record.taskTitle, tone: 'purple', icon: '▤' },
    excerpt: exact ? label : quote || state.meeting?.minutes || '没有可核对的原文', label
  };
}

function showEvidence(questionId, evidenceIndex = null) {
  const record = state.questions.find(item => String(item.id) === String(questionId));
  if (!record) return showToast('这条回答的证据暂不可用');
  const expert = record.expert || state.experts.find(item => item.id === record.expertId) || state.expert || expertCatalog.ops;
  const evidence = answerFor(record).evidence || [];
  const indexes = evidenceIndex === null || evidenceIndex === undefined ? evidence.map((_, index) => index) : [Number(evidenceIndex)];
  const items = indexes.filter(index => evidence[index] !== undefined).map(index => {
    const detail = evidenceDetail(record, evidence[index]);
    return `<div class="evidence-detail"><div class="evidence-detail-head"><span class="source-icon ${detail.source.tone || 'purple'}">${detail.source.icon || '▤'}</span><div><b>${escapeHtml(detail.label)}</b><small>${escapeHtml(detail.source.name)} · ${escapeHtml(detail.source.detail)}</small></div></div><p>${escapeHtml(detail.excerpt)}</p><div class="modal-quote">${escapeHtml(detail.source.name)}：${escapeHtml(detail.source.detail)}<br>已关联问题：${escapeHtml(record.displayText || record.text)}</div></div>`;
  }).join('');
  openModal(`<h3>回答证据</h3><p>${escapeHtml(expert.name)} 提供了以下 ${indexes.length} 条参考依据标签，请结合纪要原文核对。</p><div class="evidence-detail-list">${items || '<div class="empty-evidence">当前回答还没有可展开的证据。</div>'}</div><div class="modal-actions"><button class="button primary" data-close-modal>返回回答</button></div>`);
}

function renderAgent() {
  const expert = state.expert || expertCatalog.ops;
  const label = $('#agentStatusLabel');
  const content = $('#agentContent');
  const searchFocus = document.activeElement?.id === 'answerSearch'
    ? { start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd } : null;
  const scrollTop = content.scrollTop;
  updateExpertHeader();
  updateExpertMentions();
  const experts = state.experts || [];
  $('#sideAgentCount').textContent = String(experts.length);
  state.agent = expert.status || 'idle';


  updateMeetingStats();

  if (state.agent === 'idle') {
    const task = selectedTask();
    const recommended = task && expertCatalog[task.expertId];
    label.textContent = '先确认任务，再决定是否需要专业建议';
    content.innerHTML = `<div class="invite-state"><span class="invite-kicker">EXPERT HELP · 按需协作</span><div class="invite-illustration"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="expert-core">${recommended?.icon || '◇'}</div></div><h3>${state.meeting ? '任务有疑问时，再请专家' : '先看看自己的任务安排'}</h3><p>${state.meeting ? '可以自行完成任务，也可以邀请专家帮你拆解难点、识别风险和制定下一步。' : '导入纪要、确认分工后，再决定是否需要邀请专家协助。'}</p>${task ? `<div class="expert-task-preview"><small>当前任务</small><b>${escapeHtml(task.title)}</b><p>${escapeHtml(task.expertReason)}</p>${recommended ? `<span>建议角色：${escapeHtml(recommended.name)}</span>` : ''}</div>` : ''}<button class="invite-button" id="inviteButton">${state.meeting ? '＋ 选择任务专家' : '↥ 先导入纪要'}</button><small class="permission-note">专家加入只载入上下文，收到 @ 提问后才回答</small><div class="expert-onboarding"><div><span>01</span><b>选中任务</b><small>明确讨论对象</small></div><div><span>02</span><b>按需邀请</b><small>不自动回答</small></div><div><span>03</span><b>@专家提问</b><small>建议与记录留存</small></div></div></div>`;
    $('#inviteButton').addEventListener('click', state.meeting ? inviteAgent : openMinutesImport);
    return;
  }

  const roster = `<div class="expert-roster"><div class="expert-roster-title"><span>参会专家 <b>${experts.length}</b></span><button id="addAnotherExpert" type="button">＋ 添加专家</button></div><div class="expert-roster-list" aria-label="切换参会专家">${experts.map(item => { const selected = item === expert; return `<button type="button" class="expert-roster-item ${selected ? 'selected' : ''}" aria-pressed="${selected}" data-roster-expert="${escapeHtml(item.id)}" data-roster-name="${escapeHtml(item.name)}"><span>${item.icon}</span><b>${escapeHtml(item.name)}</b><i class="roster-status ${item.status}" title="${item.status === 'reading' ? '正在分析' : item.status === 'error' ? '分析失败' : '已就绪'}"></i></button>`; }).join('')}</div></div>`;
  const sameExpert = record => record.expert === expert;
  const visibleQuestions = state.questions.filter(sameExpert);
  const answerCards = records => [...records].reverse().map(record => {
    const answer = answerFor(record);
    const evidenceList = answer.evidence || [];
    const confidenceLabel = escapeHtml(answerStatusLabel(record));
    const actionMarkup = record.readAborted ? '<b>上下文读取已中止</b><span>专家已离开会议，这条回答保留为未完成的演示记录。</span>'
      : record.actionStatus === 'executed' ? `<b>已确认 · 演示执行</b><span>${escapeHtml(record.executedAction)}</span>`
        : answer.action ? `<b>建议动作预览</b><span>${escapeHtml(answer.action)}</span><button type="button" class="action-confirm" data-confirm-action="${record.id}">会议确认并模拟执行</button>` : '<b>建议动作</b><span>当前没有可执行建议。</span>';
    const answerBody = answer.answerBody;
    const retryButton = record.answerStatus === 'error' && isActiveQuestion(record) ? `<button type="button" class="action-confirm" data-retry-question="${record.id}">重试 GPT</button>` : '';
    const evidenceMarkup = evidenceList.length ? `<details class="answer-details"><summary>参考依据 <span>${evidenceList.length} 条</span></summary><div class="evidence-row">${evidenceList.map((item, index) => `<button type="button" class="evidence-chip" data-evidence-question="${record.id}" data-evidence-index="${index}" title="点击查看证据">${escapeHtml(item)}</button>`).join('')}</div></details>` : '';
    const actionSection = answer.action || record.actionStatus === 'executed' ? `<details class="answer-details action-details"><summary>建议动作 <span>${record.actionStatus === 'executed' ? '已确认' : '待会议确认'}</span></summary><div class="action-preview">${actionMarkup}<small>演示动作只记录到会议，不会连接或修改生产系统。</small></div></details>` : '';
    return `<article class="answer-card ${record.answerStatus || 'loading'}" data-question-id="${record.id}"><div class="answer-label"><span class="answer-kind"><i aria-hidden="true">↳</i>问题解答</span><span class="answer-state">${record.answerStatus === 'ready' ? '已完成' : record.answerStatus === 'error' ? '请求失败' : '分析中'}</span></div><div class="answer-task">任务：${escapeHtml(record.taskTitle)}</div><div class="answer-question">${formatMentions(record.displayText || record.text)}</div><h4>${formatMentions(answer.answerTitle)}</h4><p>${formatMentions(answerBody).replace(/\n/g, '<br>')}</p><div class="answer-model">${confidenceLabel}</div>${retryButton}${evidenceMarkup}${actionSection}</article>`;
  }).join('');
  const bindRoster = () => {
    $$('[data-roster-expert]', content).forEach(button => button.addEventListener('click', () => {
      const selected = experts.find(item => item.id === button.dataset.rosterExpert && item.name === button.dataset.rosterName);
      if (selected) { setActiveExpert(selected); renderAgent(); }
    }));
    $('#addAnotherExpert')?.addEventListener('click', inviteAgent);
  };

  const status = visibleQuestions.some(record => record.answerStatus === 'loading') ? 'reading' : 'ready';
  const statusCopy = status === 'reading'
    ? ['GPT 正在回答提问', '结合最新会议上下文分析，可以继续讨论']
    : ['会议上下文已载入', '等待提问，在会议讨论区输入 @ 选择专家'];
  label.textContent = expert.description;
  const historyControls = visibleQuestions.length ? `<div class="answer-history-controls"><div class="answer-stack-title"><span>分析与回答</span><small id="answerSearchCount" role="status"></small></div><div class="answer-search"><span aria-hidden="true">⌕</span><input id="answerSearch" type="search" autocomplete="off" aria-label="搜索当前专家的问答记录" placeholder="搜索问题、回答或参考依据" value="${escapeHtml(expert.recordSearch || '')}"><button id="clearAnswerSearch" type="button" aria-label="清空记录搜索" title="清空搜索">×</button></div></div>` : '';
  const history = visibleQuestions.length ? '<div class="answer-stack"><div id="answerSearchResults"></div></div>' : '<div class="answer-history-empty"><b>还没有回答记录</b><p>在会议讨论区 @这位专家提问，回答会记录在这里。</p></div>';
  content.innerHTML = `<div class="expert-controls">${roster}${historyControls}</div><div class="ready-state"><div class="context-analysis-state ${status}" role="status"><span class="analysis-status-icon" aria-hidden="true">${status === 'reading' ? '◌' : status === 'error' ? '!' : '✓'}</span><div><b>${statusCopy[0]}</b><small>${statusCopy[1]}</small></div></div>${history}</div>`;
  bindRoster();
  const filterHistory = () => {
    const input = $('#answerSearch');
    if (!input) return;
    expert.recordSearch = input.value;
    const terms = input.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const matches = visibleQuestions.filter(record => {
      const answer = answerFor(record);
      const text = [record.taskTitle, record.displayText, record.text, answer.answerTitle, answer.answerBody, ...(answer.evidence || []), answer.action, record.executedAction, record.answerModel].join(' ').toLocaleLowerCase();
      return terms.every(term => text.includes(term));
    });
    $('#answerSearchCount').textContent = terms.length ? `${matches.length} / ${visibleQuestions.length} 条记录` : `${visibleQuestions.length} 条记录 · 最新在前`;
    $('#clearAnswerSearch').hidden = !input.value;
    $('#answerSearchResults').innerHTML = matches.length ? answerCards(matches) : '<div class="answer-history-empty"><b>没有找到匹配记录</b><p>试试其他关键词，或清空搜索查看全部回答。</p></div>';
  };
  $('#answerSearch')?.addEventListener('input', filterHistory);
  $('#clearAnswerSearch')?.addEventListener('click', () => { $('#answerSearch').value = ''; filterHistory(); $('#answerSearch').focus(); });
  filterHistory();
  if (searchFocus && $('#answerSearch')) {
    $('#answerSearch').focus({ preventScroll: true });
    $('#answerSearch').setSelectionRange?.(searchFocus.start, searchFocus.end);
  }
  content.scrollTop = scrollTop;
}

function inviteAgent() {
  if (!state.meeting) return openMinutesImport();
  const task = selectedTask();
  const current = expertCatalog[task?.expertId] || state.expert || expertCatalog.custom;
  const cards = Object.values(expertCatalog).map(expert => {
    const joined = state.experts.some(item => item.id === expert.id && item.name === expert.name);
    return `<button class="expert-option ${expert.id === current.id && expert.name === current.name ? 'selected' : ''}" data-expert-id="${expert.id}"><span class="expert-option-icon">${expert.icon}</span><span><b>${escapeHtml(expert.name)}</b><small>${escapeHtml(expert.description)}</small></span>${joined ? '<em class="expert-joined">已加入</em>' : ''}</button>`;
  }).join('');
  openModal(`<div class="expert-picker"><h3>为任务选择专家</h3><p>${task ? `当前任务：${escapeHtml(task.title)}<br>${escapeHtml(task.expertReason)}` : '围绕当前纪要邀请合适的专家。'}<br>添加后只载入上下文，需要发送 @ 提问才会回答。</p><div class="expert-grid">${cards}</div><div class="custom-expert"><input id="customExpertInput" maxlength="40" placeholder="自定义专家，例如：项目管理专家"><button id="useCustomExpert">使用自定义角色</button></div><p class="custom-hint">专家会读取原始纪要、本人任务和后续讨论，不会自动执行任务。</p><div class="expert-selected-note">当前选择：<b id="selectedExpertName">${escapeHtml(current.name)}</b></div><div class="modal-actions"><button class="button ghost" data-close-modal>取消</button><button class="button primary" id="confirmInvite">添加并准备提问</button></div></div>`);
  let selected = current;
  $$('[data-expert-id]', $('#modalContent')).forEach(button => button.addEventListener('click', () => {
    selected = expertCatalog[button.dataset.expertId];
    $$('[data-expert-id]', $('#modalContent')).forEach(item => item.classList.remove('selected'));
    button.classList.add('selected');
    $('#selectedExpertName').textContent = selected.name;
  }));
  $('#useCustomExpert').addEventListener('click', () => {
    const name = $('#customExpertInput').value.trim();
    if (!name) return showToast('请输入自定义专家名称');
    if (/[\s@]/.test(name) || (state.meeting.participants || []).includes(name)) return showToast('专家名称不能包含空格、@，或与参会成员重名');
    selected = customExpert(name);
    $$('[data-expert-id]', $('#modalContent')).forEach(item => item.classList.remove('selected'));
    $('#selectedExpertName').textContent = selected.name;
    showToast(`已选择自定义角色：${name}`);
  });
  $('#confirmInvite').addEventListener('click', () => {
    const existing = state.experts.find(item => item.id === selected.id && item.name === selected.name);
    const expert = existing || {
      ...selected,
      sources: selected.sources.map(source => ({ ...source })),
      evidence: [...(selected.evidence || [])]
    };
    if (!existing) {
      expert.status = 'ready';
      expert.session = state.nextExpertSession++;
      state.experts.push(expert);
    }
    setActiveExpert(expert);
    if (state.experts.length === 1 && state.questions.length === 0) {
      state.pendingQuestion = '';
      state.answerShown = false;
      state.answerPhase = 'none';
    }
    closeModal();
    updateExpertMentions();
    renderAgent();
    if (!existing) loadExpertContext(expert);
    updateMeetingStats();
    prefillExpertQuestion(expert);
    showToast(existing ? `已切换到${expert.name}` : `${expert.name} 已加入，已载入上下文并等待提问`);
  });
}
function addAgentAnswerToThread(record) {
  const answer = record || state.questions[state.questions.length - 1];
  if (!answer) return;
  const expert = answer.expert || state.experts?.find(item => item.id === answer.expertId) || state.expert || expertCatalog.ops;
  const thread = $('#thread');
  const existing = $(`#thread .agent-answer[data-question-id="${answer.id}"]`);
  const preliminary = answer.phase === 'preliminary';
  const answerData = answerFor(answer);
  const evidenceLabel = `附 ${(answerData.evidence || []).length} 条证据 · 点击查看证据`;
  const actionButton = !preliminary && !answer.readAborted && answerData.action && answer.actionStatus !== 'executed' ? `<button type="button" class="message-tag action-confirm" data-confirm-action="${answer.id}">确认并模拟执行建议</button>` : '';
  const executionStatus = answerData.action && answer.actionStatus === 'executed' ? '<span class="message-tag executed-tag">已确认 · 演示执行</span>' : '';
  const retry = answer.answerStatus === 'error' && isActiveQuestion(answer) ? `<button type="button" class="action-confirm" data-retry-question="${answer.id}">重试 GPT</button>` : '';
  const evidence = answer.answerStatus === 'ready' ? `<button type="button" class="message-tag code evidence-trigger" data-evidence-question="${answer.id}" title="点击查看证据">${evidenceLabel}</button>` : '';
  const itemHtml = `<div class="message-avatar purple">${expert.icon}</div><div class="message-body"><div class="message-meta"><b>${escapeHtml(expert.name)}</b><span>${escapeHtml(answerStatusLabel(answer))}</span></div><p><strong>${formatMentions(answerData.answerTitle)}</strong> ${formatMentions(answerData.answerBody)}</p>${evidence}${actionButton}${executionStatus}${retry}</div>`;
  if (existing) {
    existing.innerHTML = itemHtml;
  } else {
    const item = document.createElement('article');
    item.className = 'message agent-answer';
    item.dataset.questionId = answer.id;
    item.innerHTML = itemHtml;
    thread.appendChild(item);
  }
  thread.scrollTop = thread.scrollHeight;
}
function updateMeetingStats() {
  const count = state.questions.length * 2 + state.messages.length + state.executionCount;
  $('#sideMessageCount').textContent = String(count);
  const online = $('.thread-tools > span');
  if (online) online.textContent = state.meeting ? `${state.tasks.length} 项任务 · ${state.experts.length} 位专家` : '尚未导入纪要';
  $('#stepExpert')?.classList.toggle('active', state.experts.length > 0);
}

function appendExecutionEvent(record) {
  const thread = $('#thread');
  const event = document.createElement('div');
  event.className = 'context-event execution-event';
  event.dataset.actionQuestion = record.id;
  event.innerHTML = `<span class="event-icon">✓</span><div><b>${escapeHtml(record.expertName)} 的建议已获会议确认</b><span>演示执行：${escapeHtml(record.executedAction)} · 未连接生产系统</span></div>`;
  thread.appendChild(event);
  thread.scrollTop = thread.scrollHeight;
}
function showActionConfirmation(questionId) {
  const record = state.questions.find(item => String(item.id) === String(questionId));
  if (!record) return showToast('找不到对应的建议动作');
  if (record.phase !== 'final') return showToast('请等专家完成上下文读取后再确认动作');
  const answer = answerFor(record);
  if (record.readAborted || record.answerStatus !== 'ready' || !answer.action) return showToast('当前没有可确认的模型建议');
  const action = answer.action;
  openModal(`<h3>确认会议建议</h3><p>${escapeHtml(record.expertName)} 针对“${escapeHtml(record.text)}”提出了以下动作：</p><div class="modal-quote">${escapeHtml(action)}</div><p class="execution-notice">确认后只会在本演示的会议线程记录结果，不会调用外部系统或修改生产环境。</p><div class="modal-actions"><button class="button ghost" data-close-modal>暂不执行</button><button class="button primary" data-confirm-execution="${record.id}">确认并模拟执行</button></div>`);
}
function simulateExecution(questionId) {
  const record = state.questions.find(item => String(item.id) === String(questionId));
  if (!record || record.actionStatus === 'executed') return closeModal();
  const answer = answerFor(record);
  if (record.readAborted || record.phase !== 'final' || record.answerStatus !== 'ready' || !answer.action) return closeModal();
  record.executedAction = answer.action;
  record.actionStatus = 'executed';
  state.executionCount += 1;
  closeModal();
  appendExecutionEvent(record);
  addAgentAnswerToThread(record);
  renderAgent();
  updateMeetingStats();
  showToast('已记录演示执行结果；没有修改生产环境');
}
function showAgentMenu() {
  if (!state.experts.length) return inviteAgent();
  const expert = state.expert;
  openModal(`<h3>${escapeHtml(expert.name)} 设置</h3><p>管理该专家在本场会议中的访问和会话记录。</p><div class="modal-actions"><button class="button ghost" data-close-modal>取消</button><button class="button primary" data-remove-expert="${escapeHtml(expert.id)}" data-remove-name="${escapeHtml(expert.name)}">移除当前专家</button></div>`);
}
function removeExpert(id, name) {
  const removed = state.experts.find(item => item.id === id && item.name === name);
  if (!removed) return closeModal();
  removed.status = 'removed';
  state.questions.filter(question => question.expert === removed && question.answerStatus !== 'ready').forEach(question => {
    question.phase = 'final';
    question.readAborted = true;
    addAgentAnswerToThread(question);
  });
  state.experts = state.experts.filter(item => item !== removed);
  const next = state.experts[0];
  closeModal();
  if (next) setActiveExpert(next);
  else {
    state.expert = expertCatalog.ops;
    delete state.expert.status;


    state.agent = 'idle';


  }
  updateExpertMentions();
  renderAgent();
  updateMeetingStats();
  showToast(`${name} 已离开会议；历史回答保留在线程中`);
}
function bindStaticEvents() {
  const on = (selector, event, handler) => {
    const node = $(selector);
    if (node) node.addEventListener(event, handler);
  };
  on('#inviteButton', 'click', inviteAgent);
  on('#inviteInline', 'click', inviteAgent);
  on('#meetingNav', 'click', () => activateNav('meetingNav'));
  on('#contextNav', 'click', showContextRepository);
  on('#expertNav', 'click', showExpertModule);
  on('#resetDemo', 'click', () => resetDemo());
  on('#sendMeeting', 'click', askWhileReading);
  on('#meetingInput', 'keydown', handleMeetingKeydown);
  on('#meetingInput', 'input', event => { updateComposerHighlight(); if (!event.isComposing) renderMemberMentions(); });
  on('#meetingInput', 'compositionend', () => { updateComposerHighlight(); renderMemberMentions(); });
  on('#meetingInput', 'scroll', updateComposerHighlight);
  on('#meetingInput', 'blur', closeMemberMentions);
  on('#memberMentions', 'mousedown', event => event.preventDefault());
  on('#memberMentions', 'click', event => {
    const option = event.target.closest('[data-member-index]');
    if (option) selectMemberMention(Number(option.dataset.memberIndex));
  });
  on('#helpButton', 'click', showHelp);
  on('#agentMenu', 'click', showAgentMenu);
  on('#modalClose', 'click', closeModal);
  on('#modalBackdrop', 'click', event => { if (event.target === $('#modalBackdrop')) closeModal(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
  document.addEventListener('click', event => {
    if (!event.target.closest('#memberMentions') && event.target.id !== 'meetingInput') closeMemberMentions();
    if (event.target.closest('[data-close-modal]')) closeModal();
    const action = event.target.closest('[data-confirm-action]');
    if (action) showActionConfirmation(action.dataset.confirmAction);
    const execution = event.target.closest('[data-confirm-execution]');
    if (execution) simulateExecution(execution.dataset.confirmExecution);
    const removal = event.target.closest('[data-remove-expert]');
    if (removal) removeExpert(removal.dataset.removeExpert, removal.dataset.removeName);
    const evidence = event.target.closest('[data-evidence-question]');
    if (evidence) {
      event.preventDefault();
      showEvidence(evidence.dataset.evidenceQuestion, evidence.dataset.evidenceIndex ?? null);
    }
    const retry = event.target.closest('[data-retry-question]');
    if (retry) {
      const record = state.questions.find(item => String(item.id) === retry.dataset.retryQuestion);
      if (record) requestExpertAnswer(record);
    }
    if (!event.target.closest('#displaySettingsPanel') && !event.target.closest('#displaySettings')) closeDisplaySettings();
  });
  on('#displaySettings', 'click', toggleDisplaySettings);
  on('#closeDisplaySettings', 'click', closeDisplaySettings);
  on('#fontSizeSlider', 'input', event => setDisplaySetting('fontSize', event.target.value));
  $$('[data-theme]').forEach(button => button.addEventListener('click', () => setDisplaySetting('theme', button.dataset.theme)));
  on('#resetDisplaySettings', 'click', () => {
    displaySettings.fontSize = 17;
    displaySettings.theme = 'contrast';
    applyDisplaySettings();
    showToast('已恢复默认显示设置');
  });
  updateMeetingStats();
  applyDisplaySettings();
}

bindStaticEvents();
initializeMinutesWorkflow();
renderAgent();
