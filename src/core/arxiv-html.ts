import { parseHTML } from 'linkedom';
import type { Paragraph, ParagraphType } from '../shared/types';

/**
 * Converts the LaTeXML HTML served by arxiv.org/html and ar5iv into the app's
 * paragraph sequence. The output HTML is built from an allow-list (never copied
 * from the source), so it is safe to render without further trust.
 */
export interface ParsedArticle {
  title: string;
  paragraphs: Paragraph[];
  /** Absolute URLs of images referenced by the sanitized HTML. */
  images: string[];
}

export const TRANSLATABLE: ReadonlySet<ParagraphType> = new Set(['title', 'heading', 'paragraph', 'list', 'caption', 'footnote']);

const SKIP_TAGS = new Set(['script', 'style', 'link', 'meta', 'noscript', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'svg', 'canvas', 'audio', 'video', 'header', 'footer', 'nav', 'head', 'template']);
const SKIP_CLASSES = ['ltx_page_navbar', 'ltx_page_logo', 'ltx_dates', 'ltx_pagination', 'ltx_TOC', 'ltx_role_creation', 'ltx_classification', 'ltx_page_footer', 'ltx_listing_data', 'ltx_rdf'];
const BLOCK_TAGS = new Set(['p', 'div', 'ul', 'ol', 'dl', 'table', 'figure', 'section', 'pre', 'blockquote', 'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const INLINE_ALLOWED = new Set(['a', 'b', 'i', 'em', 'strong', 'u', 'sub', 'sup', 'span', 'code', 'tt', 'br', 'small', 'abbr', 'cite', 'q', 'del', 'ins', 's', 'mark']);
const STRUCTURE_ALLOWED = new Set(['p', 'div', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col', 'figure', 'figcaption', 'pre', 'blockquote', 'img', 'section']);
const MATHML_ALLOWED = new Set(['math', 'mi', 'mn', 'mo', 'mtext', 'mspace', 'ms', 'mrow', 'mfrac', 'msqrt', 'mroot', 'mstyle', 'merror', 'mpadded', 'mphantom', 'mfenced', 'menclose', 'msub', 'msup', 'msubsup', 'munder', 'mover', 'munderover', 'mmultiscripts', 'mprescripts', 'none', 'mtable', 'mtr', 'mtd', 'mlabeledtr', 'maction']);
const MATH_ATTRS = new Set(['display', 'mathvariant', 'stretchy', 'fence', 'separator', 'movablelimits', 'accent', 'accentunder', 'lspace', 'rspace', 'linethickness', 'columnalign', 'rowalign', 'displaystyle', 'scriptlevel', 'symmetric', 'largeop', 'form', 'columnspacing', 'rowspacing', 'alttext', 'maxsize', 'minsize']);

const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (value: string) => esc(value).replace(/"/g, '&quot;');
const squash = (value: string) => value.replace(/\s+/g, ' ');

/** linkedom elements are used through the standard DOM interface. */
type El = HTMLElement;

interface Ctx {
  baseUrl: string;
  images: Set<string>;
}
interface Inline {
  html: string;
  text: string;
  masked: string;
  slots: Record<string, string>;
  notes: string[];
}

const classes = (el: El): Set<string> => new Set((el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean));
const tagOf = (el: El) => el.tagName.toLowerCase();
const children = (el: El): El[] => Array.from(el.children) as El[];

/** Elements whose text must survive translation untouched. */
function isOpaque(el: El, cls: Set<string>, insideCite: boolean): boolean {
  const tag = tagOf(el);
  if (tag === 'math' || tag === 'code' || tag === 'tt' || tag === 'img') return true;
  if (cls.has('ltx_cite') || cls.has('ltx_note') || cls.has('ltx_font_typewriter') || cls.has('ltx_ref_tag')) return true;
  if (tag === 'a' && cls.has('ltx_ref') && !insideCite) return true;
  return false;
}

function safeUrl(raw: string, ctx: Ctx, forImage: boolean): string | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  if (value.startsWith('#')) return value;
  if (forImage && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(value)) return value;
  try {
    const url = new URL(value, ctx.baseUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    return url.href;
  } catch { return undefined; }
}

function attributes(el: El, tag: string, ctx: Ctx, keepId: boolean): string {
  const out: string[] = [];
  const cls = [...classes(el)].filter((name) => name.startsWith('ltx_'));
  if (cls.length) out.push(`class="${escAttr(cls.join(' '))}"`);
  if (keepId && el.getAttribute('id')) out.push(`id="${escAttr(el.getAttribute('id')!)}"`);
  if (tag === 'a') {
    const href = safeUrl(el.getAttribute('href') ?? '', ctx, false);
    if (href) out.push(`href="${escAttr(href)}"`);
    const title = el.getAttribute('title');
    if (title) out.push(`title="${escAttr(title)}"`);
  } else if (tag === 'img') {
    const src = safeUrl(el.getAttribute('src') ?? '', ctx, true);
    if (!src) return '';
    if (!src.startsWith('data:')) ctx.images.add(src);
    out.push(`src="${escAttr(src)}"`, `alt="${escAttr(el.getAttribute('alt') ?? '')}"`);
    for (const name of ['width', 'height']) {
      const value = el.getAttribute(name);
      if (value && /^\d+(\.\d+)?$/.test(value)) out.push(`${name}="${value}"`);
    }
  } else if (tag === 'td' || tag === 'th') {
    for (const name of ['colspan', 'rowspan']) {
      const value = el.getAttribute(name);
      if (value && /^\d+$/.test(value)) out.push(`${name}="${value}"`);
    }
  } else if (MATHML_ALLOWED.has(tag)) {
    for (const name of MATH_ATTRS) {
      const value = el.getAttribute(name);
      if (value !== null) out.push(`${name}="${escAttr(value)}"`);
    }
  }
  return out.length ? ` ${out.join(' ')}` : '';
}

function emptyInline(): Inline { return { html: '', text: '', masked: '', slots: {}, notes: [] }; }

/**
 * Walks inline content once, producing the display HTML, the plain text and the
 * masked text (placeholders for math, citations and cross references).
 * With `mask: false` placeholders are not produced and masked mirrors text.
 */
interface WalkOptions { mask: boolean; insideCite?: boolean; insideMath?: boolean; keepIds?: boolean; preserve?: boolean; skip?: Set<Node> }

function walkInline(node: Node, out: Inline, ctx: Ctx, opts: WalkOptions): void {
  if (opts.skip?.has(node)) return;
  if (node.nodeType === 3) {
    const data = opts.preserve ? (node.nodeValue ?? '') : squash(node.nodeValue ?? '');
    out.html += esc(data);
    if (!opts.insideMath) { out.text += data; out.masked += data; }
    return;
  }
  if (node.nodeType !== 1) return;
  const el = node as El;
  const tag = tagOf(el);
  const cls = classes(el);
  if (SKIP_TAGS.has(tag) || tag === 'annotation' || tag === 'annotation-xml') return;
  if (SKIP_CLASSES.some((name) => cls.has(name))) return;

  if (cls.has('ltx_note') && !opts.insideMath) {
    const content = el.querySelector('.ltx_note_content');
    const tagEl = content?.querySelector('.ltx_tag');
    tagEl?.remove();
    const noteText = squash(content?.textContent ?? '').trim();
    if (noteText) {
      out.notes.push(noteText);
      if (opts.mask) {
        const marker = `<sup class="ltx_note_mark">${out.notes.length}</sup>`;
        out.html += marker;
        out.masked += placeholder(out, marker);
      } else {
        out.html += `<sup class="ltx_note_mark" title="${escAttr(noteText)}">†</sup>`;
      }
    }
    return;
  }

  if (opts.mask && !opts.insideMath && isOpaque(el, cls, Boolean(opts.insideCite))) {
    const sub = emptyInline();
    walkInline(el, sub, ctx, { mask: false, insideCite: tag === 'cite' || cls.has('ltx_cite') || opts.insideCite });
    if (!sub.html) return; // e.g. an image whose source was rejected
    out.html += sub.html;
    out.text += sub.text;
    out.masked += placeholder(out, sub.html);
    return;
  }

  if (tag === 'br') { out.html += '<br>'; out.text += ' '; out.masked += ' '; return; }
  if (tag === 'math') {
    const alt = el.getAttribute('alttext') ?? '';
    let inner = '';
    for (const child of Array.from(el.childNodes)) {
      const part = emptyInline();
      walkInline(child, part, ctx, { mask: false, insideMath: true });
      inner += part.html;
    }
    out.html += `<math${attributes(el, 'math', ctx, false)}>${inner}</math>`;
    const tex = `$${alt || squash(el.textContent ?? '').trim()}$`;
    out.text += tex;
    out.masked += tex;
    return;
  }
  if (tag === 'semantics') {
    const first = el.firstElementChild;
    if (first) walkInline(first, out, ctx, opts);
    return;
  }
  if (opts.insideMath) {
    if (!MATHML_ALLOWED.has(tag)) { for (const child of Array.from(el.childNodes)) walkInline(child, out, ctx, opts); return; }
    out.html += `<${tag}${attributes(el, tag, ctx, false)}>`;
    for (const child of Array.from(el.childNodes)) walkInline(child, out, ctx, opts);
    out.html += `</${tag}>`;
    return;
  }
  if (tag === 'img') {
    const attrs = attributes(el, 'img', ctx, false);
    if (attrs) out.html += `<img${attrs} loading="lazy">`;
    out.text += el.getAttribute('alt') ?? '';
    return;
  }
  if (INLINE_ALLOWED.has(tag) || STRUCTURE_ALLOWED.has(tag)) {
    const keepId = Boolean(opts.keepIds);
    const preserve = opts.preserve || tag === 'pre' || cls.has('ltx_listing');
    out.html += `<${tag}${attributes(el, tag, ctx, keepId)}>`;
    for (const child of Array.from(el.childNodes)) walkInline(child, out, ctx, { ...opts, preserve });
    out.html += `</${tag}>`;
    return;
  }
  for (const child of Array.from(el.childNodes)) walkInline(child, out, ctx, opts);
}

function placeholder(out: Inline, html: string): string {
  const id = Object.keys(out.slots).length + 1;
  out.slots[String(id)] = html;
  return `⟦${id}⟧`;
}

function tidy(value: string): string { return value.replace(/\s+/g, ' ').replace(/\s+([,.;:!?)])/g, '$1').trim(); }

class Collector {
  readonly paragraphs: Paragraph[] = [];
  private readonly used = new Set<string>();
  private path: string[] = [];
  private listPrefix = '';
  private listDepth = 0;
  title = '';

  constructor(private readonly paperId: string, private readonly ctx: Ctx) {}

  private uniqueId(preferred: string | null | undefined): string {
    let id = preferred && preferred.trim() ? preferred.trim() : `b${this.paragraphs.length}`;
    while (this.used.has(id)) id += '_';
    this.used.add(id);
    return id;
  }

  private push(type: ParagraphType, id: string | null | undefined, body: Inline, extra: Partial<Paragraph> = {}): Paragraph | undefined {
    const text = tidy(body.text);
    const hasMedia = /<(img|math)\b/.test(body.html);
    if (!text && !hasMedia) return undefined;
    const paragraph: Paragraph = {
      id: this.uniqueId(id), paperId: this.paperId, order: this.paragraphs.length, type,
      html: body.html.trim(), text, sectionPath: [...this.path], ...extra
    };
    if (TRANSLATABLE.has(type) && text) {
      paragraph.masked = tidy(body.masked);
      if (Object.keys(body.slots).length) paragraph.slots = body.slots;
    }
    this.paragraphs.push(paragraph);
    return paragraph;
  }

  private inline(el: El, mask: boolean, skip?: Set<Node>): Inline {
    const out = emptyInline();
    for (const child of Array.from(el.childNodes)) walkInline(child, out, this.ctx, { mask, skip });
    return out;
  }

  private emitNotes(parent: Paragraph, notes: string[]): void {
    notes.forEach((note, index) => {
      const body: Inline = { html: `<sup class="ltx_note_mark">${index + 1}</sup> ${esc(note)}`, text: note, masked: note, slots: {}, notes: [] };
      this.push('footnote', `${parent.id}.fn${index + 1}`, body);
    });
  }

  walk(parent: El): void {
    for (const el of children(parent)) this.block(el);
  }

  private block(el: El): void {
    const tag = tagOf(el);
    const cls = classes(el);
    if (SKIP_TAGS.has(tag) || SKIP_CLASSES.some((name) => cls.has(name))) return;
    if (/^h[1-6]$/.test(tag)) return this.heading(el, tag, cls);
    if (tag === 'section') return this.walk(el);
    if (cls.has('ltx_authors')) return this.authors(el);
    if (tag === 'p') return this.paragraph(el, el.getAttribute('id'), parentAliases(el));
    if (tag === 'ul' && cls.has('ltx_biblist')) return this.bibliography(el);
    if (tag === 'ul' || tag === 'ol') return this.list(el);
    if (tag === 'figure') return this.figure(el);
    if (tag === 'table') return this.table(el, cls);
    if (tag === 'pre' || cls.has('ltx_listing')) return this.rich('code', el);
    if (cls.has('ltx_equation') || cls.has('ltx_equationgroup') || cls.has('ltx_eqn_table')) return this.rich('formula', el);
    if (tag === 'li') return this.walk(el);
    if (children(el).some((child) => BLOCK_TAGS.has(tagOf(child)) || classes(child).has('ltx_authors'))) return this.walk(el);
    this.paragraph(el, el.getAttribute('id'), []);
  }

  private heading(el: El, tag: string, cls: Set<string>): void {
    const body = this.inline(el, true);
    const text = tidy(body.text);
    if (!text) return;
    const parent = el.parentElement;
    const anchor = parent && tagOf(parent) === 'section' ? parent.getAttribute('id') : el.getAttribute('id');
    if (cls.has('ltx_title_document')) {
      this.title = text;
      this.path = [];
      this.push('title', anchor, body, { level: 0 });
      return;
    }
    const level = cls.has('ltx_title_abstract') ? 1 : Math.max(1, Number(tag[1]) - 1);
    this.path = this.path.slice(0, level - 1);
    this.path[level - 1] = text;
    this.push('heading', anchor, body, { level });
  }

  private authors(el: El): void {
    const names = Array.from(el.querySelectorAll('.ltx_personname')).map((node) => tidy(plainName(node as El))).filter(Boolean);
    if (!names.length) return;
    const joined = names.join(', ');
    this.push('authors', 'authors', { html: esc(joined), text: joined, masked: joined, slots: {}, notes: [] });
  }

  private paragraph(el: El, id: string | null, aliases: string[], skip?: Set<Node>): void {
    const body = this.inline(el, true, skip);
    let type: ParagraphType = 'paragraph';
    const extra: Partial<Paragraph> = {};
    if (aliases.length) extra.aliases = aliases;
    if (this.listPrefix) {
      type = 'list';
      body.html = `${this.listPrefix} ${body.html}`;
      body.text = `${tidy(stripTags(this.listPrefix))} ${body.text}`;
      body.masked = `${tidy(stripTags(this.listPrefix))} ${body.masked}`;
      extra.level = this.listDepth;
      this.listPrefix = '';
    }
    const made = this.push(type, id, body, extra);
    if (made && body.notes.length) this.emitNotes(made, body.notes);
  }

  private list(el: El): void {
    this.listDepth += 1;
    for (const item of children(el)) {
      if (tagOf(item) !== 'li') continue;
      const tagEl = children(item).find((child) => classes(child).has('ltx_tag'));
      this.listPrefix = tagEl ? this.inline(tagEl, false).html : '•';
      const rest = children(item).filter((child) => child !== tagEl);
      const hasBlocks = rest.some((child) => BLOCK_TAGS.has(tagOf(child)));
      if (hasBlocks) for (const child of rest) this.block(child);
      else this.paragraph(item, item.getAttribute('id'), [], new Set(tagEl ? [tagEl] : []));
      this.listPrefix = '';
    }
    this.listDepth -= 1;
  }

  private bibliography(el: El): void {
    for (const item of children(el)) {
      if (tagOf(item) !== 'li') continue;
      const body = this.inline(item, false);
      this.push('references', item.getAttribute('id'), body);
    }
  }

  private rich(type: 'formula' | 'figure' | 'table' | 'code', el: El, skip?: Set<Node>): void {
    const out = emptyInline();
    const preserve = tagOf(el) === 'pre' || classes(el).has('ltx_listing');
    for (const child of Array.from(el.childNodes)) walkInline(child, out, this.ctx, { mask: false, skip, preserve });
    const wrapperTag = ['pre', 'table'].includes(tagOf(el)) ? tagOf(el) : 'div';
    const html = `<${wrapperTag}${attributes(el, 'div', this.ctx, false)}>${out.html}</${wrapperTag}>`;
    this.push(type, el.getAttribute('id'), { ...out, html });
  }

  private table(el: El, cls: Set<string>): void {
    if (cls.has('ltx_equation') || cls.has('ltx_equationgroup') || cls.has('ltx_eqn_table')) return this.rich('formula', el);
    this.rich('table', el);
  }

  private figure(el: El): void {
    const captions = children(el).filter((child) => tagOf(child) === 'figcaption');
    const cls = classes(el);
    const kind: 'figure' | 'table' = cls.has('ltx_table') && !el.querySelector('img') ? 'table' : 'figure';
    const captionFirst = children(el)[0] && tagOf(children(el)[0]) === 'figcaption';
    const emitCaptions = () => {
      captions.forEach((caption, index) => {
        const body = this.inline(caption, true);
        const made = this.push('caption', `${el.getAttribute('id') ?? 'fig'}.cap${index || ''}`, body);
        if (made && body.notes.length) this.emitNotes(made, body.notes);
      });
    };
    if (captionFirst) emitCaptions();
    const skip = new Set<Node>(captions);
    if (children(el).some((child) => !skip.has(child))) this.rich(kind, el, skip);
    if (!captionFirst) emitCaptions();
  }
}

/** Name text without footnote marks, thanks notes and affiliation blocks. */
function plainName(el: El): string {
  let out = '';
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3) { out += child.nodeValue ?? ''; continue; }
    if (child.nodeType !== 1) continue;
    const node = child as El;
    const cls = classes(node);
    if (cls.has('ltx_note') || cls.has('ltx_author_notes') || tagOf(node) === 'sup') continue;
    out += plainName(node);
  }
  return out;
}

function stripTags(html: string): string { return html.replace(/<[^>]+>/g, ''); }

function parentAliases(el: El): string[] {
  const parent = el.parentElement;
  const id = parent?.getAttribute('id');
  return parent && id && classes(parent).has('ltx_para') ? [id] : [];
}

export function parseLatexmlHtml(html: string, opts: { paperId: string; baseUrl: string }): ParsedArticle {
  const { document } = parseHTML(html);
  const root = (document.querySelector('article.ltx_document') ?? document.querySelector('.ltx_page_content') ?? document.body) as unknown as El | null;
  if (!root) return { title: '', paragraphs: [], images: [] };
  const ctx: Ctx = { baseUrl: opts.baseUrl, images: new Set() };
  const collector = new Collector(opts.paperId, ctx);
  collector.walk(root);
  return { title: collector.title || tidy(document.querySelector('title')?.textContent ?? ''), paragraphs: collector.paragraphs, images: [...ctx.images] };
}

export function looksLikeLatexml(html: string): boolean {
  return /class="[^"]*\bltx_document\b/.test(html) || /class="[^"]*\bltx_page_content\b/.test(html);
}

/** Restores `⟦n⟧` placeholders in a translation with the original HTML. */
export function restorePlaceholders(translation: string, slots: Record<string, string> | undefined): string {
  return esc(translation).replace(/⟦(\d+)⟧/g, (whole, id: string) => slots?.[id] ?? '');
}

/** True when every placeholder of the source is still present in the translation. */
export function placeholdersIntact(masked: string, translation: string): boolean {
  const want = (masked.match(/⟦\d+⟧/g) ?? []).sort();
  const have = (translation.match(/⟦\d+⟧/g) ?? []).sort();
  return want.length === have.length && want.every((value, index) => value === have[index]);
}
