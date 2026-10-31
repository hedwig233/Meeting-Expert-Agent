import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { appearanceKey, applyAppearance, defaultAppearance, readAppearance } from './appearance';
import type { Appearance } from './appearance';
import WorkspaceDialog from './WorkspaceDialog';

export default function AppearanceSettings({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState(readAppearance);
  useEffect(() => {
    applyAppearance(value);
    try { localStorage.setItem(appearanceKey, JSON.stringify(value)); } catch { /* still usable when storage is unavailable */ }
  }, [value]);
  function update(changes: Partial<Appearance>) { setValue(previous => ({ ...previous, ...changes })); }
  return <WorkspaceDialog title="显示设置" onClose={onClose} className="appearance-dialog">
    <p className="muted">让工作空间适合你的阅读习惯，设置会应用到所有页面。</p>
    <fieldset className="theme-options"><legend>页面模式</legend>{([
      ['dark', '深色模式', Moon], ['light', '浅色模式', Sun], ['system', '跟随系统', Monitor],
    ] as const).map(([theme, label, Icon]) => <label key={theme}><input type="radio" name="workspace-theme" value={theme} checked={value.theme === theme} onChange={() => update({ theme })} /><Icon size={18} /><span>{label}</span></label>)}</fieldset>
    <label className="appearance-range">字体大小 <output>{value.fontSize} px</output><input aria-label="字体大小" type="range" min="12" max="20" step="1" value={value.fontSize} onChange={event => update({ fontSize: Number(event.target.value) })} /></label>
    <label className="appearance-range">页面缩放 <output>{value.zoom}%</output><input aria-label="页面缩放" type="range" min="80" max="125" step="5" value={value.zoom} onChange={event => update({ zoom: Number(event.target.value) })} /></label>
    <p className="appearance-preview">让会议讨论，成为行动。<br /><span className="muted">让专业知识，在每一场讨论中清晰呈现。</span></p>
    <div className="workspace-dialog-actions"><button className="button ghost" onClick={() => setValue({ ...defaultAppearance })}>恢复默认</button><button className="button primary" onClick={onClose}>完成</button></div>
  </WorkspaceDialog>;
}
