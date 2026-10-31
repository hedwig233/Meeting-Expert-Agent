import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export default function WorkspaceDialog({ title, onClose, children, className = '' }: {
  title: string; onClose: () => void; children: ReactNode; className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return <dialog ref={dialog} className={'modal workspace-dialog ' + className} aria-label={title}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
    <div className="modal-heading"><div><div className="eyebrow">SEAT · WORKSPACE</div><h2>{title}</h2></div><button className="icon-button" aria-label="关闭窗口" onClick={onClose}><X size={20} /></button></div>
    {children}
  </dialog>;
}
