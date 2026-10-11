import { useEffect, useRef, useState } from 'react';
import { Languages, MessageSquareQuote, MessageSquarePlus, NotebookPen, X } from 'lucide-react';
import { HIGHLIGHT_COLORS } from './colors';

export interface SelectionRect { top: number; left: number; width: number; bottom: number }

interface Props {
  rect: SelectionRect;
  aiReady: boolean;
  onHighlight(color: string): void;
  onComment(color: string, text: string): void;
  onExcerpt(): void;
  onExplain(): void;
  translate(): Promise<string>;
  onClose(): void;
}

/** Floating toolbar shown next to the current text selection. */
export function SelectionBar({ rect, aiReady, onHighlight, onComment, onExcerpt, onExplain, translate, onClose }: Props) {
  const [mode, setMode] = useState<'bar' | 'comment' | 'translation'>('bar');
  const [comment, setComment] = useState('');
  const [translation, setTranslation] = useState<{ text?: string; error?: string; loading: boolean }>({ loading: false });
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { setMode('bar'); setComment(''); setTranslation({ loading: false }); }, [rect.top, rect.left]);

  const width = mode === 'bar' ? 330 : 340;
  const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2));
  const placeAbove = rect.top > 140;
  const style = { left, top: placeAbove ? Math.max(8, rect.top - (mode === 'bar' ? 46 : 8)) : rect.bottom + 10, transform: placeAbove && mode !== 'bar' ? 'translateY(-100%)' : undefined } as const;

  const runTranslate = async () => {
    setMode('translation');
    setTranslation({ loading: true });
    try { setTranslation({ loading: false, text: await translate() }); }
    catch (error) { setTranslation({ loading: false, error: error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error) }); }
  };

  return (
    <div ref={box} className="selbar" style={style} onMouseDown={(event) => { if (!(event.target instanceof HTMLTextAreaElement)) event.preventDefault(); }}>
      {mode === 'bar' && (
        <>
          <div className="selbar-colors">
            {HIGHLIGHT_COLORS.map((color) => (
              <button key={color.id} className={`swatch swatch-${color.id}`} title={`高亮 · ${color.label}`} onClick={() => onHighlight(color.id)} />
            ))}
          </div>
          <span className="selbar-sep" />
          <button title="添加批注" onClick={() => setMode('comment')}><MessageSquarePlus size={15} /> 批注</button>
          <button title="带出处摘录到笔记" onClick={onExcerpt}><NotebookPen size={15} /> 摘录</button>
          <button title={aiReady ? '翻译选中文字' : '需要先配置模型服务'} disabled={!aiReady} onClick={() => void runTranslate()}><Languages size={15} /></button>
          <button title={aiReady ? '让助手解释' : '需要先配置模型服务'} disabled={!aiReady} onClick={onExplain}><MessageSquareQuote size={15} /></button>
        </>
      )}
      {mode === 'comment' && (
        <div className="selbar-form">
          <textarea autoFocus value={comment} placeholder="写下你的想法…（⌘Enter 保存）" onChange={(event) => setComment(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && comment.trim()) onComment('yellow', comment.trim()); if (event.key === 'Escape') onClose(); }} />
          <div>
            <button className="text-button" onClick={() => setMode('bar')}>返回</button>
            <button className="primary" disabled={!comment.trim()} onClick={() => onComment('yellow', comment.trim())}>保存批注</button>
          </div>
        </div>
      )}
      {mode === 'translation' && (
        <div className="selbar-translation">
          <button className="selbar-x" onClick={() => setMode('bar')}><X size={13} /></button>
          {translation.loading ? <p className="muted">翻译中…</p> : translation.error ? <p className="err">{translation.error}</p> : <p>{translation.text}</p>}
        </div>
      )}
    </div>
  );
}
