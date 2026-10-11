import { describe, expect, it } from 'vitest';
import { looksLikeLatexml, parseLatexmlHtml, placeholdersIntact, restorePlaceholders } from './arxiv-html';

const doc = `<!DOCTYPE html><html><head><title>t</title><script>evil()</script></head><body><div class="ltx_page_content">
<article class="ltx_document">
<h1 class="ltx_title ltx_title_document">Budget-Aware Agents</h1>
<div class="ltx_authors"><span class="ltx_creator"><span class="ltx_personname">Lin Wang</span></span>, <span class="ltx_personname">Yu Chen</span></div>
<div id="abstract1" class="ltx_abstract"><h6 class="ltx_title ltx_title_abstract">Abstract.</h6><p id="abstract1.1" class="ltx_p">We study agents.</p></div>
<section id="S1" class="ltx_section"><h2 class="ltx_title ltx_title_section"><span class="ltx_tag ltx_tag_section">1. </span>Introduction</h2>
<div id="S1.p1" class="ltx_para"><p id="S1.p1.1" class="ltx_p">The state <math id="m1" alttext="h_{t}" display="inline"><semantics><msub><mi>h</mi><mi>t</mi></msub><annotation encoding="application/x-tex">h_{t}</annotation></semantics></math> follows
 <cite class="ltx_cite"><a href="#bib.bib1" class="ltx_ref">Vaswani et al., 2017</a></cite>; see <a class="ltx_ref" href="#S1.F1"><span class="ltx_text ltx_ref_tag">Figure 1</span></a>.<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup><span class="ltx_note_outer"><span class="ltx_note_content"><span class="ltx_tag ltx_tag_note">1</span>A note.</span></span></span>
<img src="javascript:alert(1)"><a href="javascript:alert(2)" onclick="x()">bad</a><script>alert(3)</script></p></div>
<ul class="ltx_itemize"><li class="ltx_item"><span class="ltx_tag ltx_tag_item">•</span><div class="ltx_para"><p class="ltx_p">First item.</p></div></li></ul>
<figure id="S1.F1" class="ltx_figure"><img src="x1.png" alt="Refer to caption" width="300" height="200" onerror="boom()"><figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_figure">Figure 1: </span>Overview.</figcaption></figure>
<table id="S1.E1" class="ltx_equation ltx_eqn_table"><tbody><tr class="ltx_equation"><td><math alttext="a=b" display="block"><mi>a</mi></math></td></tr></tbody></table>
</section>
<section class="ltx_bibliography"><h2 class="ltx_title ltx_title_bibliography">References</h2><ul class="ltx_biblist"><li id="bib.bib1" class="ltx_bibitem"><span class="ltx_bibblock">Vaswani. Attention is all you need.</span></li></ul></section>
</article></div></body></html>`;

describe('LaTeXML article parser', () => {
  const parsed = parseLatexmlHtml(doc, { paperId: 'x', baseUrl: 'https://arxiv.org/html/2501.00001v1' });
  const find = (id: string) => parsed.paragraphs.find((p) => p.id === id)!;

  it('recognizes arXiv HTML and extracts the title and block order', () => {
    expect(looksLikeLatexml(doc)).toBe(true);
    expect(parsed.title).toBe('Budget-Aware Agents');
    expect(parsed.paragraphs.map((p) => p.type)).toEqual(['title', 'authors', 'heading', 'paragraph', 'heading', 'paragraph', 'footnote', 'list', 'figure', 'caption', 'formula', 'heading', 'references']);
    expect(parsed.paragraphs.map((p) => p.order)).toEqual(parsed.paragraphs.map((_, i) => i));
  });

  it('keeps ids that in-document links point to', () => {
    expect(find('S1').type).toBe('heading');
    expect(find('S1.F1').type).toBe('figure');
    expect(find('S1.E1').type).toBe('formula');
    expect(find('bib.bib1').type).toBe('references');
    expect(find('S1.p1.1').aliases).toEqual(['S1.p1']);
  });

  it('masks math, citations and references for translation and restores them', () => {
    const p = find('S1.p1.1');
    expect(p.text).toContain('$h_{t}$');
    expect(p.masked).toBe('The state ⟦1⟧ follows ⟦2⟧; see ⟦3⟧.⟦4⟧ bad');
    expect(p.slots?.['1']).toContain('<math');
    expect(p.slots?.['2']).toContain('Vaswani et al., 2017');
    const zh = '状态 ⟦1⟧ 遵循 ⟦2⟧；见 ⟦3⟧。⟦4⟧ bad';
    expect(placeholdersIntact(p.masked!, zh)).toBe(true);
    expect(placeholdersIntact(p.masked!, '状态 ⟦1⟧ 遵循')).toBe(false);
    expect(restorePlaceholders(zh, p.slots)).toContain('<cite');
  });

  it('never lets scripts, event handlers or javascript: urls through', () => {
    const everything = parsed.paragraphs.map((p) => p.html + Object.values(p.slots ?? {}).join('')).join('\n');
    expect(everything).not.toMatch(/<script|onerror|onclick|javascript:|alert\(/i);
  });

  it('resolves image urls against the page and reports them for download', () => {
    expect(parsed.images).toEqual(['https://arxiv.org/html/x1.png']);
    expect(find('S1.F1').html).toContain('src="https://arxiv.org/html/x1.png"');
  });

  it('does not translate formulas, figures or references', () => {
    for (const id of ['S1.E1', 'S1.F1', 'bib.bib1']) expect(find(id).masked).toBeUndefined();
    expect(find('S1.F1.cap').masked).toContain('Overview.');
  });
});
