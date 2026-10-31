import { applyMarkdownShortcut, editEnglish, hash, splitPastedText, updateChinese, type DraftBlock } from './draft';

/**
 * Editing operations for the bilingual draft, the same for both columns, so the English side behaves like a
 * normal editor too. Chinese edits feed translation; any English edit locks the block (it is the user's text).
 */
export type Side = 'zh' | 'en';

export const textOf = (block: DraftBlock, side: Side) => side === 'zh' ? block.zhText : block.enText;

export function emptyBlock(id: string, order = 0): DraftBlock {
  return { id, order, type: 'paragraph', zhText: '', enText: '', zhHash: hash(''), locked: false, status: 'synced' };
}

/** `# `, `## ` or `### ` typed at the start of an English paragraph makes it a heading. */
export function applyEnglishShortcut(block: DraftBlock): DraftBlock {
  if (block.type !== 'paragraph') return block;
  const m = block.enText.match(/^(#{1,3})\s/);
  return m ? { ...block, type: 'heading', level: m[1].length as 1 | 2 | 3, enText: block.enText.slice(m[0].length) } : block;
}

export function setText(block: DraftBlock, side: Side, text: string): DraftBlock {
  return side === 'zh' ? applyMarkdownShortcut(updateChinese(block, text)) : applyEnglishShortcut(editEnglish(block, text));
}

/** Enter in the middle of a block: the text after the caret moves to a new block below. */
export function splitAt(block: DraftBlock, side: Side, caret: number, newId: string): [DraftBlock, DraftBlock] {
  const text = textOf(block, side);
  const before = text.slice(0, caret);
  const after = text.slice(caret);
  const first = side === 'zh' ? updateChinese(block, before) : editEnglish(block, before);
  const second = after ? setText(emptyBlock(newId, block.order + 1), side, after) : emptyBlock(newId, block.order + 1);
  return [first, second];
}

/** Backspace at the start of a block joins it, both columns, onto the block above. */
export function mergeInto(previous: DraftBlock, block: DraftBlock, side: Side): { block: DraftBlock; caret: number } {
  const zh = previous.zhText + block.zhText;
  const space = previous.enText && block.enText ? ' ' : '';
  const en = previous.enText + space + block.enText;
  const caret = side === 'zh' ? previous.zhText.length : previous.enText.length + space.length;
  if (previous.locked || block.locked) return { block: { ...previous, zhText: zh, zhHash: hash(zh), enText: en, locked: true, status: 'locked' }, caret };
  return { block: updateChinese({ ...previous, enText: en }, zh), caret };
}

/**
 * Paragraphs to paste. A line break at the very start (or end) of the clipboard text means the pasted text
 * begins (or ends) a paragraph, so it does not get glued onto the text around the caret; that is marked
 * with an empty first (or last) entry.
 */
export function pasteSegments(raw: string): string[] {
  const paragraphs = splitPastedText(raw);
  if (!paragraphs.length) return [];
  const startsParagraph = /^[ \t]*\r?\n/.test(raw);
  const endsParagraph = /\r?\n[ \t]*$/.test(raw);
  return [...(startsParagraph ? [''] : []), ...paragraphs, ...(endsParagraph ? [''] : [])];
}

/**
 * Pastes several paragraphs at the selection: the text before the selection keeps the first paragraph, each
 * further paragraph becomes its own block, and the text after the selection follows the last one.
 * Undefined for a single paragraph, so the normal paste happens.
 */
export function pasteInto(block: DraftBlock, side: Side, start: number, end: number, paragraphs: string[], makeId: () => string): { blocks: DraftBlock[]; caret: number } | undefined {
  if (paragraphs.length < 2) return undefined;
  const text = textOf(block, side);
  const before = text.slice(0, start);
  const after = text.slice(end);
  const first = setText(block, side, before + paragraphs[0]);
  const middle = paragraphs.slice(1, -1).map((p) => setText(emptyBlock(makeId()), side, p));
  const last = setText(emptyBlock(makeId()), side, paragraphs[paragraphs.length - 1] + after);
  return { blocks: [first, ...middle, last], caret: textOf(last, side).length - after.length };
}

/** A whole new document from paragraphs (select all, then paste). */
export function documentFrom(side: Side, paragraphs: string[], makeId: () => string): DraftBlock[] {
  const blocks = paragraphs.map((p, order) => setText(emptyBlock(makeId(), order), side, p));
  return blocks.length ? blocks : [emptyBlock(makeId())];
}

/** One column as plain text (what Copy puts on the clipboard after select all); headings keep their #. */
export function columnText(blocks: DraftBlock[], side: Side): string {
  return blocks
    .map((b) => {
      const text = textOf(b, side).trim();
      if (!text) return '';
      return b.type === 'heading' ? `${'#'.repeat(b.level ?? 1)} ${text}` : text;
    })
    .filter(Boolean)
    .join('\n\n');
}
