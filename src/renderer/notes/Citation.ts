import { Node } from '@tiptap/core';

/** Inline chip for `[@key]`, `[@key#anchor]` and `[@key, p.5]`. */
export const Citation = Node.create({
  name: 'citation',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { key: { default: '' }, anchor: { default: null }, page: { default: null }, label: { default: '' } };
  },
  parseHTML() { return [{ tag: 'span[data-citation]' }]; },
  renderHTML({ node }) {
    return ['span', {
      class: 'cite-chip', 'data-citation': '', 'data-key': node.attrs.key, 'data-anchor': node.attrs.anchor ?? '',
      title: `${node.attrs.key}${node.attrs.anchor ? ` · 原文片段 ${node.attrs.anchor}` : ''}`
    }, node.attrs.label || node.attrs.key];
  }
});
