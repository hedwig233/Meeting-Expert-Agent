import { Fragment, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Check, ChevronRight, CircleHelp, FileText, LoaderCircle, MessageSquare, Plus, Search, Send, ShieldCheck, Sparkles, Upload, UserRound, X } from 'lucide-react';
import type { Answer, Discussion, Expert, Meeting, Record, Task } from './minutes-types';
import WorkspaceNav from './WorkspaceNav';
import './minutes.css';

const catalog: Expert[] = [
  { id: 'ops', key: 'ops', name: '运维专家', description: '分析系统稳定性、上线安排和运维风险' },
  { id: 'database', key: 'database', name: '数据库专家', description: '协助数据迁移、查询优化和数据库方案' },
  { id: 'network', key: 'network', name: '网络专家', description: '分析网络架构、访问链路和连通性问题' },
  { id: 'security', key: 'security', name: '安全专家', description: '协助权限、数据保护和安全风险评估' },
  { id: 'product', key: 'product', name: '产品专家', description: '拆解需求、验收范围与产品交付安排' },
  { id: 'custom', key: 'custom', name: '任务规划专家', description: '梳理任务步骤、依赖、时间安排与协作' },
];
const sample = '产品迭代周会纪要\n参会人：周宁、林晓、张三\n1. 周宁负责整理新版工作台的需求清单，本周五前提交评审，优先级高。\n2. 张三负责数据库迁移方案，周宁协助确认业务验收范围，下周三前完成。\n3. 林晓负责更新帮助文档，周宁上周已完成旧版文档的校对。\n4. 团队建议由周宁牵头梳理跨部门反馈，负责人和截止时间仍待确认。';
async function api<T>(path: string, body?: unknown, signal?: AbortSignal, method?: string): Promise<T> {
  const response = await fetch('/api' + path, { method: method || (body === undefined ? 'GET' : 'POST'), headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || '请求失败，请重试。'); return data;
}
const uid = () => crypto.randomUUID();
const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export default function MinutesRoom() {
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]); const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [experts, setExperts] = useState<Expert[]>([]); const [activeExpert, setActiveExpert] = useState('');
  const [records, setRecords] = useState<Record[]>([]); const [discussion, setDiscussion] = useState<Discussion[]>([]);
  const [question, setQuestion] = useState(''); const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'tasks' | 'discussion'>('tasks');
  const [modal, setModal] = useState<'import' | 'source' | 'expert' | null>(null);
  const [person, setPerson] = useState(''); const [minutes, setMinutes] = useState(''); const [filename, setFilename] = useState('');
  const [importing, setImporting] = useState(false); const [importError, setImportError] = useState('');
  const [error, setError] = useState(''); const [toast, setToast] = useState('');
  const [modelConfig, setModelConfig] = useState<{ ready: boolean; model: string } | null>(null);
  const [pickedExpert, setPickedExpert] = useState('ops'); const [customName, setCustomName] = useState('');
  const [confirmation, setConfirmation] = useState<Record | null>(null); const [clearConfirm, setClearConfirm] = useState(false);
  const [mention, setMention] = useState<{ start: number; end: number; query: string } | null>(null); const [mentionIndex, setMentionIndex] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null); const fileInput = useRef<HTMLInputElement>(null);
  const importJob = useRef<AbortController | null>(null); const answerJobs = useRef(new Map<string, AbortController>());
  const epoch = useRef(0); const fileEpoch = useRef(0); const discussionEnd = useRef<HTMLDivElement>(null);
  const selected = tasks.find(task => task.id === selectedTaskId) || null;
  const expert = experts.find(item => item.key === activeExpert);
  const pending = tasks.filter(task => !task.completed).length;
  const members = [...new Set([...(meeting?.participants || []), ...experts.map(item => item.name)])].sort((a, b) => b.length - a.length);
  const candidates = mention ? members.filter(name => name.toLowerCase().includes(mention.query.toLowerCase())) : [];

  useEffect(() => { api<{ ready: boolean; model: string }>('/minutes/config').then(setModelConfig).catch(e => setError(e.message)); }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 3500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { discussionEnd.current?.scrollIntoView({ block: 'nearest' }); }, [discussion.length, records, tab]);
  useEffect(() => () => { importJob.current?.abort(); answerJobs.current.forEach(job => job.abort()); }, []);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { importJob.current?.abort(); importJob.current = null; fileEpoch.current++; setImporting(false); setModal(null); setConfirmation(null); setClearConfirm(false); setMention(null); } };
    window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close);
  }, []);

  function marked(text: string) {
    const pattern = members.length ? new RegExp('(@(?:' + members.map(escapePattern).join('|') + '))(?=$|[\\s，。！？、,:：!?])', 'g') : null;
    return pattern ? text.split(pattern).map((part, index) => part.startsWith('@') && members.includes(part.slice(1)) ? <span className="member-mention" key={index}>{part}</span> : part) : text;
  }
  function closeModal() { importJob.current?.abort(); importJob.current = null; fileEpoch.current++; setImporting(false); setModal(null); }
  function openImport() { if (meeting) { setPerson(meeting.person); setMinutes(meeting.minutes); } setImportError(''); setModal('import'); }
  function resetWorkspace() {
    epoch.current++; importJob.current?.abort(); answerJobs.current.forEach(job => job.abort()); answerJobs.current.clear();
    setMeeting(null); setTasks([]); setSelectedTaskId(null); setExperts([]); setActiveExpert(''); setRecords([]); setDiscussion([]); setQuestion(''); setSearch(''); setMention(null); setTab('tasks'); setError('');
  }
  async function readFile(file: File) {
    const version = ++fileEpoch.current;
    try {
      if (!/\.(txt|md|markdown|text)$/i.test(file.name)) throw new Error('请选择 .txt 或 .md 文本文件。');
      if (file.size > 200000) throw new Error('文件不能超过200 KB。');
      const bytes = new Uint8Array(await file.arrayBuffer()); let text;
      if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder('utf-16le').decode(bytes);
      else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder('utf-16be').decode(bytes);
      else { try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { text = new TextDecoder('gb18030', { fatal: true }).decode(bytes); } }
      if (text.includes('\0')) throw new Error('文件包含非文本内容，请另存为 UTF-8 后重试。');
      if (text.length > 30000) throw new Error('纪要不能超过30,000字。');
      if (version !== fileEpoch.current) return;
      setMinutes(text); setFilename(file.name); setImportError('');
    } catch (e) { if (version === fileEpoch.current) setImportError((e as Error).message); }
  }
  async function extractTasks() {
    if (!person.trim()) { setImportError('请填写本人在纪要中的姓名。'); return; }
    if (!minutes.trim()) { setImportError('请先粘贴或导入会议纪要。'); return; }
    if (importJob.current) return;
    const controller = new AbortController(); importJob.current = controller; const timer = setTimeout(() => controller.abort(), 100000);
    setImporting(true); setImportError('');
    try {
      const result = await api<{ meeting: Omit<Meeting, 'person' | 'minutes' | 'model'>; model: string }>('/minutes', { person: person.trim(), minutes: minutes.trim() }, controller.signal);
      if (importJob.current !== controller || controller.signal.aborted) return;
      if (!Array.isArray(result.meeting?.tasks)) throw new Error('任务提取结果无效，请重试。');
      resetWorkspace(); setMeeting({ ...result.meeting, person: person.trim(), minutes: minutes.trim(), model: result.model });
      setTasks(result.meeting.tasks.map(task => ({ ...task, completed: false }))); setSelectedTaskId(result.meeting.tasks[0]?.id || null); setModal(null); setToast(`已整理 ${result.meeting.tasks.length} 项相关任务，请核对原文。`);
    } catch (e) { if (importJob.current === controller) setImportError(controller.signal.aborted ? '任务提取超时，请重试或缩短纪要。' : (e as Error).message); }
    finally { clearTimeout(timer); if (importJob.current === controller) { importJob.current = null; setImporting(false); } }
  }
  function invite(task: Task | null = selected) { if (!meeting) return; setSelectedTaskId(task?.id || null); setPickedExpert(task?.expertId || 'ops'); setCustomName(''); setModal('expert'); }
  function addExpert() {
    const base = catalog.find(item => item.key === pickedExpert)!; const name = customName.trim() || base.name;
    const chosen = experts.find(item => item.name === name) || { ...base, ...(customName.trim() ? { id: 'custom', key: 'custom-' + uid(), name, description: `以${name}的专业视角分析任务，资料不足时说明需要补充的信息` } : {}) };
    if (!experts.some(item => item.key === chosen.key)) setExperts(previous => [...previous, chosen]);
    setActiveExpert(chosen.key); setModal(null); setQuestion(`@${chosen.name} ${selected ? `请帮我分析任务「${selected.title}」的难点、风险和下一步安排。` : ''}`); setMention(null);
    setToast(`${chosen.name} 已加入，发送 @ 提问后开始分析。`); setTimeout(() => input.current?.focus(), 0);
  }
  function contextFor(task: Task | null) {
    return `会议：${meeting!.title}\n本人：${meeting!.person}\n原始会议纪要：\n${meeting!.minutes}\n\n本人任务清单（模型整理，请核对原文）：\n${JSON.stringify(tasks)}\n\n本次关注任务：\n${task ? JSON.stringify(task) : '整份会议纪要'}\n\n后续任务讨论：\n${discussion.slice(-30).map(item => `任务：${item.taskTitle}\n${item.text}`).join('\n')}\n\n最近问答：\n${records.filter(item => item.status === 'ready').slice(-5).map(item => `问题：${item.text}\n回答：${item.answer?.answerBody}`).join('\n')}`;
  }
  async function requestAnswer(record: Record) {
    if (answerJobs.current.has(record.id)) return;
    const controller = new AbortController(); const version = epoch.current; answerJobs.current.set(record.id, controller);
    const timer = setTimeout(() => controller.abort(), 100000);
    setRecords(previous => previous.map(item => item.id === record.id ? { ...item, status: 'loading', error: '' } : item));
    try {
      const result = await api<{ answer: Answer; model: string }>('/chat', { question: record.text, expert: record.expert, context: record.context }, controller.signal);
      if (version !== epoch.current || controller.signal.aborted) return;
      if (!result.answer?.answerBody) throw new Error('专家没有返回有效回答。');
      setRecords(previous => previous.map(item => item.id === record.id ? { ...item, status: 'ready', answer: result.answer, model: result.model } : item));
    } catch (e) {
      if (version === epoch.current) setRecords(previous => previous.map(item => item.id === record.id && item.status !== 'cancelled' ? { ...item, status: 'error', error: controller.signal.aborted ? '回答超时，请重试。' : (e as Error).message } : item));
    } finally { clearTimeout(timer); answerJobs.current.delete(record.id); }
  }
  function sendQuestion() {
    const text = question.trim(); if (!text || !meeting) return;
    const first = /(?:^|\s)@/.exec(text);
    const targetName = first ? members.find(name => { const start = first.index + first[0].length; return text.slice(start, start + name.length) === name && (!text[start + name.length] || /[\s，。！？、,:：!?]/.test(text[start + name.length])); }) : null;
    if (first && !targetName) { setError('请选择已加入的成员；专家需先加入会议。'); return; }
    const target = experts.find(item => item.name === targetName);
    const prompt = target ? text.replace('@' + target.name, '').replace(/^[\s，。！？、,:：!?]+/, '').trim() : '';
    if (target && !prompt) { setError('请在 @专家名 后输入问题。'); return; }
    setError(''); setQuestion(''); setMention(null); setTab('discussion');
    const messageId = uid();
    setDiscussion(previous => [...previous, { id: messageId, text, taskTitle: selected?.title || '整份会议纪要', taskId: selected?.id || null }]);
    if (!target) return;
    const record: Record = { id: messageId, expert: { ...target }, task: selected ? { ...selected } : null, text: prompt, displayText: text, context: contextFor(selected), status: 'loading' };
    setRecords(previous => [...previous, record]); setActiveExpert(target.key); void requestAnswer(record);
  }
  function removeExpert() {
    if (!expert) return;
    const remaining = experts.filter(item => item.key !== expert.key); setExperts(remaining); setActiveExpert(remaining[0]?.key || '');
    const cancelled = records.filter(item => item.expert.key === expert.key && item.status === 'loading');
    cancelled.forEach(item => answerJobs.current.get(item.id)?.abort());
    setRecords(previous => previous.map(item => item.expert.key === expert.key && item.status === 'loading' ? { ...item, status: 'cancelled' } : item));
    setToast('专家已移除，已有回答保留在讨论中。');
  }
  function updateMention(value: string, caret: number) {
    const match = /(?:^|\s)@([^@\s]*)$/.exec(value.slice(0, caret));
    setMention(match ? { start: caret - match[1].length - 1, end: caret, query: match[1] } : null); setMentionIndex(0);
  }
  function selectMention(name: string) {
    if (!mention) return; const prefix = question.slice(0, mention.start) + '@' + name + ' ';
    setQuestion(prefix + question.slice(mention.end).replace(/^\s*/, '')); setMention(null);
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(prefix.length, prefix.length); });
  }
  function exportMeeting() {
    if (!meeting) return;
    const text = `# ${meeting.title}\n\n本人：${meeting.person}\n\n${meeting.summary}\n\n## 我的任务\n\n${tasks.map(task => `- [${task.completed ? 'x' : ' '}] ${task.title}\n  负责人：${task.owner}；截止：${task.deadline}\n  原文：${task.sourceQuote}`).join('\n\n')}\n\n## 讨论\n\n${discussion.map(item => `${item.taskTitle}：${item.text}`).join('\n\n')}\n\n## 专家回答\n\n${records.map(item => `### ${item.expert.name} · ${item.task?.title || '整份会议纪要'}\n\n问题：${item.text}\n\n${item.answer ? `${item.answer.answerTitle}\n\n${item.answer.answerBody}\n\n参考依据：${item.answer.evidence.join('；')}\n\n建议：${item.answer.action}${item.confirmed ? '\n\n已确认 · 模拟执行' : ''}` : item.error || '未完成'}`).join('\n\n')}\n\n## 原始纪要\n\n${meeting.minutes}`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = 'meeting-tasks.md'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const visibleRecords = records.filter(item => item.expert.key === activeExpert && (!search.trim() || [item.task?.title, item.text, item.answer?.answerTitle, item.answer?.answerBody, ...(item.answer?.evidence || []), item.answer?.action].join(' ').toLowerCase().includes(search.trim().toLowerCase())));
  function answerCard(record: Record, compact = false) {
    return <article className={'expert-message answer-card ' + record.status} key={record.id}>
      <div className="message-title"><Sparkles size={14} /><strong>{record.expert.name}</strong><span>{record.status === 'ready' ? '已完成' : record.status === 'loading' ? '分析中' : record.status === 'cancelled' ? '已中止' : '请求失败'}</span></div>
      <p className="answer-task">{record.task?.title || '整份会议纪要'}</p><p className="answer-question">{marked(record.displayText)}</p>
      {record.status === 'loading' ? <div className="answer-loading" role="status"><LoaderCircle size={17} className="spin" />正在结合纪要、任务与讨论分析…</div> : record.status === 'error' ? <><p role="alert">{record.error}</p>{experts.some(item => item.key === record.expert.key) && <button className="button ghost small" onClick={() => void requestAnswer(record)}>重试回答</button>}</> : record.status === 'cancelled' ? <p>专家已离开，本次分析已中止。</p> : record.answer && <>
        <div className="finding"><span className="finding-label">{record.answer.answerTitle}</span><p>{marked(record.answer.answerBody)}</p></div>
        {!compact && <p className="answer-model">{record.model}{record.answer.confidence !== null ? ` · 置信度 ${record.answer.confidence}%` : ''}</p>}
        {!!record.answer.evidence.length && <details className="answer-details"><summary>参考依据 · {record.answer.evidence.length} 条</summary>{record.answer.evidence.map((item, index) => <blockquote key={index}>{marked(item)}</blockquote>)}<button className="text-button" onClick={() => setModal('source')}>核对原始纪要 <ChevronRight size={12} /></button></details>}
        {record.answer.action && <details className="answer-details" open={record.confirmed}><summary>建议动作{record.confirmed ? ' · 已确认' : ''}</summary><p>{record.answer.action}</p>{record.confirmed ? <span className="hint-pill"><Check size={12} />已确认 · 模拟执行</span> : <button className="button ghost small" onClick={() => setConfirmation(record)}>确认建议动作</button>}</details>}
      </>}
    </article>;
  }

  return <div className="app-shell minutes-room">
    <WorkspaceNav page="minutes" person={meeting?.person} />
    <div className="workspace">
      <header className="topbar"><div className="wordmark">席位 <span>SEAT</span></div><div className="breadcrumb">工作空间 <ChevronRight size={13} /> 专家会议室</div><div className="top-actions"><span className="local-label"><ShieldCheck size={14} /> 本地工作空间</span><button className="button ghost small" onClick={() => meeting ? setClearConfirm(true) : openImport()}><Plus size={15} /> 新会议</button></div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow">A PLACE FOR EXPERTISE</div><h1>让会议讨论，成为行动<span>。</span></h1><p>先找到与你相关的任务，再让专业知识加入讨论。</p></div>{meeting && <div className="session-indicator"><span className="status-dot" />{meeting.person} · {pending} 项待办</div>}</div>
        {error && <div className="alert" role="alert"><CircleHelp size={17} /><span>{error}</span><button aria-label="关闭提示" onClick={() => setError('')}><X size={15} /></button></div>}
        <div className="workflow-strip"><span className={!meeting ? 'current' : 'done'}><span>{meeting ? <Check size={12} /> : '01'}</span> 导入纪要</span><ChevronRight size={14} /><span className={meeting ? 'current' : ''}><span>02</span> 整理我的任务</span><ChevronRight size={14} /><span className={experts.length ? 'current' : ''}><span>03</span> 按需请专家协助</span></div>
        <div className="meeting-grid">
          <section className="meeting-panel panel">
            <div className="panel-heading"><div><span className="live-tag"><span /> {meeting ? 'READY' : 'IMPORT'}</span><h2>{meeting?.title || '我的会议任务'}</h2></div><button className="icon-button" onClick={openImport} aria-label={meeting ? '重新导入会议纪要' : '导入会议纪要'}><Upload size={18} /></button></div>
            <div className="minutes-overview"><span className="avatar violet"><UserRound size={18} /></span><div><strong>{meeting ? `${meeting.person}的行动清单` : '从一份会议纪要开始'}</strong><span>{meeting ? `${tasks.length} 项相关任务 · ${tasks.length - pending} 项已完成` : '按姓名识别分工，保留原文依据'}</span></div>{meeting && <button className="text-button" onClick={() => setModal('source')}><FileText size={13} />原始纪要</button>}</div>
            <div className="tabs"><button className={tab === 'tasks' ? 'selected' : ''} onClick={() => setTab('tasks')}>我的任务 <span>{tasks.length}</span></button><button className={tab === 'discussion' ? 'selected' : ''} onClick={() => setTab('discussion')}>任务讨论 <span>{discussion.length}</span></button><span className="transcript-label">{meeting ? '请核对模型整理结果' : '.txt / .md / 粘贴文本'}</span></div>
            <div className="transcript-scroll task-scroll">
              {!meeting ? <div className="empty-discussion minutes-empty"><div className="empty-icon"><FileText size={23} /></div><h3>会议结束，行动从这里开始</h3><p>导入纪要，整理本人负责、协作与待确认的安排。<br />需要帮助时，再邀请合适的专家。</p><button className="button primary" onClick={openImport}><Upload size={16} />导入纪要，整理我的任务</button><div className="empty-features"><span><Check size={12} />按姓名提取</span><span><Check size={12} />原文可核对</span><span><Check size={12} />专家按需介入</span></div></div> : tab === 'tasks' ? <>
                <div className="minutes-summary"><p>{meeting.summary || '已根据纪要整理与你相关的任务。'}</p><small>由 {meeting.model} 整理 · 截止时间保留原文表达</small></div>
                {meeting.notice && <p className="task-notice">{meeting.notice}</p>}
                {!tasks.length && <div className="empty-discussion"><h3>未找到明确分配给你的任务</h3><p>请检查姓名是否与原文一致，或查看原始纪要。</p><button className="button ghost small" onClick={openImport}>更改姓名 / 重新导入</button></div>}
                {tasks.map(task => <article className={'task-card ' + (selectedTaskId === task.id ? 'selected ' : '') + (task.completed ? 'completed' : '')} key={task.id}>
                  <div className="task-card-meta"><label className="task-check"><input type="checkbox" checked={!!task.completed} aria-label={'标记任务完成：' + task.title} onChange={event => setTasks(previous => previous.map(item => item.id === task.id ? { ...item, completed: event.target.checked } : item))} />{task.completed ? '已完成' : '待办'}</label><span>{task.involvement}</span>{task.needsConfirmation && <span className="task-uncertain">分工待确认</span>}{task.priority !== 'unspecified' && <span className="task-priority">{({ high: '高', medium: '中', low: '低' } as { [key: string]: string })[task.priority]}优先级</span>}</div>
                  <button className="task-select" aria-pressed={selectedTaskId === task.id} onClick={() => setSelectedTaskId(task.id)}><h3>{task.title}</h3><p>{task.description}</p></button><div className="task-facts"><span>负责人 <b>{task.owner}</b></span><span>截止 <b>{task.deadline}</b></span></div>
                  <details className="task-source"><summary>查看纪要原文依据</summary><blockquote>{task.sourceQuote}</blockquote></details><div className="task-assist"><span>{task.expertReason}</span><button className="text-button" onClick={() => invite(task)}>请专家协助 <ChevronRight size={13} /></button></div>
                </article>)}
              </> : <>
                {!discussion.length && <div className="empty-discussion"><div className="empty-icon"><MessageSquare size={22} /></div><h3>从一个任务问题开始</h3><p>普通消息记录在这里，@ 已加入的专家才会调用模型。</p></div>}
                {discussion.map(item => { const reply = records.find(record => record.id === item.id); return <Fragment key={item.id}><div className="transcript-line"><span className="speaker-dot violet">{meeting.person.slice(0, 1)}</span><div><div className="line-meta"><strong>{meeting.person}</strong><span>{item.taskTitle}</span></div><p>{marked(item.text)}</p></div></div>{reply && answerCard(reply, true)}</Fragment>; })}<div ref={discussionEnd} />
              </>}
            </div>
            {meeting && <div className="selected-task-bar"><div><small>当前讨论范围</small><strong>{selected?.title || '整份会议纪要'}</strong></div>{selected && <button className="icon-button" aria-label="取消任务选择" onClick={() => setSelectedTaskId(null)}><X size={15} /></button>}</div>}
            <form className="minutes-composer" onSubmit={event => { event.preventDefault(); sendQuestion(); }}>
              {mention && <div className="mention-menu" id="member-options" role="listbox" aria-label="参会成员">{candidates.length ? candidates.map((name, index) => <button type="button" role="option" id={'member-' + index} aria-selected={index === mentionIndex} className={index === mentionIndex ? 'selected' : ''} key={name} onMouseDown={event => event.preventDefault()} onClick={() => selectMention(name)}><span className="avatar tiny">{name.slice(0, 1)}</span><span>{name}</span><small>{experts.some(item => item.name === name) ? '专家 Agent' : '参会成员'}</small></button>) : <p>没有匹配成员，请先邀请专家。</p>}</div>}
              <div className="composer-input"><textarea ref={input} aria-label="任务讨论与专家提问" aria-autocomplete="list" aria-controls={mention ? 'member-options' : undefined} aria-expanded={!!mention} aria-activedescendant={mention && candidates.length ? 'member-' + mentionIndex : undefined} value={question} maxLength={3000} disabled={!meeting} placeholder={meeting ? '记录任务问题，输入 @ 选择成员或专家…' : '先导入纪要，再记录问题或 @专家提问…'} onChange={event => { setQuestion(event.target.value); updateMention(event.target.value, event.target.selectionStart); }} onClick={event => updateMention(question, event.currentTarget.selectionStart)} onKeyDown={event => {
                if (mention && candidates.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setMentionIndex(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + candidates.length) % candidates.length); }
                else if (mention && candidates.length && ['Enter', 'Tab'].includes(event.key)) { event.preventDefault(); selectMention(candidates[mentionIndex]); }
                else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); sendQuestion(); }
              }} /><button className="send-button" type="submit" aria-label="发送讨论" disabled={!meeting || !question.trim()}><Send size={16} /></button></div><div className="composer-foot"><span>普通消息仅记录 · @专家后开始分析</span><button type="button" className="text-button" disabled={!meeting} onClick={() => invite()}><Plus size={12} />邀请专家</button></div>
            </form>
          </section>
          <section className="expert-panel panel">
            <div className="expert-heading"><div className="expert-avatar"><Sparkles size={20} /></div><div><h2>分析与回答 <span className="expert-badge">ON DEMAND</span></h2><p>{expert?.description || '专业视角，在需要时加入'}</p></div><button className="icon-button" onClick={() => invite()} disabled={!meeting} aria-label="邀请专家"><Plus size={18} /></button></div>
            {experts.length > 0 && <div className="expert-tabs">{experts.map(item => <button key={item.key} className={item.key === activeExpert ? 'selected' : ''} onClick={() => setActiveExpert(item.key)}>{item.name}</button>)}</div>}
            {expert && <div className="answer-toolbar"><label><Search size={14} /><input aria-label="搜索专家回答" placeholder="搜索任务、问题、回答或依据" value={search} onChange={event => setSearch(event.target.value)} /></label><button className="icon-button" aria-label={'移除' + expert.name} onClick={removeExpert}><X size={14} /></button></div>}
            <div className="expert-scroll">
              {!experts.length ? <div className="expert-welcome"><div className="orb-wrap"><div className="orb-ring" /><div className="orb-ring second" /><div className="expert-orb"><Sparkles size={34} strokeWidth={1.3} /></div></div><div className="eyebrow">EXPERTISE, WHEN YOU NEED IT</div><h3>让专业，回应你的任务。</h3><p>先整理行动清单，再选择合适的专家。<br />添加专家只准备上下文，发送 @ 提问才会回答。</p><button className="button primary" disabled={!meeting} onClick={() => invite()}><Plus size={16} />邀请专家加入</button><span className="hint-pill"><ShieldCheck size={12} />建议动作由你确认</span></div> : visibleRecords.length ? visibleRecords.map(item => answerCard(item)) : <div className="empty-discussion expert-ready"><div className="empty-icon"><Sparkles size={23} /></div><h3>{search.trim() ? '没有匹配的回答' : `${expert?.name}已准备好`}</h3><p>{search.trim() ? '尝试其他任务、问题或依据关键词。' : '在左侧发送 @专家名 和问题，开始分析。'}</p>{!search.trim() && expert && <button className="button ghost small" onClick={() => { setQuestion(`@${expert.name} `); input.current?.focus(); }}>准备向专家提问</button>}</div>}
            </div><div className="meeting-footer"><span><ShieldCheck size={12} />回答供参考，请结合纪要原文核对</span><span>{records.filter(item => item.status === 'ready').length} 次回答</span></div>
          </section>
        </div>
        <div className="outcome-bar minutes-outcome"><div className="outcome-icon"><FileText size={20} /></div><div><h3>{meeting ? `${pending} 项待办，${records.filter(item => item.confirmed).length} 项建议已确认` : '从讨论到行动，让下一步更清晰'}</h3><p>{meeting ? '任务、讨论和专家回答可一起导出，便于后续跟进。' : '保留任务依据，按需邀请专家，把决定留给你。'}</p></div><button className="button ghost small" onClick={exportMeeting} disabled={!meeting}><ArrowDownToLine size={15} />导出会议记录</button></div>
        <footer className="page-footer"><span>SEAT · 让专业知识拥有一个席位</span><span>当前页面内保存 · 刷新后需重新导入 <button className="text-button" disabled={!meeting} onClick={() => setClearConfirm(true)}>清空工作台</button></span></footer>
      </main>
    </div>
    {(modal || confirmation || clearConfirm) && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) { closeModal(); setConfirmation(null); setClearConfirm(false); } }}>
      <div className={'modal ' + (modal === 'import' ? 'minutes-import-modal' : '')} role="dialog" aria-modal="true" aria-labelledby="room-modal-title">
        <div className="modal-heading"><div><div className="eyebrow">SEAT · EXPERT WORKSPACE</div><h2 id="room-modal-title">{confirmation ? '确认会议建议' : clearConfirm ? '开启新的会议工作台' : modal === 'import' ? '导入会议纪要' : modal === 'source' ? '原始会议纪要' : modal === 'expert' ? '为任务选择专家' : '企业知识库'}</h2></div><button className="icon-button" aria-label="关闭窗口" onClick={() => { closeModal(); setConfirmation(null); setClearConfirm(false); }}><X size={20} /></button></div>
        {confirmation ? <><p>{confirmation.expert.name}建议：</p><div className="document-content">{confirmation.answer?.action}</div><p className="muted small-print">确认后仅在当前会议记录模拟执行结果。</p><div className="modal-actions"><button className="button ghost" onClick={() => setConfirmation(null)}>返回讨论</button><button className="button primary" onClick={() => { const id = confirmation.id; setRecords(previous => previous.map(item => item.id === id ? { ...item, confirmed: true } : item)); setConfirmation(null); setToast('已确认并记录模拟执行结果。'); }}>确认并模拟执行</button></div></> : clearConfirm ? <><p>当前纪要、任务、讨论和专家回答将从工作台清空。需要留存时，请先导出记录。</p><div className="modal-actions"><button className="button ghost" onClick={() => setClearConfirm(false)}>保留当前会议</button><button className="button primary" onClick={() => { resetWorkspace(); setPerson(''); setMinutes(''); setFilename(''); setClearConfirm(false); setModal('import'); }}>清空并导入新纪要</button></div></> : modal === 'import' ? <>
          <p className="muted">填写纪要中的本人姓名，整理你负责、协作与需要确认的安排。</p>
          <label>本人姓名<input autoFocus maxLength={40} value={person} disabled={importing} placeholder="与纪要里的姓名一致，例如：周宁" onChange={event => setPerson(event.target.value)} /></label>
          <div className="minutes-input-head"><span>纪要文本</span><button className="text-button" disabled={importing} onClick={() => fileInput.current?.click()}><Upload size={13} />导入 .txt / .md</button></div>
          <input type="file" ref={fileInput} hidden accept=".txt,.md,.markdown,.text" onChange={event => { if (event.target.files?.[0]) void readFile(event.target.files[0]); event.target.value = ''; }} />
          <textarea className="minutes-text" aria-label="纪要文本" maxLength={30000} rows={10} value={minutes} disabled={importing} placeholder="粘贴会议纪要，保留负责人、截止时间等原始信息…" onChange={event => { fileEpoch.current++; setMinutes(event.target.value); setFilename(''); }} />
          <div className="minutes-input-foot"><span>{filename || 'UTF-8 / UTF-16 / GB18030 · 最大200 KB'}</span><span>{minutes.length.toLocaleString()} / 30,000 字</span></div>
          {importError && <div className="import-error" role="alert">{importError}</div>}
          <p className="small-print muted">纪要与姓名将发送给当前模型服务。重新提取成功后会替换当前工作台；提取失败时保留原有内容。{modelConfig && ` 当前模型：${modelConfig.model}。`}{modelConfig?.ready === false && '模型密钥尚未配置。'}</p>
          <div className="modal-actions"><button className="button ghost" disabled={importing} onClick={() => { setPerson('周宁'); setMinutes(sample); setFilename('示例纪要'); }}>填入示例</button><button className="button ghost" onClick={closeModal}>取消</button><button className="button primary" disabled={importing} onClick={() => void extractTasks()}>{importing ? <><LoaderCircle className="spin" size={15} />正在提取…</> : '提取我的任务'}</button></div>
          {importing && <p className="import-progress" role="status">正在阅读纪要、核对任务归属，请稍候…</p>}
        </> : modal === 'source' ? <><p className="muted">本人：{meeting?.person} · 请核对任务分工与截止时间</p><pre className="document-content">{meeting?.minutes}</pre><div className="modal-actions"><button className="button ghost" onClick={openImport}>更改姓名 / 重新提取</button><button className="button primary" onClick={closeModal}>返回工作台</button></div></> : modal === 'expert' ? <>
          <p className="muted">{selected ? `当前任务：${selected.title}` : '讨论范围：整份会议纪要'}<br />添加后准备上下文，发送 @ 提问才会调用模型。</p>
          <div className="expert-picker-grid">{catalog.map(item => <button className={pickedExpert === item.key && !customName.trim() ? 'selected' : ''} key={item.key} onClick={() => { setPickedExpert(item.key); setCustomName(''); }}><Sparkles size={17} /><strong>{item.name}</strong><span>{item.description}</span>{selected?.expertId === item.id && <small>适合当前任务</small>}</button>)}</div>
          <label>自定义专家角色<input maxLength={40} value={customName} placeholder="例如：项目管理专家" onChange={event => setCustomName(event.target.value)} /></label><div className="modal-actions"><button className="button ghost" onClick={closeModal}>取消</button><button className="button primary" onClick={addExpert}>添加并准备提问</button></div>
        </> : null}
      </div>
    </div>}
    {toast && <div className="toast" role="status"><Check size={15} />{toast}</div>}
  </div>;
}
