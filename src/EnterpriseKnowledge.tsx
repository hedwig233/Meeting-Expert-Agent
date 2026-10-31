import { useEffect, useRef, useState } from 'react';
import { ChevronRight, FileText, LoaderCircle, Upload } from 'lucide-react';
import type { Document, KnowledgeScope } from './types';
import KnowledgeScopeSelect from './KnowledgeScopeSelect';
import WorkspaceDialog from './WorkspaceDialog';

async function request<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api' + path, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '知识库操作失败，请重试。');
  return data;
}

export default function EnterpriseKnowledge({ onClose }: { onClose: () => void }) {
  const [docs, setDocs] = useState<Document[]>([]);
  const [scope, setScope] = useState<KnowledgeScope>('shared');
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const upload = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    request<Document[]>('/documents', undefined, 'GET', controller.signal).then(setDocs).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  async function uploadDocument(file: File) {
    setError(''); setNotice(''); setBusy(true);
    try {
      if (!/\.(md|txt)$/i.test(file.name) || file.size > 300000) throw new Error('请选择不超过 300 KB 的 Markdown 或 TXT 文件。');
      const doc = await request<Document>('/documents', { title: file.name, content: await file.text(), scope });
      setDocs(previous => [...previous, doc]); setNotice('资料已加入企业知识库。');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function changeScope(id: string, value: KnowledgeScope) {
    setError(''); setNotice(''); setBusy(true);
    try {
      const doc = await request<Document>('/documents/' + encodeURIComponent(id), { scope: value }, 'PATCH');
      setDocs(previous => previous.map(item => item.id === id ? doc : item)); setNotice('知识范围已更新。');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <WorkspaceDialog title="企业知识库" onClose={onClose} className="knowledge-dialog">
    <p className="muted">统一管理实时会议中枢使用的资料。专家检索公共知识与自己的专属知识，可在上传前选择范围，也可调整已有资料。</p>
    <p className="muted">专家会议室的任务专家根据导入的纪要、任务和讨论回答。</p>
    <fieldset disabled={loading || busy} className="knowledge-controls"><KnowledgeScopeSelect label="上传知识范围" value={scope} onChange={setScope} /><button className="button ghost" onClick={() => upload.current?.click()}><Upload size={15} />{busy ? '正在保存…' : '上传资料'}</button></fieldset>
    <input ref={upload} type="file" hidden accept=".md,.txt" onChange={event => { if (event.target.files?.[0]) void uploadDocument(event.target.files[0]); event.target.value = ''; }} />
    <p className="knowledge-hint muted">支持 Markdown / TXT，单份不超过 300 KB · 已有 {docs.length} 份资料</p>
    {error && <p className="knowledge-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {loading ? <p role="status"><LoaderCircle size={16} className="spin" /> 正在加载资料…</p> : <div className="document-list">{!docs.length && <p className="muted">还没有资料，上传第一份团队知识。</p>}{docs.map(doc => <details key={doc.id}><summary><FileText size={17} /><strong>{doc.title}</strong><ChevronRight size={14} /></summary><pre className="document-content">{doc.content}</pre><fieldset disabled={busy} className="document-scope-control"><KnowledgeScopeSelect label={'知识范围：' + doc.title} value={doc.scope || 'shared'} onChange={value => void changeScope(doc.id, value)} /></fieldset></details>)}</div>}
    <p className="knowledge-hint muted">资料保存在本地。专家分析时，会将讨论文字与检索资料发送到配置的模型服务。</p>
  </WorkspaceDialog>;
}
