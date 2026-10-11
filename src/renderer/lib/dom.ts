import { rematchAnchor } from '../../core/anchors';

/**
 * A block's "linear text" is its visible text with each inline formula
 * represented by `$tex$`. Annotation offsets are positions in that string, so
 * they stay valid regardless of how the HTML is nested.
 */
export interface Segment { node: Node; start: number; end: number; math: boolean }

export function linearize(root: Element): { text: string; segments: Segment[] } {
  const segments: Segment[] = [];
  let text = '';
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const data = node.nodeValue ?? '';
      if (data) { segments.push({ node, start: text.length, end: text.length + data.length, math: false }); text += data; }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (el.tagName.toLowerCase() === 'math') {
      const tex = `$${el.getAttribute('alttext') ?? el.textContent ?? ''}$`;
      segments.push({ node: el, start: text.length, end: text.length + tex.length, math: true });
      text += tex;
      return;
    }
    el.childNodes.forEach(visit);
  };
  root.childNodes.forEach(visit);
  return { text, segments };
}

/** Position in linear text for a DOM boundary point. */
export function offsetOf(segments: Segment[], total: number, container: Node, offset: number, bias: 'start' | 'end'): number {
  const probe = document.createRange();
  for (const segment of segments) {
    probe.selectNode(segment.node);
    const where = probe.comparePoint(container, offset);
    if (where < 0) return segment.start;
    if (where === 0) {
      if (segment.node === container && !segment.math) return segment.start + offset;
      return bias === 'start' ? segment.start : segment.end;
    }
  }
  return total;
}

export interface Portion { paragraphId: string; start: number; end: number; quotedText: string; prefix: string; suffix: string }

/** Splits a document selection into the part that lies in each block. */
export function selectionPortions(range: Range, article: Element): Portion[] {
  const portions: Portion[] = [];
  article.querySelectorAll<HTMLElement>('[data-orig]').forEach((el) => {
    if (!range.intersectsNode(el)) return;
    const { text, segments } = linearize(el);
    let start = el.contains(range.startContainer) ? offsetOf(segments, text.length, range.startContainer, range.startOffset, 'start') : 0;
    let end = el.contains(range.endContainer) ? offsetOf(segments, text.length, range.endContainer, range.endOffset, 'end') : text.length;
    while (start < end && /\s/.test(text[start])) start += 1;
    while (end > start && /\s/.test(text[end - 1])) end -= 1;
    if (end <= start) return;
    portions.push({
      paragraphId: el.dataset.pid ?? '', start, end, quotedText: text.slice(start, end),
      prefix: text.slice(Math.max(0, start - 60), start), suffix: text.slice(end, end + 60)
    });
  });
  return portions;
}

export interface Highlight { id: string; color: string; start: number; end: number; active?: boolean }

/** Wraps the given linear ranges in <mark data-ann> elements. */
export function applyHighlights(el: HTMLElement, highlights: Highlight[]): void {
  for (const item of [...highlights].sort((a, b) => a.start - b.start)) {
    const { segments } = linearize(el);
    const inside = segments.filter((s) => s.end > item.start && s.start < item.end);
    for (const segment of inside.reverse()) {
      const mark = document.createElement('mark');
      mark.dataset.ann = item.id;
      mark.className = `hl hl-${item.color}${item.active ? ' hl-active' : ''}`;
      if (segment.math) {
        (segment.node as Element).replaceWith(mark);
        mark.appendChild(segment.node);
        continue;
      }
      const range = document.createRange();
      range.setStart(segment.node, Math.max(item.start, segment.start) - segment.start);
      range.setEnd(segment.node, Math.min(item.end, segment.end) - segment.start);
      if (range.collapsed) continue;
      range.surroundContents(mark);
    }
  }
}

export interface Locatable { quotedText: string; prefix: string; suffix: string; offsets?: [number, number] }

/** Finds an annotation in the current text; undefined means its position is no longer valid. */
export function locate(annotation: Locatable, text: string): [number, number] | undefined {
  const { offsets, quotedText } = annotation;
  if (offsets && text.slice(offsets[0], offsets[1]) === quotedText) return offsets;
  const match = rematchAnchor({ quotedText, prefix: annotation.prefix, suffix: annotation.suffix }, text);
  return match ? [match.start, match.end] : undefined;
}

/** Linear text of an HTML fragment, without needing it to be in the page. */
export function linearTextOf(html: string): string {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  return linearize(holder).text;
}
