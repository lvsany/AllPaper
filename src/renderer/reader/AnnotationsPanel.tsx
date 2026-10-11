import { useState } from 'react';
import { ArrowUpRight, NotebookPen, Trash2 } from 'lucide-react';
import type { Annotation } from '../../shared/types';
import { HIGHLIGHT_COLORS, colorLabel } from './colors';

interface Props {
  annotations: Annotation[];
  lost: Set<string>;
  activeId?: string;
  hasProject: boolean;
  onFocus(annotation: Annotation): void;
  onExcerpt(annotation: Annotation): void;
  onDelete(annotation: Annotation): void;
  onChange(annotation: Annotation, patch: Partial<Pick<Annotation, 'color' | 'comment'>>): void;
}

export function AnnotationsPanel({ annotations, lost, activeId, hasProject, onFocus, onExcerpt, onDelete, onChange }: Props) {
  const [filter, setFilter] = useState<string>();
  const shown = annotations.filter((a) => !filter || a.color === filter);
  if (!annotations.length) {
    return <div className="panel-empty"><p>还没有批注。</p><p>在正文中选中文字，用浮出的工具条高亮、写批注或摘录到笔记。</p></div>;
  }
  return (
    <div className="annotations">
      <div className="ann-filter">
        <button className={!filter ? 'on' : ''} onClick={() => setFilter(undefined)}>全部 {annotations.length}</button>
        {HIGHLIGHT_COLORS.map((color) => {
          const count = annotations.filter((a) => a.color === color.id).length;
          return count ? <button key={color.id} className={filter === color.id ? 'on' : ''} onClick={() => setFilter(filter === color.id ? undefined : color.id)}><i className={`dot dot-${color.id}`} />{color.label} {count}</button> : null;
        })}
      </div>
      {shown.map((annotation) => (
        <article key={annotation.id} className={`ann${annotation.id === activeId ? ' active' : ''}`} onClick={() => onFocus(annotation)}>
          <header>
            <span className="ann-colors" onClick={(event) => event.stopPropagation()}>
              {HIGHLIGHT_COLORS.map((color) => (
                <button key={color.id} className={`swatch swatch-${color.id}${annotation.color === color.id ? ' on' : ''}`} title={color.label} onClick={() => onChange(annotation, { color: color.id })} />
              ))}
            </span>
            <span className="ann-label">{colorLabel(annotation.color)}</span>
            {lost.has(annotation.id) && <span className="ann-lost" title="正文已变化，找不到原来的位置；保留了当时的原文">位置已失效</span>}
          </header>
          <blockquote>{annotation.quotedText}</blockquote>
          <textarea
            defaultValue={annotation.comment ?? ''} placeholder="添加批注…" rows={annotation.comment ? 2 : 1}
            onClick={(event) => event.stopPropagation()}
            onBlur={(event) => { if (event.target.value !== (annotation.comment ?? '')) onChange(annotation, { comment: event.target.value }); }}
          />
          <footer onClick={(event) => event.stopPropagation()}>
            <button onClick={() => onFocus(annotation)}><ArrowUpRight size={12} /> 定位</button>
            <button disabled={!hasProject} title={hasProject ? '' : '先创建项目'} onClick={() => onExcerpt(annotation)}><NotebookPen size={12} /> 摘录到笔记</button>
            <button className="danger" onClick={() => onDelete(annotation)}><Trash2 size={12} /></button>
          </footer>
        </article>
      ))}
    </div>
  );
}
