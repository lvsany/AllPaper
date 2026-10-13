import { extractDoi, parseArxivAbsPage, parseArxivAtom, parseArxivFeed, parseArxivId, type ArxivMetadata, type ArxivRef } from '../core/arxiv-id';
import { arxivApi } from './arxiv-api';
import { isSameWork, type WorkLike } from '../core/bib-resolve';
import { looksLikeLatexml } from '../core/arxiv-html';

export interface ArxivDocument {
  meta: ArxivMetadata;
  html?: { source: 'arxiv-html' | 'ar5iv'; text: string; url: string };
  pdf?: Buffer;
}

const USER_AGENT = 'AllPaper/0.1 (personal research tool)';
const MAX_PDF_BYTES = 80 * 1024 * 1024;

/** fetch that waits and retries a couple of times when arxiv.org answers 429/503. */
async function politeFetch(url: string, timeoutMs: number): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    if ((response.status !== 429 && response.status !== 503) || attempt >= 2) return response;
    const wait = Math.min(30, Number(response.headers.get('retry-after')) || 4 * (attempt + 1));
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
  }
}

async function getText(url: string, timeoutMs = 40_000): Promise<{ ok: boolean; status: number; text: string; url: string }> {
  const response = await politeFetch(url, timeoutMs);
  return { ok: response.ok, status: response.status, text: response.ok ? await response.text() : '', url: response.url };
}

/**
 * The export API is rate limited per IP. It goes through a throttled, retrying queue; if it still
 * refuses, the abs page (a different endpoint) carries the same metadata.
 */
async function fetchMetadata(id: string, onProgress?: (message: string) => void): Promise<ArxivMetadata> {
  let status = 0;
  try {
    const api = await arxivApi.get(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`, onProgress);
    status = api.status;
    const meta = api.ok ? parseArxivAtom(api.text) : undefined;
    if (meta) return meta;
    if (api.ok) throw new Error(`arXiv 上找不到 ${id}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('arXiv 上找不到')) throw error;
  }
  onProgress?.('元数据接口不可用，改从论文页面读取…');
  try {
    const page = await getText(`https://arxiv.org/abs/${id}`, 25_000);
    const meta = page.ok ? parseArxivAbsPage(page.text) : undefined;
    if (meta) return meta;
  } catch { /* report below */ }
  throw new Error(status === 429 || status === 503
    ? 'arXiv 正在限流（429），已自动重试仍未成功。请等几分钟再试；这通常是短时间内请求太多造成的。'
    : `无法获取 arXiv 元数据${status ? `（${status}）` : '，请检查网络'}。`);
}

/** Resolves an arXiv id, link or (when it maps to an arXiv paper) DOI into metadata, HTML and PDF. */
export async function fetchArxivPaper(input: string, onProgress?: (message: string) => void): Promise<ArxivDocument> {
  const ref = parseArxivId(input);
  if (!ref) {
    const doi = extractDoi(input);
    throw new Error(doi ? '这个 DOI 不是 arXiv 论文；请使用搜索页入库其元数据。' : '无法识别的 arXiv 编号或链接。');
  }
  const idWithVersion = `${ref.id}${ref.version ?? ''}`;
  onProgress?.('正在获取元数据…');
  const meta = await fetchMetadata(ref.id, onProgress);
  const version = ref.version ?? meta.version;
  const pinned = `${ref.id}${version ?? ''}`;

  onProgress?.('正在获取 HTML 正文…');
  let html: ArxivDocument['html'];
  for (const [source, url] of [['arxiv-html', `https://arxiv.org/html/${pinned || idWithVersion}`], ['ar5iv', `https://ar5iv.labs.arxiv.org/html/${ref.id}`]] as const) {
    try {
      const page = await getText(url);
      if (page.ok && looksLikeLatexml(page.text)) { html = { source, text: page.text, url: page.url }; break; }
    } catch { /* try the next source */ }
  }

  onProgress?.('正在下载 PDF…');
  let pdf: Buffer | undefined;
  try {
    const response = await politeFetch(`https://arxiv.org/pdf/${pinned}`, 90_000);
    if (response.ok && /pdf/i.test(response.headers.get('content-type') ?? '')) {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length <= MAX_PDF_BYTES && bytes.subarray(0, 5).toString() === '%PDF-') pdf = bytes;
    }
  } catch { /* the HTML version is enough to read */ }
  return { meta: { ...meta, version }, html, pdf };
}

/** Looks an arXiv paper up by title; only an unambiguous match is returned. */
export async function findArxivByTitle(work: WorkLike): Promise<ArxivRef | undefined> {
  const phrase = work.title.replace(/["“”]/g, ' ').replace(/\s+/g, ' ').trim();
  if (phrase.length < 12) return undefined;
  const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(`ti:"${phrase}"`)}&max_results=5`;
  const page = await arxivApi.get(url);
  if (!page.ok) return undefined;
  const hit = parseArxivFeed(page.text).find((candidate) => isSameWork(work, candidate));
  return hit ? { id: hit.id, version: undefined } : undefined;
}

async function downloadPdf(url: string): Promise<Buffer | undefined> {
  try {
    const response = await fetch(url, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(60_000) });
    if (!response.ok) return undefined;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length <= MAX_PDF_BYTES && bytes.subarray(0, 5).toString() === '%PDF-' ? bytes : undefined;
  } catch { return undefined; }
}

/** Open-access PDF for a DOI via OpenAlex; publisher paywalls simply yield nothing. */
export async function findOpenAccessPdf(doi: string): Promise<{ pdf: Buffer; from: string } | undefined> {
  try {
    const response = await fetch(`https://api.openalex.org/works/doi:${encodeURIComponent(doi)}`, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return undefined;
    const work = await response.json() as { best_oa_location?: { pdf_url?: string }; open_access?: { oa_url?: string } };
    const url = work.best_oa_location?.pdf_url ?? work.open_access?.oa_url;
    const pdf = url ? await downloadPdf(url) : undefined;
    return pdf && url ? { pdf, from: new URL(url).hostname } : undefined;
  } catch { return undefined; }
}
