import { mergeSearchResults, type SearchPaper } from '../core/deduplicate';
import { splitName } from '../core/arxiv-id';

export interface AcademicAdapter { name: string; search(query: string): Promise<SearchPaper[]> }

const UA = { 'user-agent': 'AllPaper/0.1 (personal research tool)' };
const get = async (url: string, json = true) => {
  const response = await fetch(url, { headers: UA, signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error(`${response.status}`);
  return json ? response.json() as Promise<any> : response.text();
};
const decode = (v: string) => v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');

export class ArxivAdapter implements AcademicAdapter {
  name = 'arXiv';
  async search(query: string): Promise<SearchPaper[]> {
    const terms = query.split(/\s+/).map((t) => t.replace(/[^\p{L}\p{N}-]/gu, '')).filter((t) => t.length > 1);
    const run = async (joiner: 'AND' | 'OR') => {
      const expression = terms.map((t) => `all:${t}`).join(` ${joiner} `);
      const xml = await get(`https://export.arxiv.org/api/query?search_query=${encodeURIComponent(expression)}&start=0&max_results=15&sortBy=relevance`, false) as string;
      return this.parse(xml);
    };
    const strict = terms.length ? await run('AND') : [];
    return strict.length >= 5 || terms.length < 2 ? strict : [...strict, ...await run('OR')];
  }

  private parse(xml: string): SearchPaper[] {
    return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => {
      const e = m[1];
      const take = (tag: string) => { const v = e.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1]; return v === undefined ? undefined : decode(v.replace(/\s+/g, ' ').trim()); };
      const url = take('id') ?? '';
      const id = url.split('/abs/')[1]?.replace(/v\d+$/, '') ?? '';
      return {
        source: this.name, sourceId: id, title: take('title') ?? '', abstract: take('summary') ?? '', arxivId: id, url,
        authors: [...e.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((a) => splitName(decode(a[1]))),
        year: Number((take('published') ?? '').slice(0, 4)) || undefined, venue: 'arXiv', openAccess: true,
        categories: [...e.matchAll(/<category[^>]*term="([^"]+)"/g)].map((x) => x[1]), pdfUrl: url.replace('/abs/', '/pdf/')
      } satisfies SearchPaper;
    }).filter((p) => p.title && p.arxivId);
  }
}

export class SemanticScholarAdapter implements AcademicAdapter {
  name = 'Semantic Scholar';
  async search(query: string): Promise<SearchPaper[]> {
    const j = await get(`https://api.semanticscholar.org/graph/v1/paper/search?limit=15&fields=title,authors,year,venue,abstract,externalIds,citationCount,openAccessPdf,url&query=${encodeURIComponent(query)}`);
    return (j.data ?? []).filter((x: any) => x.title).map((x: any) => ({
      source: this.name, sourceId: x.paperId, title: x.title, authors: (x.authors ?? []).map((a: any) => splitName(a.name ?? 'Unknown')),
      year: x.year ?? undefined, venue: x.venue || undefined, abstract: x.abstract ?? undefined, doi: x.externalIds?.DOI, arxivId: x.externalIds?.ArXiv,
      url: x.url, pdfUrl: x.openAccessPdf?.url, citationCount: x.citationCount, openAccess: Boolean(x.openAccessPdf?.url)
    }));
  }
}

export class OpenAlexAdapter implements AcademicAdapter {
  name = 'OpenAlex';
  async search(query: string): Promise<SearchPaper[]> {
    const j = await get(`https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=15`);
    return (j.results ?? []).filter((x: any) => x.title).map((x: any) => ({
      source: this.name, sourceId: x.id, title: x.title, authors: (x.authorships ?? []).map((a: any) => splitName(a.author?.display_name ?? 'Unknown')),
      year: x.publication_year ?? undefined, venue: x.primary_location?.source?.display_name ?? undefined,
      doi: x.doi?.replace('https://doi.org/', ''), url: x.doi ?? x.id, citationCount: x.cited_by_count, openAccess: x.open_access?.is_oa,
      abstract: x.abstract_inverted_index ? invertAbstract(x.abstract_inverted_index) : undefined
    }));
  }
}

function invertAbstract(index: Record<string, number[]>): string {
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) for (const position of positions) words[position] = word;
  return words.filter(Boolean).join(' ');
}

export class DblpAdapter implements AcademicAdapter {
  name = 'DBLP';
  async search(query: string): Promise<SearchPaper[]> {
    const j = await get(`https://dblp.org/search/publ/api?q=${encodeURIComponent(query)}&format=json&h=15`);
    const raw = j.result?.hits?.hit;
    const hits = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return hits.map((h: any) => {
      const x = h.info;
      const authors = Array.isArray(x.authors?.author) ? x.authors.author : x.authors?.author ? [x.authors.author] : [];
      return {
        source: this.name, sourceId: x.key, title: String(x.title ?? '').replace(/\.$/, ''),
        authors: authors.map((a: any) => splitName(String(a.text ?? a).replace(/\s+\d{4}$/, ''))),
        year: Number(x.year) || undefined, venue: x.venue, doi: x.doi, url: x.ee ?? x.url
      } satisfies SearchPaper;
    }).filter((p: SearchPaper) => p.title);
  }
}

export interface SearchOutcome { results: SearchPaper[]; errors: string[] }

export async function searchAll(queries: string[], adapters: AcademicAdapter[] = [new ArxivAdapter(), new SemanticScholarAdapter(), new OpenAlexAdapter(), new DblpAdapter()]): Promise<SearchOutcome> {
  const jobs = adapters.flatMap((adapter) => queries.map((query) => adapter.search(query).then((results) => ({ adapter, results }))));
  const settled = await Promise.allSettled(jobs);
  const errors = new Set<string>();
  const records: SearchPaper[] = [];
  settled.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') { records.push(...outcome.value.results); return; }
    const reason = String(outcome.reason?.message ?? outcome.reason);
    const why = /^\d{3}$/.test(reason) ? `HTTP ${reason}${reason === '429' ? '，被限流' : ''}` : /JSON/.test(reason) ? '返回了非数据内容，可能被限流或拦截' : reason.slice(0, 40);
    errors.add(`${adapters[Math.floor(index / queries.length)].name} 暂不可用（${why}）`);
  });
  return { results: mergeSearchResults(records), errors: [...errors] };
}
