/**
 * Notes are stored as plain Markdown. These helpers convert between that text
 * and the ProseMirror JSON the editor uses, without needing a DOM.
 *
 * Citations use the Pandoc-compatible forms `[@key]`, `[@key, p.5]` and
 * `[@key#anchor]` (a highlighted passage in the paper).
 */
export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

export interface CitationRef { key: string; anchor?: string; page?: string }
export type LabelOf = (ref: CitationRef) => string;

const CITATION = /\[@([^\]#,\s]+)(?:#([A-Za-z0-9_-]+))?(?:,\s*p\.\s*([^\]]+))?\]/;

// ---- Markdown -> document ---------------------------------------------------

function inlineNodes(text: string, labelOf: LabelOf, marks: DocNode['marks'] = []): DocNode[] {
  const out: DocNode[] = [];
  let plain = '';
  const flush = () => {
    if (plain) { out.push({ type: 'text', text: plain, ...(marks.length ? { marks } : {}) }); plain = ''; }
  };
  const withMark = (mark: { type: string; attrs?: Record<string, unknown> }) => [...marks, mark];
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    let match: RegExpMatchArray | null;
    if (rest[0] === '\\' && i + 1 < text.length && /[\\`*_{}\[\]()#+\-.!>~|@]/.test(rest[1])) { plain += rest[1]; i += 2; continue; }
    if (rest[0] === '\n') { flush(); out.push({ type: 'hardBreak' }); i += 1; continue; }
    if ((match = rest.match(/^\$[^$\s][^$\n]*\$/))) { plain += match[0]; i += match[0].length; continue; }
    if ((match = rest.match(/^`([^`]+)`/))) {
      flush(); out.push({ type: 'text', text: match[1], marks: [...marks, { type: 'code' }] }); i += match[0].length; continue;
    }
    if ((match = rest.match(new RegExp(`^${CITATION.source}`)))) {
      flush();
      const ref: CitationRef = { key: match[1], anchor: match[2], page: match[3]?.trim() };
      out.push({ type: 'citation', attrs: { key: ref.key, anchor: ref.anchor ?? null, page: ref.page ?? null, label: labelOf(ref) } });
      i += match[0].length; continue;
    }
    if ((match = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/))) {
      flush(); out.push(...inlineNodes(match[1], labelOf, withMark({ type: 'link', attrs: { href: match[2] } }))); i += match[0].length; continue;
    }
    if ((match = rest.match(/^\*\*(?!\s)([\s\S]+?)(?<!\s)\*\*/))) {
      flush(); out.push(...inlineNodes(match[1], labelOf, withMark({ type: 'bold' }))); i += match[0].length; continue;
    }
    if ((match = rest.match(/^~~(?!\s)([\s\S]+?)(?<!\s)~~/))) {
      flush(); out.push(...inlineNodes(match[1], labelOf, withMark({ type: 'strike' }))); i += match[0].length; continue;
    }
    if ((match = rest.match(/^\*(?![\s*])([\s\S]+?)(?<![\s*])\*/)) || (/^\W?$/.test(text[i - 1] ?? '') && (match = rest.match(/^_(?![\s_])([\s\S]+?)(?<![\s_])_(?!\w)/)))) {
      flush(); out.push(...inlineNodes(match[1], labelOf, withMark({ type: 'italic' }))); i += match[0].length; continue;
    }
    plain += rest[0];
    i += 1;
  }
  flush();
  return out;
}

const FENCE = /^```(\w*)\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TASK = /^\[( |x|X)\]\s+(.*)$/;

function indentOf(line: string): number { return line.match(/^\s*/)![0].replace(/\t/g, '    ').length; }

function parseBlocks(lines: string[], labelOf: LabelOf): DocNode[] {
  const blocks: DocNode[] = [];
  let i = 0;
  const isBlockStart = (line: string) => /^(#{1,6})\s/.test(line) || FENCE.test(line) || /^\s*>/.test(line) || LIST_ITEM.test(line) || /^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim());
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    let match: RegExpMatchArray | null;
    if ((match = line.match(FENCE))) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) { body.push(lines[i]); i += 1; }
      i += 1;
      blocks.push({ type: 'codeBlock', attrs: { language: match[1] || null }, content: body.length ? [{ type: 'text', text: body.join('\n') }] : [] });
      continue;
    }
    if ((match = line.match(/^(#{1,6})\s+(.*)$/))) {
      blocks.push({ type: 'heading', attrs: { level: match[1].length }, content: inlineNodes(match[2].trim(), labelOf) });
      i += 1; continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) { blocks.push({ type: 'horizontalRule' }); i += 1; continue; }
    if (/^\s*>/.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { inner.push(lines[i].replace(/^\s*> ?/, '')); i += 1; }
      blocks.push({ type: 'blockquote', content: parseBlocks(inner, labelOf) });
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const [node, next] = parseList(lines, i, labelOf);
      blocks.push(node);
      i = next;
      continue;
    }
    const paragraph: string[] = [line.trimEnd()];
    i += 1;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) { paragraph.push(lines[i].trimEnd()); i += 1; }
    blocks.push({ type: 'paragraph', content: inlineNodes(paragraph.join('\n').replace(/ {2,}\n/g, '\n').replace(/\\\n/g, '\n'), labelOf) });
  }
  return blocks;
}

function parseList(lines: string[], start: number, labelOf: LabelOf): [DocNode, number] {
  const first = lines[start].match(LIST_ITEM)!;
  const baseIndent = indentOf(lines[start]);
  const ordered = /\d/.test(first[2]);
  const items: DocNode[] = [];
  let task = false;
  let i = start;
  while (i < lines.length) {
    const match = lines[i].match(LIST_ITEM);
    if (!match || indentOf(lines[i]) !== baseIndent || /\d/.test(match[2]) !== ordered) break;
    let text = match[3];
    const taskMatch = text.match(TASK);
    let checked: boolean | undefined;
    if (taskMatch) { task = true; checked = taskMatch[1] !== ' '; text = taskMatch[2]; }
    i += 1;
    const children: DocNode[] = [];
    const continuation: string[] = [text];
    while (i < lines.length && lines[i].trim()) {
      const nested = lines[i].match(LIST_ITEM);
      if (nested && indentOf(lines[i]) > baseIndent) {
        const [sub, next] = parseList(lines, i, labelOf);
        children.push(sub);
        i = next;
      } else if (!nested && indentOf(lines[i]) > baseIndent) {
        continuation.push(lines[i].trim());
        i += 1;
      } else break;
    }
    const body: DocNode[] = [{ type: 'paragraph', content: inlineNodes(continuation.join('\n'), labelOf) }, ...children];
    items.push({ type: task ? 'taskItem' : 'listItem', ...(task ? { attrs: { checked: Boolean(checked) } } : {}), content: body });
  }
  const type = task ? 'taskList' : ordered ? 'orderedList' : 'bulletList';
  return [{ type, content: items }, i];
}

export function markdownToDoc(markdown: string, labelOf: LabelOf = (ref) => ref.key): DocNode {
  const blocks = parseBlocks(markdown.replace(/\r\n/g, '\n').split('\n'), labelOf);
  return { type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] };
}

// ---- document -> Markdown ---------------------------------------------------

/** Escapes Markdown syntax in prose; `$...$` math is left untouched so TeX stays valid. */
function escapeText(text: string): string {
  return text.split(/(\$[^$\n]+\$)/).map((part, index) => index % 2 === 1 ? part : part.replace(/([\\`*_~])/g, '\\$1').replace(/\[(?=@)/g, '\\[')).join('');
}

function inlineMarkdown(nodes: DocNode[] = []): string {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'hardBreak') { out += '  \n'; continue; }
    if (node.type === 'citation') {
      const { key, anchor, page } = node.attrs as { key: string; anchor?: string | null; page?: string | null };
      out += `[@${key}${anchor ? `#${anchor}` : ''}${page ? `, p.${page}` : ''}]`;
      continue;
    }
    if (node.type !== 'text' || node.text === undefined) continue;
    const marks = node.marks ?? [];
    const isCode = marks.some((m) => m.type === 'code');
    const [, lead, core, trail] = node.text.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
    let body = isCode ? `\`${core}\`` : escapeText(core);
    if (!core) { out += node.text; continue; }
    for (const mark of marks) {
      if (mark.type === 'bold') body = `**${body}**`;
      else if (mark.type === 'italic') body = `*${body}*`;
      else if (mark.type === 'strike') body = `~~${body}~~`;
      else if (mark.type === 'link') body = `[${body}](${String(mark.attrs?.href ?? '')})`;
    }
    out += `${lead}${body}${trail}`;
  }
  return out;
}

function escapeLineStart(text: string): string {
  return text.replace(/^(\s*)([#>+-]|\d+[.)])(\s)/, '$1\\$2$3');
}

function blockMarkdown(node: DocNode, indent = ''): string {
  const children = node.content ?? [];
  switch (node.type) {
    case 'paragraph':
      return indent + escapeLineStart(inlineMarkdown(children));
    case 'heading':
      return `${'#'.repeat(Number(node.attrs?.level ?? 1))} ${inlineMarkdown(children)}`;
    case 'blockquote':
      return children.map((child) => blockMarkdown(child)).join('\n\n').split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');
    case 'codeBlock': {
      const text = children.map((child) => child.text ?? '').join('');
      return `\`\`\`${String(node.attrs?.language ?? '')}\n${text}\n\`\`\``;
    }
    case 'horizontalRule':
      return '---';
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return listMarkdown(node, indent);
    default:
      return children.map((child) => blockMarkdown(child, indent)).join('\n\n');
  }
}

function listMarkdown(list: DocNode, indent: string): string {
  const lines: string[] = [];
  (list.content ?? []).forEach((item, index) => {
    const marker = list.type === 'orderedList' ? `${index + 1}.` : '-';
    const task = list.type === 'taskList' ? `[${item.attrs?.checked ? 'x' : ' '}] ` : '';
    const [head, ...rest] = item.content ?? [];
    const first = head ? inlineMarkdown(head.content).replace(/ {2}\n/g, `\n${indent}   `) : '';
    lines.push(`${indent}${marker} ${task}${escapeLineStart(first)}`);
    for (const child of rest) {
      if (['bulletList', 'orderedList', 'taskList'].includes(child.type)) lines.push(listMarkdown(child, `${indent}  `));
      else lines.push(`${indent}  ${inlineMarkdown(child.content)}`);
    }
  });
  return lines.join('\n');
}

export function docToMarkdown(doc: DocNode): string {
  const blocks = (doc.content ?? []).map((node) => blockMarkdown(node)).filter((text, index, all) => text !== '' || index < all.length - 1);
  return `${blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

// ---- helpers used by the reader and the quick-capture dialog ---------------

export function excerptMarkdown(args: { quote: string | string[]; translation?: string; key: string; anchor?: string }): string {
  const quotes = (Array.isArray(args.quote) ? args.quote : [args.quote]).map((q) => q.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const lines = quotes.flatMap((quote, index) => (index ? ['>', `> ${escapeText(quote)}`] : [`> ${escapeText(quote)}`]));
  if (args.translation?.trim()) lines.push('>', `> ${escapeText(args.translation.replace(/\s+/g, ' ').trim())}`);
  lines.push('>', `> [@${args.key}${args.anchor ? `#${args.anchor}` : ''}]`);
  return lines.join('\n');
}

export function citationsIn(markdown: string): CitationRef[] {
  const seen: CitationRef[] = [];
  for (const match of markdown.matchAll(new RegExp(CITATION.source, 'g'))) {
    seen.push({ key: match[1], anchor: match[2], page: match[3]?.trim() });
  }
  return seen;
}
