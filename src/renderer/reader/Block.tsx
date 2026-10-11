import { createElement, memo, useLayoutEffect, useRef } from 'react';
import { Copy, Languages, MessageSquareQuote, NotebookPen, RotateCw } from 'lucide-react';
import { TRANSLATABLE } from '../../core/arxiv-html';
import type { Paragraph } from '../../shared/types';
import { applyHighlights, type Highlight } from '../lib/dom';
import { blockHtml, translationHtml } from './html';

export type DisplayMode = 'both' | 'original' | 'translation';

interface BlockProps {
  p: Paragraph;
  assetBase: string;
  mode: DisplayMode;
  zh?: string;
  pending: boolean;
  failed: boolean;
  highlights: Highlight[];
  /** Changes whenever the highlights of this block change, so memo can skip stable blocks. */
  highlightKey: string;
  canTranslate: boolean;
  onRetranslate(p: Paragraph): void;
  onExplain(p: Paragraph): void;
  onExcerpt(p: Paragraph): void;
  onCopy(text: string): void;
}

const headingTag = (p: Paragraph) => p.type === 'title' ? 'h1' : `h${Math.min(5, (p.level ?? 1) + 1)}`;

function BlockImpl({ p, assetBase, mode, zh, pending, failed, highlights, canTranslate, onRetranslate, onExplain, onExcerpt, onCopy }: BlockProps) {
  const original = useRef<HTMLElement>(null);
  const translatable = TRANSLATABLE.has(p.type) && Boolean(p.text);
  const showOriginal = mode !== 'translation' || !translatable || !zh;
  const showTranslation = mode !== 'original' && translatable && (Boolean(zh) || pending || failed);
  const html = blockHtml(p, assetBase);

  useLayoutEffect(() => {
    const el = original.current;
    if (!el) return;
    el.innerHTML = html;
    if (highlights.length) applyHighlights(el, highlights);
  }, [html, highlights, showOriginal]);

  const tag = p.type === 'title' || p.type === 'heading' ? headingTag(p) : p.type === 'paragraph' ? 'p' : 'div';
  const className = `rd-orig rd-${p.type}`;
  const body = showOriginal ? createElement(tag, { ref: original, className, 'data-orig': '', 'data-pid': p.id }) : null;

  return (
    <section className={`rd-block rd-block-${p.type}`} id={p.id} data-block data-pid={p.id} data-order={p.order}>
      {p.aliases?.map((alias) => <span key={alias} id={alias} className="rd-alias" />)}
      {body}
      {showTranslation && (
        zh
          ? <div className={`rd-trans rd-trans-${p.type}`} dangerouslySetInnerHTML={{ __html: translationHtml(zh, p, assetBase) }} />
          : failed
            ? <button className="rd-trans-failed" onClick={() => onRetranslate(p)}><RotateCw size={12} /> 翻译失败，点击重试</button>
            : <div className="rd-trans rd-trans-loading" aria-label="翻译中"><i /><i /></div>
      )}
      {translatable && p.type !== 'title' && (
        <div className="rd-actions">
          {canTranslate && <button title="重新翻译" onClick={() => onRetranslate(p)}><Languages size={13} /></button>}
          <button title="复制原文" onClick={() => onCopy(p.text)}><Copy size={13} /></button>
          <button title="解释这段" onClick={() => onExplain(p)}><MessageSquareQuote size={13} /></button>
          <button title="整段摘录到笔记" onClick={() => onExcerpt(p)}><NotebookPen size={13} /></button>
        </div>
      )}
    </section>
  );
}

export const Block = memo(BlockImpl, (a, b) =>
  a.p === b.p && a.mode === b.mode && a.zh === b.zh && a.pending === b.pending && a.failed === b.failed &&
  a.highlightKey === b.highlightKey && a.assetBase === b.assetBase && a.canTranslate === b.canTranslate);
