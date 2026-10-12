import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Check, ChevronRight, Download, ExternalLink, FileText, FileUp, LibraryBig, Link2, LoaderCircle, Pencil, Search, Star, Upload } from 'lucide-react';
import { parseArxivId } from '../core/arxiv-id';
import type { SearchPaper } from '../core/deduplicate';
import type { ImportResult, Paper } from '../shared/types';
import { useWorkspace } from './workspace';

const cleanError = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : fallback;

interface Online { results: SearchPaper[]; queries: string[]; errors: string[]; query: string }

/** One place for the library and paper search: typing filters the library, Enter searches online. */
export function LibraryView({ onRead }: { onRead(paper: Paper): void }) {
  const ws = useWorkspace();
  const [papers, setPapers] = useState<Paper[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Paper | undefined>();
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [searching, setSearching] = useState(false);
  const [online, setOnline] = useState<Online>();
  const [importing, setImporting] = useState<string>();

  const load = async () => { setPapers(await window.allPaper.papers.list()); await ws.refreshPapers(); };
  useEffect(() => { void load(); }, []);
  useEffect(() => window.allPaper.papers.onImportProgress((progress) => {
    if (progress.total) setBusy(`获取全文 ${Math.min(progress.done ?? 0, progress.total)}/${progress.total}`);
    setStatusLine(progress.total && progress.message !== '完成' ? progress.message : progress.message === '完成' ? '' : progress.message);
  }), []);
  const [statusLine, setStatusLine] = useState('');

  const arxiv = useMemo(() => parseArxivId(query), [query]);
  const local = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || arxiv) return papers;
    return papers.filter((paper) => `${paper.title} ${paper.citekey} ${paper.authors.map((a) => a.family).join(' ')} ${paper.tags.join(' ')} ${paper.year ?? ''}`.toLowerCase().includes(q));
  }, [papers, query, arxiv]);

  const afterImport = async (paper: Paper, warning?: string) => {
    setNotice(warning ?? `已入库《${paper.title}》`);
    await load();
    setSelected(paper);
  };

  const importLink = async () => {
    if (!arxiv || busy) return;
    try {
      setBusy('正在获取论文…');
      const result = await window.allPaper.papers.importArxiv(query.trim());
      setQuery('');
      await afterImport(result.paper, result.warnings[0]);
    } catch (error) { setNotice(cleanError(error, '入库失败')); } finally { setBusy(''); }
  };

  const searchOnline = async () => {
    const text = query.trim();
    if (!text || searching) return;
    if (arxiv) { await importLink(); return; }
    setSearching(true);
    setNotice('');
    try {
      const outcome = await window.allPaper.search.query(text, true);
      setOnline({ ...outcome, query: text });
    } catch (error) { setNotice(cleanError(error, '检索失败')); } finally { setSearching(false); }
  };

  const key = (paper: SearchPaper) => `${paper.source}-${paper.sourceId}`;
  const importResult = async (paper: SearchPaper) => {
    setImporting(key(paper));
    try {
      const result = paper.arxivId ? await window.allPaper.papers.importArxiv(paper.arxivId) : await window.allPaper.papers.importSearchRecord(paper);
      setOnline((current) => current && { ...current, results: current.results.map((item) => key(item) === key(paper) ? { ...item, inLibrary: true } : item) });
      await afterImport(result.paper, result.warnings[0]);
    } catch (error) { setNotice(cleanError(error, '入库失败')); } finally { setImporting(undefined); }
  };

  const importPdf = async (path?: string) => {
    try {
      setBusy('正在导入…');
      const result = path ? await window.allPaper.papers.importDroppedPdf(path) : await window.allPaper.papers.importPdf();
      if (result) await afterImport(result.paper, result.warnings[0]);
    } catch (error) { setNotice(cleanError(error, '导入失败')); } finally { setBusy(''); }
  };
  const summarize = (results: ImportResult[]) => {
    const count = (status: ImportResult['status']) => results.filter((r) => r.status === status).length;
    const parts = [`共 ${results.length} 条`, `${count('full-text')} 篇获得 HTML 全文`];
    if (count('pdf-only')) parts.push(`${count('pdf-only')} 篇只有 PDF`);
    if (count('existing')) parts.push(`${count('existing')} 篇已在库中`);
    if (count('metadata-only')) parts.push(`${count('metadata-only')} 篇没有找到开放全文`);
    return `已导入：${parts.join('，')}。`;
  };
  const importBibtex = async () => {
    try {
      setBusy('正在导入…');
      const result = await window.allPaper.papers.importBibtex();
      if (result) { setNotice(summarize(result)); await load(); }
    } catch (error) { setNotice(cleanError(error, '导入失败')); } finally { setBusy(''); setStatusLine(''); }
  };
  const fetchMissing = async () => {
    try {
      setBusy('正在获取全文…');
      const { total, fetched } = await window.allPaper.papers.fetchMissingFullTexts();
      setNotice(total ? `补全完成：${total} 篇中获得了 ${fetched} 篇的全文。` : '所有文献都已有全文。');
      await load();
    } catch (error) { setNotice(cleanError(error, '获取失败')); } finally { setBusy(''); setStatusLine(''); }
  };
  const missing = papers.filter((paper) => paper.contentSource === 'none').length;

  const showOnline = online && query.trim() && !arxiv;
  const cjk = /[\u4e00-\u9fff]/.test(query);

  return (
    <section className="library-page" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
      event.preventDefault();
      const file = event.dataTransfer.files[0];
      if (file?.name.toLowerCase().endsWith('.pdf')) void importPdf(window.allPaper.papers.pathForFile(file));
    }}>
      <header className="library-header">
        <div><div className="eyebrow">文献库 · {papers.length} 篇</div><h1>文献库与搜索</h1></div>
        <div className="toolbar">
          {missing > 0 && <button className="secondary" onClick={() => void fetchMissing()} disabled={Boolean(busy)} title="对没有正文的文献，按 arXiv / 开放获取来源尝试获取全文"><LibraryBig size={15} /> 补全全文 ({missing})</button>}
          <button className="secondary" onClick={() => void importBibtex()} disabled={Boolean(busy)}><FileUp size={15} /> 导入 BibTeX</button>
          <button className="secondary" onClick={() => void window.allPaper.papers.exportBibtex()}><Download size={15} /> 导出 BibTeX</button>
          <button className="primary" onClick={() => void importPdf()} disabled={Boolean(busy)}>{busy ? <LoaderCircle size={15} className="spin" /> : <Upload size={15} />}{busy || '导入 PDF'}</button>
        </div>
      </header>

      <form className="lib-search" onSubmit={(event) => { event.preventDefault(); void searchOnline(); }}>
        {arxiv ? <Link2 size={17} /> : <Search size={17} />}
        <input
          autoFocus value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索文献库；回车搜索在线论文（arXiv / Semantic Scholar / OpenAlex / DBLP）；或粘贴 arXiv 链接直接入库"
        />
        {query && <button type="button" className="text-button" onClick={() => { setQuery(''); setOnline(undefined); }}>清除</button>}
        <button className="primary" type="submit" disabled={!query.trim() || searching || Boolean(busy)}>
          {searching || busy ? <LoaderCircle size={15} className="spin" /> : null}
          {arxiv ? '入库并获取全文' : searching ? '检索中…' : '在线搜索'}
        </button>
      </form>

      {busy && statusLine && <div className="notice"><LoaderCircle size={15} className="spin" />{busy}：{statusLine}</div>}
      {notice && <div className="notice"><Check size={15} />{notice}<button onClick={() => setNotice('')}>×</button></div>}

      <div className="library-content">
        <div className="paper-list">
          {arxiv && (
            <div className="lib-import-card">
              <Link2 size={16} />
              <span>识别到 <code>arXiv:{arxiv.id}{arxiv.version ?? ''}</code>。回车或点击右上角按钮，获取元数据、HTML 正文与 PDF 并入库。</span>
            </div>
          )}

          {!arxiv && local.length > 0 && query.trim() && <div className="lib-section">文献库中匹配 {local.length} 篇</div>}
          {!arxiv && local.map((paper) => (
            <article key={paper.id} className={selected?.id === paper.id ? 'paper-row selected' : 'paper-row'} onClick={() => setSelected(paper)}>
              <button className={paper.starred ? 'star active' : 'star'} onClick={(event) => { event.stopPropagation(); void window.allPaper.papers.update(paper.id, { starred: !paper.starred }).then(load); }}><Star size={16} /></button>
              <div className="paper-main">
                <h2>{paper.title}</h2>
                <p>{paper.authors.map((a) => a.given ? `${a.given} ${a.family}` : a.family).join(', ')} {paper.year ? `· ${paper.year}` : ''} {paper.venue ? `· ${paper.venue}` : ''}</p>
                <div className="chips"><span>{paper.citekey}</span>{paper.contentSource !== 'none' && <span className="green">全文</span>}{paper.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
              </div>
              <ChevronRight size={17} />
            </article>
          ))}

          {!arxiv && !local.length && !showOnline && (
            <div className="library-empty">
              <BookOpen size={30} />
              <h2>{papers.length ? '文献库里没有匹配的论文' : '从第一篇论文开始'}</h2>
              <p>{query.trim() ? '按回车在线搜索，或粘贴 arXiv 链接直接入库。' : '在上面粘贴 arXiv 链接，或输入关键词搜索；也可以导入 PDF / BibTeX，或把 PDF 拖到此处。'}</p>
            </div>
          )}

          {showOnline && (
            <>
              <div className="lib-section">
                在线结果 · {online.results.length} 条{online.queries.length > 1 ? ` · 检索式：${online.queries.join(' / ')}` : ''}
              </div>
              {online.errors.length > 0 && <div className="notice warn">{online.errors.join('；')}。其余来源的结果已列出。</div>}
              {cjk && !ws.ai.configured && <div className="notice warn">中文描述需要配置模型服务后才能改写成英文检索式；现在直接用中文检索结果通常很少，可以先改用英文关键词。</div>}
              {online.results.map((paper) => (
                <article className="result-card" key={key(paper)}>
                  <div className="result-top"><span>{paper.venue ?? paper.source} · {paper.year ?? '年份未知'}</span>{paper.openAccess && <span className="oa">开放获取</span>}</div>
                  <h2>{paper.title}</h2>
                  <p className="result-authors">{paper.authors.slice(0, 6).map((author) => [author.given, author.family].filter(Boolean).join(' ')).join(', ')}{paper.authors.length > 6 ? ' 等' : ''} · 引用 {paper.citationCount ?? 0}</p>
                  <p>{paper.abstract ? paper.abstract.slice(0, 360) + (paper.abstract.length > 360 ? '…' : '') : '该来源未提供摘要。'}</p>
                  <footer>
                    <span>{(paper.categories ?? []).slice(0, 4).join(' · ')}{paper.arxivId ? ` · arXiv:${paper.arxivId}` : ''}</span>
                    <div>
                      {paper.url && <a href={paper.url} onClick={(e) => { e.preventDefault(); void window.allPaper.library.openExternal(paper.url!); }}><ExternalLink size={14} /> 来源</a>}
                      <button className="secondary" onClick={() => void importResult(paper)} disabled={paper.inLibrary || importing === key(paper)}>
                        {importing === key(paper) ? <LoaderCircle size={14} className="spin" /> : <LibraryBig size={14} />}
                        {paper.inLibrary ? '已在文献库' : importing === key(paper) ? '获取全文中…' : paper.arxivId ? '入库并获取全文' : '仅入库元数据'}
                      </button>
                    </div>
                  </footer>
                </article>
              ))}
              {!online.results.length && <div className="library-empty"><Search size={28} /><p>在线没有找到结果。换几个英文关键词试试。</p></div>}
            </>
          )}
        </div>

        <aside className="paper-inspector">
          {selected
            ? <Inspector paper={selected} onChanged={async (paper) => { setSelected(paper); await load(); }} onRead={() => onRead(selected)} onBusy={(text) => { setBusy(text); if (!text) setStatusLine(''); }} onNotice={setNotice} />
            : <div className="inspector-empty">选择一篇文献查看和编辑元数据</div>}
        </aside>
      </div>
    </section>
  );
}

function Inspector({ paper, onChanged, onRead, onBusy, onNotice }: { paper: Paper; onChanged: (paper: Paper) => Promise<void>; onRead: () => void; onBusy: (text: string) => void; onNotice: (text: string) => void }) {
  const [working, setWorking] = useState(false);
  const run = async (label: string, action: () => Promise<ImportResult | undefined>) => {
    try {
      setWorking(true); onBusy(label);
      const result = await action();
      if (result) {
        onNotice(result.status === 'metadata-only' ? `没有找到这篇的开放全文：${result.warnings[0] ?? ''}` : result.status === 'pdf-only' ? '已获得 PDF 全文（阅读视图由 PDF 文字层生成）。' : '已获得全文。');
        await onChanged(result.paper);
      }
    } catch (error) { onNotice(cleanError(error, '获取失败')); } finally { setWorking(false); onBusy(''); }
  };
  const [edit, setEdit] = useState(false); const [title, setTitle] = useState(paper.title); const [citekey, setCitekey] = useState(paper.citekey); const [tags, setTags] = useState(paper.tags.join(', ')); const [error, setError] = useState('');
  useEffect(() => { setTitle(paper.title); setCitekey(paper.citekey); setTags(paper.tags.join(', ')); setEdit(false); }, [paper]);
  const save = async () => { try { let next = paper; if (citekey !== paper.citekey) next = await window.allPaper.papers.changeCitekey(paper.id, citekey); next = await window.allPaper.papers.update(paper.id, { title, tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean) }); await onChanged(next); setEdit(false); } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败'); } };
  return <>{edit ? <div className="metadata-form"><h2>编辑元数据</h2><label>标题<input value={title} onChange={(e) => setTitle(e.target.value)}/></label><label>引用键<input value={citekey} onChange={(e) => setCitekey(e.target.value)}/></label><label>标签（逗号分隔）<input value={tags} onChange={(e) => setTags(e.target.value)}/></label>{error && <p className="error-text">{error}</p>}<div className="row"><button className="secondary" onClick={() => setEdit(false)}>取消</button><button className="primary" onClick={() => void save()}>保存</button></div></div> : <div className="inspector"><div className="inspector-top"><span className="source-pill">{paper.contentSource === 'none' ? '缺全文' : `正文：${({'arxiv-html':'arXiv HTML',ar5iv:'ar5iv',pdf:'PDF 文字层'} as Record<string,string>)[paper.contentSource] ?? paper.contentSource}`}</span><button className="icon-button" title="编辑元数据" onClick={() => setEdit(true)}><Pencil size={15}/></button></div><h2>{paper.title}</h2><p className="authors">{paper.authors.map((author) => [author.given, author.family].filter(Boolean).join(' ')).join(', ')}</p><dl><dt>引用键</dt><dd><code>{paper.citekey}</code></dd><dt>状态</dt><dd>{paper.readStatus === 'unread' ? '未读' : paper.readStatus}</dd><dt>标签</dt><dd>{paper.tags.length ? paper.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>) : '—'}</dd>{paper.abstract && <><dt>摘要</dt><dd className="abstract">{paper.abstract}</dd></>}</dl>{paper.contentSource!=='none'?<button className="primary full" onClick={onRead}>打开阅读视图</button>:<div className="no-text"><p className="muted-note">这篇只有元数据，还没有正文。</p><button className="primary full" disabled={working} onClick={() => void run('获取全文', () => window.allPaper.papers.fetchFullText(paper.id))}>{working ? <LoaderCircle size={15} className="spin" /> : <LibraryBig size={15} />} 获取全文</button><button className="secondary full" disabled={working} onClick={() => void run('导入 PDF', () => window.allPaper.papers.attachPdf(paper.id))}><FileText size={15} /> 选择本地 PDF…</button></div>}</div>}</>;
}
