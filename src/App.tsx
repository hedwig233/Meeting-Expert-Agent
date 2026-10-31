import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, AudioLines, BookOpen, Check, ChevronDown, ChevronRight, CircleHelp, FileText, Headphones, LoaderCircle, MessageSquare, Pause, Play, Plus, Send, ShieldCheck, Sparkles, Upload, Volume2, VolumeX, X } from 'lucide-react';
import { decodePcm, time } from './audio';
import type { Config, Decision, Demo, Document, ExpertMessage, KnowledgeScope, Segment, Session, Source } from './types';
import KnowledgeScopeSelect from './KnowledgeScopeSelect';

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch('/api' + path, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || '请求失败'); return data;
}
function unique<T extends { id: string }>(items: T[], item: T): T[] { return items.some(x => x.id === item.id) ? items : [...items, item]; }

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [demo, setDemo] = useState<Demo | null>(null);
  const [docs, setDocs] = useState<Document[]>([]);
  const [uploadScope, setUploadScope] = useState<KnowledgeScope>('shared');
  const [connected, setConnected] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioBusy, setAudioBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [pendingRequest, setPendingRequest] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [question, setQuestion] = useState('');
  const [partial, setPartial] = useState('');
  const [sourceName, setSourceName] = useState('产品方案讨论 · 演示录音');
  const [sourceMode, setSourceMode] = useState<'sample' | 'dui' | 'openai' | 'local' | 'next_omni'>('sample');
  const asrLabel = sourceMode === 'next_omni' ? 'Qwen Omni 分段云转写' : sourceMode === 'local' ? 'Whisper 本地分段转写' : sourceMode === 'openai' ? 'OpenAI 实时转写' : '思必驰流式识别';
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [citation, setCitation] = useState<Source | null>(null);
  const [tab, setTab] = useState<'transcript' | 'decisions'>('transcript');
  const [speech, setSpeech] = useState(false);
  const [decisionDraft, setDecisionDraft] = useState<ExpertMessage | null>(null);
  const [decisionText, setDecisionText] = useState('');
  const [owner, setOwner] = useState(''); const [due, setDue] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState('');
  const audio = useRef<HTMLAudioElement>(null);
  const ws = useRef<WebSocket | null>(null);
  const pcm = useRef<Int16Array | null>(null);
  const sent = useRef(0); const started = useRef(false);
  const sourceUrl = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingSync = useRef<(() => void) | null>(null);
  const audioUpload = useRef<HTMLInputElement>(null); const docUpload = useRef<HTMLInputElement>(null);
  const transcriptEnd = useRef<HTMLDivElement>(null); const expertEnd = useRef<HTMLDivElement>(null);
  const [boot, setBoot] = useState(0);
  const [starting, setStarting] = useState(false);
  const ended = session?.status === 'ended';
  const busy = thinking || pendingRequest;

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [c, d, fixture] = await Promise.all([api<Config>('/config'), api<Document[]>('/documents'), api<Demo>('/demo')]);
        if (!active) return; setConfig(c); setDocs(d); setDemo(fixture); setDuration(fixture.duration);
        let current: Session | null = null; const saved = sessionStorage.getItem('seat-session');
        if (saved) { try { current = await api<Session>('/sessions/' + saved); } catch { /* start a clean session */ } }
        if (!current) current = await api<Session>('/sessions', 'POST');
        if (active) { sessionStorage.setItem('seat-session', current.id); setSession(current); }
      } catch (e) { if (active) setError((e as Error).message); }
    })();
    return () => { active = false; };
  }, [boot]);

  useEffect(() => {
    if (!session?.id) return;
    const socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/meeting?session=' + session.id);
    ws.current = socket;
    socket.onopen = () => setConnected(true);
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.type === 'connected') setSession(message.session);
      if (message.type === 'segment') { setPartial(''); setSession(s => s ? { ...s, segments: unique(s.segments, message.segment) } : s); }
      if (message.type === 'partial') setPartial(message.segment.text);
      if (message.type === 'expert.status') setThinking(message.status === 'thinking');
      if (message.type === 'expert.message') setSession(s => s ? { ...s, messages: unique(s.messages, message.message) } : s);
      if (message.type === 'decision') setSession(s => s ? { ...s, decisions: unique(s.decisions, message.decision) } : s);
      if (message.type === 'ended') setSession(s => s ? { ...s, status: 'ended' } : s);
      if (message.type === 'stream.synced') { pendingSync.current?.(); pendingSync.current = null; }
      if (message.type === 'error') { setError(message.error); audio.current?.pause(); }
    };
    socket.onclose = () => { setConnected(false); audio.current?.pause(); };
    socket.onerror = () => setError('会议连接中断。点击重新连接恢复会议。');
    return () => { socket.close(); ws.current = null; setConnected(false); };
  }, [session?.id, boot]);

  useEffect(() => { transcriptEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [session?.segments.length, partial]);
  useEffect(() => { expertEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [session?.messages.length, thinking]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t); }, [toast]);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); window.speechSynthesis?.cancel(); if (sourceUrl.current) URL.revokeObjectURL(sourceUrl.current); }, []);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => { if (event.key === 'Escape') { setKnowledgeOpen(false); setCitation(null); setDecisionDraft(null); } };
    window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle);
  }, []);

  function sendAudio() {
    const player = audio.current; const socket = ws.current;
    if (!player || !pcm.current || socket?.readyState !== WebSocket.OPEN || !started.current) return;
    const end = Math.min(pcm.current.length, Math.floor(player.currentTime * 16000));
    while (sent.current < end) {
      if (socket.bufferedAmount > 1024 * 1024) { setError('音频发送积压，已暂停。请检查连接。'); player.pause(); return; }
      const count = Math.min(1600, end - sent.current);
      const chunk = pcm.current.slice(sent.current, sent.current + count);
      socket.send(chunk.buffer); sent.current += count;
    }
    if (sourceMode === 'sample') socket.send(JSON.stringify({ type: 'sample.progress', time: player.currentTime }));
    setPosition(player.currentTime);
  }
  async function synchronize() {
    sendAudio();
    if (ws.current?.readyState !== WebSocket.OPEN) throw new Error('会议连接已断开。');
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { pendingSync.current = null; reject(new Error('等待音频同步超时，请重试。')); }, 23000);
      pendingSync.current = () => { clearTimeout(timeout); resolve(); };
      ws.current!.send(JSON.stringify({ type: 'stream.sync' }));
    });
  }
  async function toggleAudio() {
    if (audio.current && !audio.current.paused) { audio.current.pause(); return; }
    if (!connected || !demo || ended) return;
    setError(''); setAudioBusy(true);
    try {
      if (!pcm.current) { const response = await fetch(demo.audio); if (!response.ok) throw new Error('演示音频不存在，请先生成音频。'); pcm.current = await decodePcm(await response.blob()); }
      if (!started.current) {
        ws.current!.send(JSON.stringify({ type: 'stream.start', mode: sourceMode })); started.current = true;
      }
      if (audio.current!.ended) { setToast('录音已结束，可邀请专家，或开启一场新会议。'); return; }
      window.speechSynthesis?.cancel(); await audio.current!.play();
    } catch (e) { setError((e as Error).message); }
    finally { setAudioBusy(false); }
  }
  function onPlay() { setPlaying(true); timer.current = setInterval(sendAudio, 80); }
  function onPause() { sendAudio(); setPlaying(false); if (timer.current) clearInterval(timer.current); timer.current = null; ws.current?.readyState === WebSocket.OPEN && ws.current.send(JSON.stringify({ type: 'stream.flush' })); }
  async function chooseAudio(file: File) {
    if (started.current || session?.segments.length) { setError('更换音频前请开启新会议，避免混合会议上下文。'); return; }
    if (!config || config.asr === 'sample' || config.asrReady === false) { setError('语音识别服务尚未就绪；本地模式请先运行 npm.cmd run whisper:setup 并重启。'); return; }
    if (file.size > 40 * 1024 * 1024) { setError('音频文件不能超过 40 MB。'); return; }
    setAudioBusy(true); setError('');
    try {
      const decoded = await decodePcm(file); pcm.current = decoded;
      if (sourceUrl.current) URL.revokeObjectURL(sourceUrl.current);
      sourceUrl.current = URL.createObjectURL(file); audio.current!.src = sourceUrl.current;
      setDuration(decoded.length / 16000); setSourceName(file.name); setSourceMode(config.asr); setToast('音频已准备好，将通过配置的语音服务实时识别。');
    } catch (e) { setError((e as Error).message); } finally { setAudioBusy(false); }
  }
  async function askExpert(prompt?: string) {
    if (!session || busy || ended) return;
    audio.current?.pause(); window.speechSynthesis?.cancel();
    setError(''); setPendingRequest(true);
    try {
      if (started.current) await synchronize();
      const result = await api<ExpertMessage>('/sessions/' + session.id + '/expert', 'POST', { question: prompt ?? question });
      setSession(s => s ? { ...s, messages: unique(s.messages, result) } : s); setQuestion('');
      if (speech && 'speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(result.finding + ' ' + result.question); utterance.lang = 'zh-CN'; window.speechSynthesis.speak(utterance);
      }
    } catch (e) { setError((e as Error).message); } finally { setPendingRequest(false); }
  }
  async function newMeeting() {
    setStarting(true); audio.current?.pause(); window.speechSynthesis?.cancel();
    try {
      const next = await api<Session>('/sessions', 'POST'); ws.current?.close();
      if (sourceUrl.current) URL.revokeObjectURL(sourceUrl.current); sourceUrl.current = null;
      pcm.current = null; sent.current = 0; started.current = false; setSourceMode('sample'); setSourceName('产品方案讨论 · 演示录音'); setPartial(''); setPosition(0); setDuration(demo?.duration || 0); setQuestion(''); setDecisionDraft(null); setError('');
      if (audio.current && demo) { audio.current.src = demo.audio; audio.current.load(); }
      sessionStorage.setItem('seat-session', next.id); setSession(next);
    } catch (e) { setError((e as Error).message); } finally { setStarting(false); }
  }
  async function uploadDocument(file: File) {
    try {
      if (!/\.(md|txt)$/i.test(file.name)) throw new Error('目前支持 Markdown 和 TXT 资料。');
      if (file.size > 300000) throw new Error('资料不能超过 300 KB。');
      const doc = await api<Document>('/documents', 'POST', { title: file.name, content: await file.text(), scope: uploadScope });
      setDocs(d => [...d, doc]); setToast('资料已加入本地知识库。');
    } catch (e) { setError((e as Error).message); }
  }
  async function changeDocumentScope(id: string, scope: KnowledgeScope) {
    try {
      const doc = await api<Document>('/documents/' + id, 'PATCH', { scope });
      setDocs(previous => previous.map(item => item.id === id ? doc : item));
    } catch (e) { setError((e as Error).message); }
  }
  async function confirmDecision() {
    if (!session || !decisionDraft || !decisionText.trim()) return;
    try {
      const result = await api<Decision>('/sessions/' + session.id + '/decisions', 'POST', { messageId: decisionDraft.id, text: decisionText, owner, due });
      setSession(s => s ? { ...s, decisions: unique(s.decisions, result) } : s); setDecisionDraft(null); setToast('已记录你确认的决策。');
    } catch (e) { setError((e as Error).message); }
  }
  async function addManual() {
    if (!session || !manual.trim()) return;
    try { const segment = await api<Segment>('/sessions/' + session.id + '/segments', 'POST', { text: manual, speaker: '你' }); setSession(s => s ? { ...s, segments: unique(s.segments, segment) } : s); setManual(''); setManualOpen(false); } catch (e) { setError((e as Error).message); }
  }
  async function endMeeting() {
    if (!session) return; audio.current?.pause();
    try { if (started.current) await synchronize(); await api('/sessions/' + session.id + '/end', 'POST'); setSession(s => s ? { ...s, status: 'ended' } : s); setTab('decisions'); } catch (e) { setError((e as Error).message); }
  }

  const latest = session?.messages.at(-1);
  return <div className="app-shell">
    <aside className="rail"><a className="brand-mark" href="/" aria-label="席位首页"><span /><span /><span /></a><button className="rail-button active" aria-label="会议工作台"><AudioLines size={22} /></button><button className="rail-button" onClick={() => setKnowledgeOpen(true)} aria-label="企业知识库"><BookOpen size={21} /></button><div className="rail-bottom"><span className="avatar tiny">你</span></div></aside>
    <div className="workspace">
      <header className="topbar"><div className="wordmark">席位 <span>SEAT</span></div><div className="breadcrumb">工作空间 <ChevronRight size={13} /> 专家会议室</div><div className="top-actions"><a className="button ghost small" href="/bridge.html">腾讯会议 Bot</a><span className="local-label"><ShieldCheck size={14} /> 本地工作空间</span><button className="button ghost small" onClick={newMeeting} disabled={starting || busy}><Plus size={15} /> 新会议</button></div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow">A PLACE FOR EXPERTISE</div><h1>让专业知识，加入讨论<span>。</span></h1><p>专家已了解会议背景。在需要的时候，给讨论一个新的视角。</p></div><div className="session-indicator"><span className={'status-dot ' + (ended ? 'off' : connected ? '' : 'off')} />{ended ? '会议已结束' : connected ? '会议连接就绪' : '正在连接'}<span className="session-code">#{session?.id.slice(0, 6).toUpperCase() || '------'}</span></div></div>
        {error && <div className="alert" role="alert"><CircleHelp size={17} /><span>{error}</span>{!connected && <button onClick={() => { setError(''); setBoot(v => v + 1); }}>重新连接</button>}<button aria-label="关闭提示" onClick={() => setError('')}><X size={15} /></button></div>}
        <div className="meeting-grid">
          <section className="meeting-panel panel">
            <div className="panel-heading"><div><span className="live-tag"><span /> {ended ? 'ENDED' : playing ? 'LIVE' : 'READY'}</span><h2>{session?.title || '正在准备会议…'}</h2></div><button className="icon-button" onClick={() => setManualOpen(v => !v)} title="文字补充会议内容" aria-label="文字补充会议内容"><MessageSquare size={18} /></button></div>
            <div className="participants"><div className="person-tile"><span className="avatar violet">林</span><div><strong>小林</strong><span>产品负责人 · 演示角色</span></div><div className={'waveform ' + (playing ? 'moving' : '')}>{[1, 2, 3, 4, 5].map(i => <i key={i} />)}</div></div><div className="person-tile"><span className="avatar blue">周</span><div><strong>阿周</strong><span>后端工程师 · 演示角色</span></div><div className={'waveform ' + (playing ? 'moving' : '')}>{[1, 2, 3, 4, 5].map(i => <i key={i} />)}</div></div></div>
            <div className="audio-source"><div className="source-icon"><Headphones size={18} /></div><div className="source-label"><strong>{sourceName}</strong><span>{sourceMode === 'sample' ? '合成录音 / 预置字幕按播放进度展示' : '真实音频 / ' + asrLabel}</span></div><button className="icon-button" onClick={() => audioUpload.current?.click()} disabled={audioBusy || !!session?.segments.length || started.current || !config || config.asr === 'sample'} aria-label="导入自定义会议音频" title={!config || config.asr === 'sample' ? '配置转写后可导入自定义音频' : '导入音频'}><Upload size={17} /></button></div>
            {!sourceUrl.current && <label className="audio-mode-selector" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 23px 0', fontSize: 10, color: '#94a391' }}>输入方式<select aria-label="音频识别方式" value={sourceMode} disabled={started.current || audioBusy || ended || !!session?.segments.length} onChange={e => setSourceMode(e.target.value as 'sample' | 'dui' | 'openai' | 'local' | 'next_omni')} style={{ background: '#17201f', color: '#c5d4bc', border: '1px solid #344333', borderRadius: 5, padding: '4px 8px', font: 'inherit' }}><option value="sample">预置字幕演示</option>{config?.asr === 'next_omni' ? <option value="next_omni">Qwen Omni 云端转写</option> : config?.asr === 'local' ? <option value="local" disabled={config.asrReady === false}>Whisper 本地转写</option> : config?.asr === 'dui' ? <option value="dui">思必驰真实转写</option> : <option value="openai" disabled={config?.asr !== 'openai'}>{config?.asr === 'openai' ? 'OpenAI 真实转写' : 'OpenAI 转写（先配置 API Key）'}</option>}</select></label>}
            <input ref={audioUpload} type="file" accept="audio/*" hidden onChange={e => { if (e.target.files?.[0]) void chooseAudio(e.target.files[0]); e.target.value = ''; }} />
            <audio ref={audio} src={demo?.audio} preload="metadata" onPlay={onPlay} onPause={onPause} onEnded={onPause} onError={() => { if (demo) setError('无法播放音频。请确认演示音频已生成。'); }} />
            <div className="player"><button className="play-button" aria-label={playing ? '暂停会议音频' : '播放会议音频'} disabled={!connected || audioBusy || ended || !demo} onClick={toggleAudio}>{audioBusy ? <LoaderCircle className="spin" size={19} /> : playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button><span className="time">{time(position)}</span><div className="progress-track" role="progressbar" aria-label="会议音频进度" aria-valuemin={0} aria-valuemax={Math.ceil(duration)} aria-valuenow={Math.floor(position)}><div style={{ width: duration ? Math.min(100, position / duration * 100) + '%' : '0%' }} /></div><span className="time muted">{time(duration)}</span><AudioLines size={16} className="muted" /></div>
            <div className="tabs"><button className={tab === 'transcript' ? 'selected' : ''} onClick={() => setTab('transcript')}>实时讨论 <span>{session?.segments.length || 0}</span></button><button className={tab === 'decisions' ? 'selected' : ''} onClick={() => setTab('decisions')}>已确认决策 <span>{session?.decisions.length || 0}</span></button><span className="transcript-label">{sourceMode === 'sample' ? '演示字幕' : 'ASR 转写'}</span></div>
            {manualOpen && !ended && <div className="manual-entry"><textarea aria-label="补充会议内容" value={manual} onChange={e => setManual(e.target.value)} placeholder="输入当前讨论，帮助专家了解背景…" maxLength={4000} /><button className="button primary small" disabled={!manual.trim()} onClick={addManual}>加入讨论</button></div>}
            <div className="transcript-scroll">
              {tab === 'transcript' ? <>{!session?.segments.length && <div className="empty-discussion"><div className="empty-icon"><AudioLines size={27} /></div><h3>讨论从这里开始</h3><p>播放一段演示会议，专家会同步了解背景。<br />也可以点击右上角，直接输入讨论内容。</p><span className="hint-pill"><Play size={11} /> 点击播放，开始演示</span></div>}{session?.segments.map((s, i) => <div className="transcript-line" key={s.id}><span className={'speaker-dot ' + (s.speaker.includes('周') ? 'blue' : 'violet')}>{s.speaker.slice(0, 1)}</span><div><div className="line-meta"><strong>{s.speaker}</strong><span>{time(s.start)}</span><small>{s.source === 'typed' ? '文字补充' : s.source === 'sample' ? '示例' : '实时识别'}</small></div><p>{s.text}</p></div></div>)}{partial && <p className="partial">{partial}<span className="typing-cursor" /></p>}<div ref={transcriptEnd} /></> : <>{!session?.decisions.length ? <div className="empty-discussion"><div className="empty-icon"><Check size={25} /></div><h3>让建议成为共识</h3><p>专家给出建议后，点击“记录为决策”，<br />确认最终方案、负责人和截止时间。</p></div> : session.decisions.map((d, i) => <div className="decision-item" key={d.id}><span className="decision-number">{String(i + 1).padStart(2, '0')}</span><div><strong>{d.text}</strong><p>{d.owner} <span>·</span> {d.due}</p><details><summary>查看决策前的讨论</summary><pre>{d.before}</pre></details></div></div>)}</>}
            </div>
            <div className="meeting-footer"><span><ShieldCheck size={13} /> {config?.expert === 'qwen' || sourceMode !== 'sample' ? '已配置云服务，调用时发送相关内容' : '当前模式在本地处理'}</span><button className="text-button" onClick={endMeeting} disabled={!session || ended || busy}>结束会议 <ArrowRight size={13} /></button></div>
          </section>

          <section className="expert-panel panel">
            <div className="expert-heading"><div className="expert-avatar"><Sparkles size={21} /></div><div><h2>架构评审专家 <span className="expert-badge">EXPERT</span></h2><p>{busy ? '正在理解讨论与检索资料…' : latest ? '已加入讨论，随时继续交流' : '静默旁听，等待你的邀请'}</p></div><span className="status-dot" /></div>
            <button className="knowledge-strip" onClick={() => setKnowledgeOpen(true)}><BookOpen size={15} /><span>企业知识库</span><strong>{docs.length} 份资料</strong><ChevronRight size={14} /></button>
            <div className="expert-scroll">
              {!session?.messages.length && !busy && <div className="expert-welcome"><div className="orb-wrap"><div className="orb-ring ring-one" /><div className="orb-ring ring-two" /><div className="expert-orb"><Sparkles size={34} strokeWidth={1.3} /></div><span className="orb-dot" /></div><div className="eyebrow">CONTEXT AWARE. READY WHEN YOU ARE.</div><h3>一个席位，<br />一位了解背景的专家。</h3><p>带着企业知识加入当前讨论，<br />找到遗漏的约束，给出有出处的建议。</p><button className="button primary invite" onClick={() => askExpert('请结合公司资料，评审我们刚才讨论的方案。')} disabled={!session?.segments.length || !connected || ended}><Sparkles size={17} /> 邀请专家加入 <ArrowRight size={16} /></button><span className="welcome-note">{session?.segments.length ? '无需重述背景，专家已获得当前记录' : '先播放会议音频，或补充一段讨论'}</span></div>}
              {session?.messages.map((m, i) => <article className="expert-message" key={m.id}>{m.request && <div className="user-question"><span>你</span><p>{m.request}</p></div>}<div className="message-title"><Sparkles size={15} /><strong>架构评审专家</strong><span>{time(m.contextSeconds)} 的会议上下文</span></div><p className="context-summary">{m.contextSummary}</p><div className="finding"><span className="finding-label">评审观察</span><p>{m.finding}</p><p className="impact">{m.impact}</p></div><div className="expert-question"><CircleHelp size={16} /><p>{m.question}</p></div><p className="proposal"><span>建议</span>{m.proposal}</p>{m.citations.length > 0 && <div className="citations">{m.citations.map((c, j) => <button key={c.id} onClick={() => setCitation(c)}><span>{j + 1}</span><FileText size={12} />{c.heading}<ChevronRight size={12} /></button>)}</div>}<div className="message-actions"><span>{m.mode === 'local' ? '本地规则演示' : (m.provider === 'openai_next' ? 'Next · 检索增强' : m.provider === 'openai' ? 'OpenAI · 检索增强' : m.provider === 'deepseek' ? 'DeepSeek · 检索增强' : 'Qwen · 检索增强')} · {m.confidence}</span><button className="text-button" disabled={ended || session.decisions.some(d => d.messageId === m.id)} onClick={() => { setDecisionDraft(m); setDecisionText(m.proposal); setOwner(''); setDue(''); }}>{session.decisions.some(d => d.messageId === m.id) ? <><Check size={13} /> 已记录</> : <><Plus size={13} /> 记录为决策</>}</button></div></article>)}
              {busy && <div className="thinking-state"><LoaderCircle size={17} className="spin" /><div><strong>专家正在评审</strong><p>读取会议上下文 · 检索内部依据</p></div></div>}<div ref={expertEnd} />
            </div>
            <div className="expert-composer">{latest && !busy && !ended && <button className="quick-prompt" onClick={() => askExpert('补充：我们已经实现幂等，请根据这个信息重新评审。')}>补充：我们已经实现幂等 <ArrowRight size={12} /></button>}<form onSubmit={e => { e.preventDefault(); void askExpert(); }}><textarea aria-label="向专家提问" rows={1} placeholder={ended ? '会议已结束，开启新会议继续讨论' : '追问专家，或补充一个关键条件…'} value={question} onChange={e => setQuestion(e.target.value)} maxLength={3000} disabled={ended} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (question.trim()) void askExpert(); } }} /><button className="send-button" type="submit" disabled={busy || !question.trim() || !session?.segments.length || ended || !connected} aria-label="发送问题"><Send size={17} /></button></form><div className="composer-footer"><span>{config?.expert === 'qwen' ? config.model : '本地规则演示 · 未调用大模型'}</span><div>{busy && <button className="text-button" onClick={() => { if (session) void api('/sessions/' + session.id + '/cancel', 'POST').catch(e => setError(e.message)); }}>取消</button>}<button className="icon-button" aria-label={speech ? '关闭专家语音' : '开启专家语音'} title="使用浏览器语音播放回答" onClick={() => { if (speech) window.speechSynthesis?.cancel(); setSpeech(!speech); }}>{speech ? <Volume2 size={15} /> : <VolumeX size={15} />}</button></div></div></div>
          </section>
        </div>
        <section className="outcome-bar"><div className="outcome-icon"><Check size={19} /></div><div><h3>让每一次讨论，都有可回溯的改变</h3><p>{session?.decisions.length ? '已确认 ' + session.decisions.length + ' 项决策，原始讨论与专家依据一并保留。' : '专家提出建议，由你确认决策。保留讨论、依据与最终方案。'}</p></div><a className={'button ghost small ' + (!session ? 'disabled' : '')} href={session ? '/api/sessions/' + session.id + '/export' : undefined} download><ArrowDownToLine size={15} /> 导出会议记录</a></section>
        <footer className="page-footer"><span>SEAT / 专业知识，在场。</span><span>{sourceMode === 'sample' ? '预录音频 + 预置字幕' : asrLabel} <span className="footer-separator">/</span> {config?.expert === 'qwen' ? '真实模型推理' : '规则演示'} <span className="footer-separator">/</span> 单工作空间原型</span></footer>
      </main>
    </div>
    {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
    {(knowledgeOpen || citation || decisionDraft) && <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) { setKnowledgeOpen(false); setCitation(null); setDecisionDraft(null); } }}><section className="modal" role="dialog" aria-modal="true" aria-label={citation ? '引用原文' : decisionDraft ? '确认决策' : '企业知识库'}><div className="modal-heading"><div><div className="eyebrow">{citation ? 'SOURCE OF TRUTH' : decisionDraft ? 'DECISION, CONFIRMED BY YOU' : 'YOUR COMPANY, YOUR KNOWLEDGE'}</div><h2>{citation ? '查看引用依据' : decisionDraft ? '确认会议决策' : '专家的企业知识库'}</h2></div><button autoFocus className="icon-button" aria-label="关闭窗口" onClick={() => { setKnowledgeOpen(false); setCitation(null); setDecisionDraft(null); }}><X size={20} /></button></div>{citation ? <><span className="document-origin">{citation.origin}</span><h3>{citation.title}</h3><div className="source-heading">{citation.heading}</div><pre className="document-content">{citation.text}</pre><p className="muted small-print">引用 ID：{citation.id}。原文依据不等于已验证当前实现。</p></> : decisionDraft ? <><p className="muted">请核对或修改建议。只有你确认后，它才会成为会议决策。</p><label>确认后的方案<textarea value={decisionText} onChange={e => setDecisionText(e.target.value)} maxLength={4000} /></label><div className="form-grid"><label>负责人<input placeholder="未约定则留空" value={owner} onChange={e => setOwner(e.target.value)} maxLength={80} /></label><label>截止时间<input type="date" value={due} onChange={e => setDue(e.target.value)} /></label></div><button className="button primary" onClick={confirmDecision} disabled={!decisionText.trim()}><Check size={15} /> 确认并记录</button></> : <><p className="muted">资料统一保存，专家只检索公共知识和自己的专属知识。上传 Markdown / TXT 前请选择范围；已有资料也可修改范围。</p><div className="document-list">{docs.map(d => <details key={d.id}><summary><span className="document-icon"><FileText size={19} /></span><span><strong>{d.title}</strong><small>{d.origin} · {d.content.length} 字</small></span><ChevronDown size={16} /></summary><KnowledgeScopeSelect label={d.title + "的知识范围"} value={d.scope || "shared"} onChange={scope => { void changeDocumentScope(d.id, scope); }} /><pre className="document-content">{d.content}</pre></details>)}</div><KnowledgeScopeSelect label="上传知识范围" value={uploadScope} onChange={setUploadScope} /> <button className="button ghost" onClick={() => docUpload.current?.click()}><Upload size={15} /> 添加企业资料</button><input ref={docUpload} hidden type="file" accept=".md,.txt" onChange={e => { if (e.target.files?.[0]) void uploadDocument(e.target.files[0]); e.target.value = ''; }} /><p className="small-print muted">资料保存在本机 SQLite。配置云模型后，检索片段将随问题发送给模型服务。当前原型无企业账号或文档级权限控制。</p></>}</section></div>}
  </div>;
}
