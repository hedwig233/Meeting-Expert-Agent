import type { KnowledgeScope } from './types';

export default function KnowledgeScopeSelect({ value, onChange, label }: { value: KnowledgeScope; onChange: (scope: KnowledgeScope) => void; label: string }) {
  return <select aria-label={label} value={value} onChange={event => onChange(event.target.value as KnowledgeScope)}>
    <option value="shared">公共知识 · 所有专家</option>
    <option value="palace">宫廷证据评审专属</option>
    <option value="technical">技术方案评审专属</option>
  </select>;
}
