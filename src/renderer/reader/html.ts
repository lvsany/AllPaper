import DOMPurify from 'dompurify';
import { restorePlaceholders } from '../../core/arxiv-html';
import type { Paragraph } from '../../shared/types';

const cache = new Map<string, string>();

function clean(html: string): string {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true, mathMl: true }, FORBID_TAGS: ['style', 'form', 'input', 'button'], FORBID_ATTR: ['style'] });
}

/** Sanitized HTML of a block with image paths pointing at the paper's local assets. */
export function blockHtml(p: Paragraph, assetBase: string): string {
  const key = `${assetBase}|${p.id}|${p.html.length}`;
  let html = cache.get(key);
  if (html === undefined) {
    html = clean(p.html).replace(/src="assets\//g, `src="${assetBase}assets/`);
    if (cache.size > 4000) cache.clear();
    cache.set(key, html);
  }
  return html;
}

/** Translation text with math, citations and references put back. */
export function translationHtml(zh: string, p: Paragraph, assetBase: string): string {
  return clean(restorePlaceholders(zh, p.slots)).replace(/src="assets\//g, `src="${assetBase}assets/`);
}

/** Plain text of a translation (placeholders replaced by their text), e.g. for copying or notes. */
export function translationText(zh: string, p: Paragraph): string {
  return zh.replace(/⟦(\d+)⟧/g, (_whole, id: string) => {
    const html = p.slots?.[id] ?? '';
    const alt = html.match(/alttext="([^"]*)"/)?.[1];
    return alt ? `$${alt}$` : html.replace(/<[^>]+>/g, '');
  });
}
