/**
 * Mapping a highlighted span of an English paragraph onto its Chinese
 * translation. The precise mapping comes from the model (a quote copied out of
 * the translation); this module finds that quote again, and falls back to a
 * sentence-level guess when there is none.
 */

export type Span = [number, number];

const ABBREVIATIONS = /(?:\b(?:e\.g|i\.e|et al|etc|vs|cf|Fig|Figs|Eq|Eqs|Sec|Tab|No|resp|approx|al)|\b[A-Z])\.$/;

/** Sentence ranges of an English paragraph (abbreviations like "e.g." and "et al." do not end a sentence). */
export function englishSentences(text: string): Span[] {
  const spans: Span[] = [];
  let start = 0;
  const re = /[.!?]+["')\]]*(?=\s+(?:[A-Z0-9$([“"]|$))/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const end = m.index + m[0].length;
    if (ABBREVIATIONS.test(text.slice(Math.max(0, m.index - 8), m.index + 1))) continue;
    if (text.slice(start, end).trim()) spans.push([start, end]);
    start = end;
  }
  if (text.slice(start).trim()) spans.push([start, text.length]);
  return trimSpans(text, spans);
}

/** Sentence ranges of a Chinese paragraph. */
export function chineseSentences(text: string): Span[] {
  const spans: Span[] = [];
  let start = 0;
  const re = /[。！？]+[”’」』）)]*|[.!?](?=\s)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const end = m.index + m[0].length;
    if (text.slice(start, end).trim()) spans.push([start, end]);
    start = end;
  }
  if (text.slice(start).trim()) spans.push([start, text.length]);
  return trimSpans(text, spans);
}

function trimSpans(text: string, spans: Span[]): Span[] {
  return spans.map(([s, e]) => {
    while (s < e && /\s/.test(text[s])) s += 1;
    while (e > s && /\s/.test(text[e - 1])) e -= 1;
    return [s, e] as Span;
  }).filter(([s, e]) => e > s);
}

/**
 * Sentence-level guess: the translated sentences that correspond to the
 * source sentences the span touches. With equal sentence counts the mapping is
 * one to one; otherwise sentences are matched by relative position.
 */
export function alignBySentence(source: string, target: string, start: number, end: number): Span | undefined {
  const src = englishSentences(source);
  const tgt = chineseSentences(target);
  if (!src.length || !tgt.length) return undefined;
  const touched = src.map((s, i) => (s[1] > start && s[0] < end ? i : -1)).filter((i) => i >= 0);
  if (!touched.length) return undefined;
  const first = touched[0];
  const last = touched[touched.length - 1];
  let j0: number;
  let j1: number;
  if (src.length === tgt.length) { j0 = first; j1 = last; }
  else {
    j0 = Math.min(tgt.length - 1, Math.floor((first / src.length) * tgt.length));
    j1 = Math.max(j0, Math.min(tgt.length - 1, Math.ceil(((last + 1) / src.length) * tgt.length) - 1));
  }
  return [tgt[j0][0], tgt[j1][1]];
}

/** Where a quote copied from the translation sits; among repeats, the one closest to where the source span sits. */
export function findQuote(target: string, quote: string, hint: number): Span | undefined {
  const needle = quote.trim();
  if (!needle) return undefined;
  let best: Span | undefined;
  let bestDistance = Infinity;
  for (let at = target.indexOf(needle); at >= 0; at = target.indexOf(needle, at + 1)) {
    const distance = Math.abs(at / Math.max(1, target.length) - hint);
    if (distance < bestDistance) { best = [at, at + needle.length]; bestDistance = distance; }
  }
  return best;
}

export interface TranslationHighlight { span: Span; approx: boolean }

/** The part of the translation to highlight for a source span: the model's quote if it is still there, else the sentence guess. */
export function translationSpan(source: string, target: string, start: number, end: number, quote?: string): TranslationHighlight | undefined {
  if (quote) {
    const found = findQuote(target, quote, start / Math.max(1, source.length));
    if (found) return { span: found, approx: false };
  }
  const guess = alignBySentence(source, target, start, end);
  return guess ? { span: guess, approx: true } : undefined;
}

/**
 * Cleans the model's reply into a quote that occurs verbatim in the
 * translation, or undefined when it does not.
 */
export function acceptQuote(reply: string, target: string): string | undefined {
  let text = reply.trim().replace(/^(?:译文片段|对应译文|答案)[:：]\s*/, '');
  if (!text || /^NONE$/i.test(text)) return undefined;
  const candidates = [text];
  text = text.replace(/^["'“‘「『]+|["'”’」』]+$/g, '').trim();
  candidates.push(text, text.replace(/[，。；、,.;]+$/, ''));
  for (const candidate of candidates) if (candidate && target.includes(candidate)) return candidate;
  return undefined;
}

/** Short fingerprint of a translation, to tell whether a stored quote was made for it. */
export function fingerprint(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
