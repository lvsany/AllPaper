import { describe, expect, it } from 'vitest';
import { extractDoi, parseArxivAbsPage, parseArxivAtom, parseArxivId } from './arxiv-id';

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

  it('reads metadata from an abs page when the API is rate limited', () => {
    const html = `<meta name="citation_title" content="On LLMs&#39; Internal Representation of Code Correctness" />
<meta name="citation_author" content="Ribeiro, Francisco" /><meta name="citation_author" content="Nadi, Sarah" />
<meta name="citation_date" content="2025/12/08" /><meta name="citation_arxiv_id" content="2512.07404" />
<meta name="citation_abstract" content="Despite the effectiveness of LLMs, they often output incorrect code." />
<td class="tablecell subjects"><span class="primary-subject">Software Engineering (cs.SE)</span>; Artificial Intelligence (cs.AI)</td>
<td class="tablecell comments mathjax">Accepted for ICSE&#39;26</td>`;
    const meta = parseArxivAbsPage(html)!;
    expect(meta).toMatchObject({ id: '2512.07404', year: 2025, categories: ['cs.SE', 'cs.AI'], comment: "Accepted for ICSE'26" });
    expect(meta.title).toBe("On LLMs' Internal Representation of Code Correctness");
    expect(meta.authors).toEqual([{ family: 'Ribeiro', given: 'Francisco' }, { family: 'Nadi', given: 'Sarah' }]);
    expect(parseArxivAbsPage('<html></html>')).toBeUndefined();
  });
});
