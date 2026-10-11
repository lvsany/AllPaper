// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { applyHighlights, linearize, locate, offsetOf, selectionPortions } from './dom';

const block = (html: string) => {
  document.body.innerHTML = `<article><div data-orig data-pid="p1">${html}</div></article>`;
  return document.querySelector<HTMLElement>('[data-orig]')!;
};

describe('reader dom helpers', () => {
  it('writes formulas as TeX in the linear text', () => {
    const el = block('The state <math alttext="h_t"><mi>h</mi></math> is updated.');
    expect(linearize(el).text).toBe('The state $h_t$ is updated.');
  });

  it('turns a selection into offsets, even across inline markup', () => {
    const el = block('We <em>match</em> the budget and report <b>accuracy</b>.');
    const range = document.createRange();
    range.setStart(el.querySelector('em')!.firstChild!, 0);
    range.setEnd(el.querySelector('b')!.firstChild!, 8);
    const [portion] = selectionPortions(range, document.querySelector('article')!);
    expect(portion.quotedText).toBe('match the budget and report accuracy');
    expect(portion.start).toBe(3);
    expect(offsetOf(linearize(el).segments, 43, el, el.childNodes.length, 'end')).toBe(linearize(el).text.length);
  });

  it('highlights a range spanning several nodes without changing the text', () => {
    const el = block('We <em>match</em> the budget.');
    const before = linearize(el).text;
    applyHighlights(el, [{ id: 'a1', color: 'yellow', start: 3, end: 15 }]);
    expect(linearize(el).text).toBe(before);
    const marked = [...el.querySelectorAll('mark[data-ann="a1"]')].map((m) => m.textContent).join('');
    expect(marked).toBe('match the bu');
  });

  it('supports overlapping highlights', () => {
    const el = block('alpha beta gamma delta');
    applyHighlights(el, [{ id: 'a', color: 'yellow', start: 0, end: 10 }, { id: 'b', color: 'red', start: 6, end: 16 }]);
    expect(linearize(el).text).toBe('alpha beta gamma delta');
    expect([...el.querySelectorAll('mark[data-ann="b"]')].map((m) => m.textContent).join('')).toBe('beta gamma');
  });

  it('re-locates an annotation after the paragraph text shifted, and reports lost ones', () => {
    const annotation = { quotedText: 'matched budget', prefix: 'We use a ', suffix: ' for fairness', offsets: [9, 23] as [number, number] };
    expect(locate(annotation, 'We use a matched budget for fairness')).toEqual([9, 23]);
    expect(locate(annotation, 'Note: We use a matched budget for fairness')).toEqual([15, 29]);
    expect(locate(annotation, 'Completely different text')).toBeUndefined();
  });
});
