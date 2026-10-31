import { useState } from 'react';
import type { MouseEvent } from 'react';
import { AudioLines, BookOpen, Headphones, SlidersHorizontal } from 'lucide-react';
import EnterpriseKnowledge from './EnterpriseKnowledge';
import AppearanceSettings from './AppearanceSettings';

export default function WorkspaceNav({ page, person = '你', onNavigate }: {
  page: 'minutes' | 'bridge'; person?: string; onNavigate?: (href: string) => Promise<void>;
}) {
  const [panel, setPanel] = useState<'knowledge' | 'appearance' | null>(null);
  function navigate(event: MouseEvent<HTMLAnchorElement>) {
    if (!onNavigate || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); void onNavigate(event.currentTarget.href);
  }
  return <><aside className="rail" aria-label="工作空间导航">
    <a className="brand-mark" href="/" aria-label="席位首页" onClick={navigate}><span /><span /><span /></a>
    <nav className="rail-nav" aria-label="模块导航">
      <a className={'rail-button ' + (page === 'minutes' ? 'active' : '')} href="/" aria-label="专家会议室" aria-current={page === 'minutes' ? 'page' : undefined} onClick={navigate}><AudioLines size={22} /><span className="rail-tooltip">专家会议室</span></a>
      <a className={'rail-button ' + (page === 'bridge' ? 'active' : '')} href="/bridge.html" aria-label="实时会议中枢" aria-current={page === 'bridge' ? 'page' : undefined} onClick={navigate}><Headphones size={22} /><span className="rail-tooltip">实时会议中枢</span></a>
      <button className="rail-button" onClick={() => setPanel('knowledge')} aria-label="企业知识库" aria-haspopup="dialog"><BookOpen size={21} /><span className="rail-tooltip">企业知识库</span></button>
    </nav>
    <div className="rail-bottom"><button className="rail-button" aria-label="显示设置" aria-haspopup="dialog" onClick={() => setPanel('appearance')}><SlidersHorizontal size={20} /><span className="rail-tooltip">显示设置</span></button><span className="avatar tiny">{person.slice(0, 1)}</span></div>
  </aside>{panel === 'knowledge' && <EnterpriseKnowledge onClose={() => setPanel(null)} />}{panel === 'appearance' && <AppearanceSettings onClose={() => setPanel(null)} />}</>;
}
