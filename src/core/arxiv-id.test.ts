import { describe, expect, it } from 'vitest';
import { extractDoi, parseArxivAtom, parseArxivId } from './arxiv-id';

describe('arXiv ids', () => {
  it('parses ids, versions and the usual links', () => {
    expect(parseArxivId('2512.07404')).toEqual({ id: '2512.07404', version: undefined });
    expect(parseArxivId('arXiv:2512.07404v3')).toEqual({ id: '2512.07404', version: 'v3' });
    expect(parseArxivId('https://arxiv.org/html/2512.07404v3?_immersive_translate_auto_translate=1')).toEqual({ id: '2512.07404', version: 'v3' });
    expect(parseArxivId('https://arxiv.org/pdf/1706.03762.pdf')).toEqual({ id: '1706.03762', version: undefined });
    expect(parseArxivId('https://ar5iv.labs.arxiv.org/html/1706.03762')?.id).toBe('1706.03762');
    expect(parseArxivId('cs/0112017')?.id).toBe('cs/0112017');
    expect(parseArxivId('hello world')).toBeUndefined();
  });

  it('extracts DOIs', () => {
    expect(extractDoi('https://doi.org/10.1145/3597503.3639187.')).toBe('10.1145/3597503.3639187');
  });

  it('reads the arXiv atom feed', () => {
    const xml = `<feed><entry><id>http://arxiv.org/abs/2512.07404v3</id><title>On LLMs' Internal
 Representation</title><summary> We study &amp; show. </summary><published>2025-12-08T10:38:03Z</published>
<category term="cs.SE"/><category term="cs.AI"/><arxiv:comment>Accepted for ICSE'26</arxiv:comment>
<author><name>Francisco Ribeiro</name></author><author><name>Sarah Nadi</name></author></entry></feed>`;
    const meta = parseArxivAtom(xml)!;
    expect(meta).toMatchObject({ id: '2512.07404', version: 'v3', year: 2025, categories: ['cs.SE', 'cs.AI'], comment: "Accepted for ICSE'26" });
    expect(meta.title).toBe("On LLMs' Internal Representation");
    expect(meta.abstract).toBe('We study & show.');
    expect(meta.authors).toEqual([{ given: 'Francisco', family: 'Ribeiro' }, { given: 'Sarah', family: 'Nadi' }]);
  });
});
