import { extractDoi, parseArxivAtom, parseArxivId, type ArxivMetadata } from '../core/arxiv-id';
import { looksLikeLatexml } from '../core/arxiv-html';

export interface ArxivDocument {
  meta: ArxivMetadata;
  html?: { source: 'arxiv-html' | 'ar5iv'; text: string; url: string };
  pdf?: Buffer;
}

const USER_AGENT = 'AllPaper/0.1 (personal research tool)';
const MAX_PDF_BYTES = 80 * 1024 * 1024;

async function getText(url: string, timeoutMs = 40_000): Promise<{ ok: boolean; status: number; text: string; url: string }> {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  return { ok: response.ok, status: response.status, text: response.ok ? await response.text() : '', url: response.url };
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
  const api = await getText(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(ref.id)}`).catch((error) => {
    throw new Error(`无法连接 arXiv：${error instanceof Error ? error.message : String(error)}`);
  });
  if (!api.ok) throw new Error(`arXiv 元数据请求失败（${api.status}）`);
  const meta = parseArxivAtom(api.text);
  if (!meta) throw new Error(`arXiv 上找不到 ${ref.id}`);
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
    const response = await fetch(`https://arxiv.org/pdf/${pinned}`, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(90_000) });
    if (response.ok && /pdf/i.test(response.headers.get('content-type') ?? '')) {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length <= MAX_PDF_BYTES && bytes.subarray(0, 5).toString() === '%PDF-') pdf = bytes;
    }
  } catch { /* the HTML version is enough to read */ }
  return { meta: { ...meta, version }, html, pdf };
}
