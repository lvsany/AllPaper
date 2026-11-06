import { describe, expect, it } from 'vitest';
import { acceptQuote, alignBySentence, chineseSentences, englishSentences, findQuote, fingerprint, translationSpan } from './align';

const EN = 'Recurrent models factor computation along positions. This precludes parallelization, e.g. within examples. Attention mechanisms have become integral (Bahdanau et al. 2014).';
const ZH = '循环模型沿位置分解计算。这阻碍了并行化，例如在样本内部。注意力机制已成为不可或缺的部分（Bahdanau 等，2014）。';

const slice = (text: string, span?: [number, number]) => (span ? text.slice(span[0], span[1]) : undefined);

describe('sentence splitting', () => {
  it('does not break English sentences at abbreviations', () => {
    expect(englishSentences(EN).map((s) => EN.slice(s[0], s[1]))).toEqual([
      'Recurrent models factor computation along positions.',
      'This precludes parallelization, e.g. within examples.',
      'Attention mechanisms have become integral (Bahdanau et al. 2014).'
    ]);
  });
  it('splits Chinese at full stops', () => {
    expect(chineseSentences(ZH)).toHaveLength(3);
  });
});

describe('alignBySentence', () => {
  it('maps a phrase to the translated sentence when sentence counts match', () => {
    const start = EN.indexOf('parallelization');
    expect(slice(ZH, alignBySentence(EN, ZH, start, start + 15))).toBe('这阻碍了并行化，例如在样本内部。');
  });
  it('covers every sentence the span touches', () => {
    const start = EN.indexOf('positions');
    const end = EN.indexOf('This precludes') + 4;
    expect(slice(ZH, alignBySentence(EN, ZH, start, end))).toBe('循环模型沿位置分解计算。这阻碍了并行化，例如在样本内部。');
  });
  it('falls back to relative position when the translation merged sentences', () => {
    const merged = '循环模型沿位置分解计算，这阻碍了并行化。注意力机制已成为不可或缺的部分。';
    const start = EN.indexOf('Attention');
    expect(slice(merged, alignBySentence(EN, merged, start, start + 9))).toBe('注意力机制已成为不可或缺的部分。');
  });
});

describe('model quotes', () => {
  it('accepts a quote only when it occurs in the translation', () => {
    expect(acceptQuote('「并行化」', ZH)).toBe('并行化');
    expect(acceptQuote('并行化。', '这阻碍了并行化，例如')).toBe('并行化');
    expect(acceptQuote('NONE', ZH)).toBeUndefined();
    expect(acceptQuote('并行计算', ZH)).toBeUndefined();
  });
  it('picks the repeat closest to the source position', () => {
    const target = '模型 A 很好。另一个模型更好。';
    expect(findQuote(target, '模型', 0.9)).toEqual([target.lastIndexOf('模型'), target.lastIndexOf('模型') + 2]);
    expect(findQuote(target, '模型', 0)).toEqual([0, 2]);
  });
  it('uses the quote when present and the sentence guess otherwise', () => {
    const start = EN.indexOf('parallelization');
    expect(translationSpan(EN, ZH, start, start + 15, '并行化')).toEqual({ span: [ZH.indexOf('并行化'), ZH.indexOf('并行化') + 3], approx: false });
    const stale = translationSpan(EN, ZH, start, start + 15, '旧译文里的词');
    expect(stale?.approx).toBe(true);
    expect(slice(ZH, stale?.span)).toBe('这阻碍了并行化，例如在样本内部。');
  });
  it('fingerprints differ for different translations', () => {
    expect(fingerprint(ZH)).not.toBe(fingerprint(ZH + '。'));
    expect(fingerprint(ZH)).toBe(fingerprint(ZH));
  });
});
