import { useEffect, useRef, useState } from 'react';
import { AudioLines, BookOpen, Check, ChevronRight, Headphones, LoaderCircle, Mic, Play, Plus, Send, ShieldCheck, Sparkles, Square, Volume2, X } from 'lucide-react';
import { captureDesktop, listOutputDevices, routeAudio } from './desktop-audio';
import type { DesktopCapture } from './desktop-audio';
import type { Config, ExpertMessage, Session } from './types';
import WorkspaceNav from './WorkspaceNav';
import { containsWakeCommand } from './wake-word.mjs';

type BridgeConfig = Config & { provider?: string; speech?: boolean; speechProvider?: string; speechModel?: string; speechVoice?: string };
async function request<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const response = await fetch('/api' + path, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || '请求失败'); return data;
}

export default function Bridge() {
  const [config, setConfig] = useState<BridgeConfig | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<'architecture' | 'evidence'>('evidence');
  const [connected, setConnected] = useState(false); const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false); const [speaking, setSpeaking] = useState(false);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]); const [output, setOutput] = useState('');
  const [level, setLevel] = useState(0); const [seconds, setSeconds] = useState(0);
  const [partial, setPartial] = useState(''); const [question, setQuestion] = useState('');
  const [asrNotice, setAsrNotice] = useState('');
  const [asrQueue, setAsrQueue] = useState({ pending: 0, processing: false, paused: false });
  const [skippedSeconds, setSkippedSeconds] = useState(0);
  const [error, setError] = useState(''); const [status, setStatus] = useState('准备设备与会议');
  const [trigger, setTrigger] = useState('请太医发言'); const [autoTrigger, setAutoTrigger] = useState(true);
  const [voiceReady, setVoiceReady] = useState(false); const [reconnect, setReconnect] = useState(0);
  const socket = useRef<WebSocket | null>(null); const capture = useRef<DesktopCapture | null>(null);
  const transmitting = useRef(false); const busyRef = useRef(false); const sessionRef = useRef<Session | null>(null);
  const asrPaused = useRef(false);
  const speechPlayer = useRef<HTMLAudioElement>(null); const speechUrl = useRef<string | null>(null);
  const triggerRef = useRef({ text: trigger, enabled: autoTrigger });
  const consultRef = useRef<(text?: string) => Promise<void>>(async () => {});
  const seenTriggers = useRef(new Set<string>());
  const resumeAfterSpeech = useRef(false); const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { triggerRef.current = { text: trigger, enabled: autoTrigger }; }, [trigger, autoTrigger]);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const c = await request<BridgeConfig>('/config');
        if (!active) return; setConfig(c);
        let s: Session | null = null; const saved = sessionStorage.getItem('seat-bridge-session');
        if (saved) { try { s = await request<Session>('/sessions/' + saved); } catch { /* deleted local session */ } }
        if (!s || s.status === 'ended') s = await request<Session>('/sessions', { title: '宫廷证据评审会', expertRole: 'evidence' });
        if (active) { setSession(s); setRole((s as Session & { expertRole?: 'evidence' | 'architecture' }).expertRole || 'evidence'); sessionStorage.setItem('seat-bridge-session', s.id); }
      } catch (e) { if (active) setError((e as Error).message); }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!session?.id) return;
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/meeting?session=' + session.id);
    socket.current = ws;
    ws.onopen = () => { setConnected(true); setStatus('会议控制台连接就绪'); };
    ws.onmessage = raw => {
      const event = JSON.parse(raw.data);
      if (event.type === 'connected') setSession(event.session);
      if (event.type === 'segment') {
        setPartial(''); setSession(s => s && !s.segments.some(x => x.id === event.segment.id) ? { ...s, segments: [...s.segments, event.segment] } : s);
        const t = triggerRef.current;
        if (t.enabled && containsWakeCommand(event.segment.text, t.text) && !seenTriggers.current.has(event.segment.id)) {
          seenTriggers.current.add(event.segment.id);
          if (!busyRef.current) void consultRef.current('请基于已经发生的讨论和知识资料，提出有依据的建议并追问必要条件。');
        }
      }
      if (event.type === 'partial') setPartial(event.segment.text);
      if (event.type === 'asr.notice') { setAsrNotice(event.text); setPartial(''); }
      if (event.type === 'asr.state') {
        asrPaused.current = event.paused;
        setAsrQueue({ pending: event.pending, processing: event.processing, paused: event.paused });
      }
      if (event.type === 'expert.message') setSession(s => s && !s.messages.some(m => m.id === event.message.id) ? { ...s, messages: [...s.messages, event.message] } : s);
      if (event.type === 'error') { setError(event.error); transmitting.current = false; void capture.current?.stop(); }
    };
    ws.onclose = () => { setConnected(false); transmitting.current = false; void capture.current?.stop(); setStatus('会议连接已断开'); };
    ws.onerror = () => setError('本地连接中断，请确认服务正在运行，再重新连接。');
    return () => { ws.close(); transmitting.current = false; void capture.current?.stop(); socket.current = null; };
  }, [session?.id, reconnect]);
  useEffect(() => () => { void capture.current?.stop(); activeRequest.current?.abort(); if (speechUrl.current) URL.revokeObjectURL(speechUrl.current); }, []);

  function send(event: unknown) {
    if (socket.current?.readyState !== WebSocket.OPEN) throw new Error('会议连接尚未就绪。');
    socket.current.send(JSON.stringify(event));
  }
  function waitFor(type: string, timeoutMs = 25000): Promise<void> {
    const ws = socket.current; if (!ws) return Promise.reject(new Error('会议连接不存在。'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('等待最终转写超时，请稍后重试。')), timeoutMs);
      function handler(event: MessageEvent) { const data = JSON.parse(event.data); if (data.type === type) finish(); else if (data.type === 'error') finish(new Error(data.error)); }
      function closed() { finish(new Error('会议连接已关闭。')); }
      function finish(error?: Error) { clearTimeout(timer); ws!.removeEventListener('message', handler); ws!.removeEventListener('close', closed); if (error) reject(error); else resolve(); }
      ws.addEventListener('message', handler); ws.addEventListener('close', closed);
    });
  }
  async function sync() { const ready = waitFor('stream.synced', config?.asr === 'next_omni' ? 300000 : 25000); send({ type: 'stream.sync' }); await ready; }

  async function refreshOutputs() {
    setError('');
    try {
      const devices = await listOutputDevices(); setOutputs(devices);
      const cable = devices.find(d => /cable.*input/i.test(d.label));
      if (cable) setOutput(cable.deviceId);
      else setError('未发现 CABLE Input。确认驱动安装后已重启，并在浏览器允许音频设备权限。');
    } catch (e) { setError((e as Error).message); }
  }
  async function startListening() {
    if (!connected || busyRef.current) return;
    if (!config || config.asr === 'sample' || config.asrReady === false) { setError(config?.asr === 'local' ? '本地 Whisper 尚未安装。请在本机终端运行 npm.cmd run whisper:setup，完成后重启服务。' : '后端尚未配置可用转写服务，请检查 ASR 配置后重启。'); return; }
    if (!output) { setError('先选择 CABLE Input 作为专家发言设备。'); return; }
    setError(''); setStatus('请选择整个屏幕并勾选共享系统音频'); transmitting.current = false;
    asrPaused.current = false; setAsrQueue({ pending: 0, processing: false, paused: false }); setAsrNotice('');
    try {
      capture.current = await captureDesktop((audio, rms) => {
        setLevel(Math.min(1, rms * 8));
        const ws = socket.current;
        if (!transmitting.current || ws?.readyState !== WebSocket.OPEN) return;
        if (asrPaused.current) { setSkippedSeconds(s => s + audio.byteLength / 32000); return; }
        if (ws.bufferedAmount > 1024 * 1024) { setError('音频发送积压，已停止监听。'); transmitting.current = false; void capture.current?.stop(); return; }
        ws.send(audio); setSeconds(s => s + audio.byteLength / 32000);
      }, () => {
        transmitting.current = false; capture.current = null; setListening(false); setLevel(0);
        if (socket.current?.readyState === WebSocket.OPEN) send({ type: 'stream.flush' });
      });
      const ready = waitFor('stream.ready', 10000); send({ type: 'stream.start', mode: config.asr, hint: trigger }); await ready;
      transmitting.current = true; setListening(true); setStatus('正在听取腾讯会议音频');
    } catch (e) { void capture.current?.stop(); setError((e as Error).message); setStatus('监听未启动'); }
  }
  async function stopListening() {
    transmitting.current = false; await capture.current?.stop();
    busyRef.current = true; setBusy(true); setStatus('等待最后一段转写');
    try { await sync(); setStatus('监听已停止，会议记录已保留'); }
    catch (e) { setError((e as Error).message); }
    finally { busyRef.current = false; setBusy(false); }
  }
  function finishSpeech() {
    setSpeaking(false); setVoiceReady(false);
    if (resumeAfterSpeech.current && capture.current) { transmitting.current = true; setStatus('正在听取腾讯会议音频'); }
    else setStatus('专家发言结束');
    resumeAfterSpeech.current = false;
  }
  async function playVoice(messageId?: string, test = false) {
    if (!sessionRef.current || !speechPlayer.current) return;
    await routeAudio(speechPlayer.current, output);
    setStatus(config?.speechProvider === 'next_omni' ? '正在生成 Qwen 专家语音' : '正在生成专家语音');
    const controller = new AbortController(); activeRequest.current = controller;
    const response = await fetch('/api/sessions/' + sessionRef.current.id + '/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(test ? { test: true } : { messageId }), signal: controller.signal });
    if (!response.ok) { const data = await response.json(); throw new Error(data.error || '语音生成失败'); }
    if (speechUrl.current) URL.revokeObjectURL(speechUrl.current);
    speechUrl.current = URL.createObjectURL(await response.blob()); speechPlayer.current.src = speechUrl.current;
    setVoiceReady(true); setSpeaking(true); setStatus('专家语音正在经 CABLE Input 发往腾讯会议');
    try { await speechPlayer.current.play(); }
    catch { setSpeaking(false); setStatus('浏览器限制自动播放，请点击“播放已生成语音”'); }
  }
  async function consult(text?: string) {
    const s = sessionRef.current; if (!s || busyRef.current || speaking) return;
    busyRef.current = true; setBusy(true); setError('');
    const wasListening = Boolean(capture.current); transmitting.current = false; resumeAfterSpeech.current = wasListening;
    try {
      if (wasListening) { setStatus('提交当前语音并等待最终转写'); await sync(); }
      setStatus('专家正在检索知识并分析当前讨论');
      const result = await request<ExpertMessage>('/sessions/' + s.id + '/expert', { question: text || question || '请评审当前讨论，指出有依据的疑点与需要澄清的条件。' });
      setSession(previous => previous && !previous.messages.some(m => m.id === result.id) ? { ...previous, messages: [...previous.messages, result] } : previous); setQuestion('');
      await playVoice(result.id);
    } catch (e) { setError((e as Error).message); setStatus('专家请求未完成'); if (wasListening && capture.current) transmitting.current = true; }
    finally { busyRef.current = false; setBusy(false); activeRequest.current = null; }
  }
  consultRef.current = consult;
  async function testVoice() {
    if (busyRef.current || speaking) return; busyRef.current = true; setBusy(true); setError('');
    resumeAfterSpeech.current = Boolean(capture.current); transmitting.current = false;
    try { if (capture.current) await sync(); setStatus('正在生成发言通道测试语音'); await playVoice(undefined, true); }
    catch (e) { setError((e as Error).message); setStatus('发言通道测试未完成'); if (capture.current) transmitting.current = true; }
    finally { busyRef.current = false; setBusy(false); activeRequest.current = null; }
  }
  function stopVoice() {
    speechPlayer.current?.pause(); activeRequest.current?.abort();
    if (session) void request('/sessions/' + session.id + '/cancel', {}).catch(() => {});
    finishSpeech();
  }
  async function createNew(newRole = role) {
    stopVoice(); transmitting.current = false; await capture.current?.stop(); setError('');
    try {
      const s = await request<Session>('/sessions', { title: newRole === 'evidence' ? '宫廷证据评审会' : '腾讯会议 · 技术方案评审', expertRole: newRole });
      setSession(s); sessionRef.current = s; setRole(newRole); setSeconds(0); setPartial(''); setAsrNotice(''); setSkippedSeconds(0); asrPaused.current = false; setAsrQueue({ pending: 0, processing: false, paused: false }); seenTriggers.current.clear();
      setTrigger(newRole === 'evidence' ? '请太医发言' : '请专家发言'); sessionStorage.setItem('seat-bridge-session', s.id);
    } catch (e) { setError((e as Error).message); }
  }
  return <div className="app-shell bridge-room">
    <WorkspaceNav page="bridge" />
    <div className="workspace">
      <header className="topbar"><div className="wordmark">席位 <span>SEAT</span></div><div className="breadcrumb">工作空间 <ChevronRight size={13} /> 实时会议中枢</div><div className="top-actions"><span className="local-label"><ShieldCheck size={14} /> 本地工作空间</span><button className="button ghost small" onClick={() => createNew()} disabled={busy}><Plus size={15} /> 新会话</button></div></header>
      <main className="bridge-app">
    <header className="page-heading"><div><div className="eyebrow">IN SYNC WITH EVERY CONVERSATION</div><h1>让现场讨论，汇成共识<span>。</span></h1><p>连接腾讯会议，让专家实时听会、分析与语音回应。</p></div></header>
    <div className="bridge-status" role="status"><span className={connected ? 'connected-dot' : 'disconnected-dot'} />{status}<small>{config?.model} / {config?.asrModel}</small>{!connected && <button onClick={() => setReconnect(x => x + 1)}>重新连接</button>}</div>
    {error && <div className="bridge-alert" role="alert"><span>{error}</span><button aria-label="关闭提示" onClick={() => setError('')}><X size={16} /></button></div>}
    <section className="bridge-setup">
      <div><h2><Headphones size={18} /> 1. 配置专家发言设备</h2><p>腾讯会议麦克风选择 <strong>CABLE Output</strong>；扬声器选择普通播放设备。专家输出选择 <strong>CABLE Input</strong>。</p><div className="bridge-controls"><button onClick={refreshOutputs} disabled={busy}><Volume2 size={15} /> 识别输出设备</button><select aria-label="专家输出设备" value={output} onChange={e => setOutput(e.target.value)} disabled={busy || speaking}><option value="">请选择 CABLE Input</option>{outputs.map(d => <option value={d.deviceId} key={d.deviceId}>{d.label}</option>)}</select><button onClick={testVoice} disabled={!output || !config?.speech || busy || speaking}><Play size={15} /> 测试发言</button></div><small>专家语音：{config?.speechModel || '尚未配置'}{config?.speechVoice ? ' · ' + config.speechVoice : ''}。识别设备会请求麦克风权限，立即停止该麦克风流。测试声音由 AI 生成。</small></div>
      <div><h2><AudioLines size={18} /> 2. 开始接收现场音频</h2><p>点击后，在浏览器选择<strong>整个屏幕</strong>并勾选<strong>共享系统音频</strong>。程序只发送音频，不发送屏幕画面。</p><div className="bridge-controls"><button className="bridge-primary" onClick={listening ? stopListening : startListening} disabled={!connected || busy}><Mic size={15} />{listening ? '停止监听' : '监听腾讯会议'}</button><div className="bridge-meter" role="meter" aria-label="输入音量" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}><span style={{ width: level * 100 + '%' }} /></div><small>已传送 {Math.floor(seconds)} 秒</small></div><small>系统音频可能包含其他应用。专家处理及发言期间暂停传送，防止回答回声进入会议上下文。</small></div>
    </section>
    {config?.asr === 'next_omni' && <div className="bridge-status" role="status" aria-label="Qwen 转写状态">
      <span>{asrQueue.paused ? 'Qwen 转写积压，暂缓发送新音频；处理后自动恢复。暂停期间的新音频不会转写。' : asrQueue.processing ? 'Qwen 正在转写' : 'Qwen 等待下一段音频'} 等待 {asrQueue.pending} 段</span>
      {skippedSeconds > 0 && <small>积压期间累计 {skippedSeconds.toFixed(1)} 秒系统音频未转写</small>}
    </div>}
    {asrNotice && <div className="bridge-alert" role="status"><span>{asrNotice}</span><button aria-label="关闭转写提示" onClick={() => setAsrNotice('')}><X size={16} /></button></div>}
    <div className="bridge-columns">
      <section className="bridge-panel"><div className="bridge-panel-heading"><h2><AudioLines size={17} /> 实时会议内容</h2><span>{session?.segments.length || 0} 段</span></div><div className="bridge-transcripts">{!session?.segments.length && <div className="bridge-empty">开始监听后，让另一位参会者说一句话。<br />这里应出现真实转写，而非预置字幕。</div>}{session?.segments.map(segment => <article key={segment.id}><div><strong>{segment.speaker}</strong><span>{Math.floor(segment.start)}s · {segment.source === 'next_omni' ? 'Qwen Omni 云转写' : segment.source === 'local_whisper' ? 'Whisper 本地转写' : segment.source === 'openai' ? 'OpenAI 实时转写' : segment.source === 'dui' ? '思必驰转写' : '文字补充'}</span></div><p>{segment.text}</p></article>)}{partial && <p className="bridge-partial">{partial}…</p>}</div><a className="bridge-export" href={session ? '/api/sessions/' + session.id + '/export' : '#'} download>导出当前会议记录</a></section>
      <section className="bridge-panel"><div className="bridge-panel-heading"><h2><Sparkles size={17} />{role === 'evidence' ? '太医 / 证据评审专家' : '架构评审专家'}</h2><select aria-label="专家角色" value={role} onChange={e => createNew(e.target.value as 'evidence' | 'architecture')} disabled={busy || listening}><option value="evidence">宫廷证据评审</option><option value="architecture">技术方案评审</option></select></div><div className="bridge-experts">{!session?.messages.length && <div className="bridge-empty">专家只依据已经听到的讨论和检索资料回答。<br />缺少证据时应提问，不能提前知道剧情真相。</div>}{session?.messages.map(message => <article key={message.id}><small>{message.provider === 'openai_next' ? 'Next 专家' : message.provider === 'openai' ? 'OpenAI' : '本地演示'} · {message.confidence}</small><p className="bridge-summary">{message.contextSummary}</p><h3>{message.finding}</h3><p>{message.impact}</p><p className="bridge-followup">{message.question}</p><p>{message.proposal}</p>{message.citations.map(source => <details key={source.id}><summary><BookOpen size={12} />{source.title} · {source.heading}</summary><pre>{source.text}</pre></details>)}</article>)}{busy && <div className="bridge-thinking"><LoaderCircle size={18} />{status}</div>}</div><div className="bridge-composer"><label><input type="checkbox" checked={autoTrigger} onChange={e => setAutoTrigger(e.target.checked)} /> 听到口令时发言<input aria-label="召唤口令" value={trigger} onChange={e => setTrigger(e.target.value)} maxLength={30} /></label><form onSubmit={e => { e.preventDefault(); void consult(); }}><textarea aria-label="专家问题" placeholder="输入追问，或直接邀请专家分析当前讨论…" value={question} onChange={e => setQuestion(e.target.value)} maxLength={3000} /><button className="bridge-primary" disabled={busy || speaking || !session?.segments.length || !connected}><Send size={15} /> 请专家发言</button></form><div className="bridge-voice-controls">{voiceReady && !speaking && <button onClick={() => { if (speechPlayer.current) void routeAudio(speechPlayer.current, output).then(() => speechPlayer.current!.play()).then(() => setSpeaking(true)).catch(e => setError(e.message)); }}><Play size={14} /> 播放已生成语音</button>}{(speaking || busy) && <button onClick={stopVoice}><Square size={14} /> 停止发言 / 取消</button>}</div></div></section>
    </div>
    <audio ref={speechPlayer} onEnded={finishSpeech} onError={() => { setError('专家音频播放失败，请检查输出设备。'); finishSpeech(); }} />
    <footer className="bridge-footer">这是桌面音频桥接：登录、入会、主持人准入由腾讯会议客户端完成。结束使用时停止监听并退出 Bot 账号。</footer>
      </main>
    </div>
  </div>;
}
