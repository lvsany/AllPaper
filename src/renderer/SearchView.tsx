import { useState } from 'react';
import { ExternalLink, LibraryBig, LoaderCircle, Search } from 'lucide-react';
import type { SearchPaper } from '../core/deduplicate';
import type { Paper } from '../shared/types';
import { useWorkspace } from './workspace';

export function SearchView({ onOpenPaper }: { onOpenPaper(paper: Paper): void }) {
  const ws = useWorkspace();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchPaper[]>([]);
  const [queries, setQueries] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [importing, setImporting] = useState<string>();
  const [message, setMessage] = useState('');

  const run = async () => {
    if (!query.trim() || loading) return;
    setLoading(true); setMessage(''); setErrors([]);
    try {
      const outcome = await window.allPaper.search.query(query.trim(), true);
      setResults(outcome.results); setQueries(outcome.queries); setErrors(outcome.errors); setSearched(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '检索失败');
    } finally { setLoading(false); }
  };

  const key = (paper: SearchPaper) => `${paper.source}-${paper.sourceId}`;
  const importOne = async (paper: SearchPaper) => {
    setImporting(key(paper));
    try {
      const result = paper.arxivId ? await window.allPaper.papers.importArxiv(paper.arxivId) : await window.allPaper.papers.importSearchRecord(paper);
      await ws.refreshPapers();
      setMessage(result.warnings[0] ?? `已入库《${result.paper.title}》`);
      setResults((items) => items.map((item) => key(item) === key(paper) ? { ...item, inLibrary: true } : item));
      if (!result.warnings.length || paper.arxivId) onOpenPaper(result.paper);
    } catch (error) {
      setMessage(error instanceof Error ? error.message.replace(/^Error invoking remote method \'[^\']+\': (Error: )?/, '') : '入库失败');
    } finally { setImporting(undefined); }
  };

  return (
    <section className="search-page">
      <header>
        <div className="eyebrow">arXiv · Semantic Scholar · OpenAlex · DBLP</div>
        <h1>搜索论文</h1>
        <p>输入关键词，或用中文/英文描述你想了解的方向。{ws.ai.configured ? '已配置模型，会先把描述改写成多条英文检索式。' : '配置模型服务后，描述会被改写成多条英文检索式。'}</p>
      </header>
      <div className="search-hero">
        <Search size={20} />
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void run(); }} placeholder="例如：LLM 多智能体协作在软件工程任务中的公平评测" />
        <button className="primary" onClick={() => void run()} disabled={loading || !query.trim()}>{loading ? <LoaderCircle size={15} className="spin" /> : null}{loading ? '检索中…' : '搜索'}</button>
      </div>
      {!!queries.length && queries.length > 1 && <div className="search-queries">实际检索：{queries.map((q) => <code key={q}>{q}</code>)}</div>}
      {/[\u4e00-\u9fff]/.test(query) && !ws.ai.configured && <div className="notice warn">中文描述需要配置模型服务后才能改写成英文检索式；现在直接用中文检索通常结果很少，可以先改用英文关键词。</div>}
      {!!errors.length && <div className="notice warn">{errors.join('；')}。其余来源的结果已列出。</div>}
      {message && <div className="notice">{message}<button onClick={() => setMessage('')}>×</button></div>}
      <div className="search-results">
        {results.map((paper) => (
          <article className="result-card" key={key(paper)}>
            <div className="result-top"><span>{paper.venue ?? paper.source} · {paper.year ?? '年份未知'}</span>{paper.openAccess && <span className="oa">开放获取</span>}</div>
            <h2>{paper.title}</h2>
            <p className="result-authors">{paper.authors.slice(0, 6).map((author) => [author.given, author.family].filter(Boolean).join(' ')).join(', ')}{paper.authors.length > 6 ? ' 等' : ''} · 引用 {paper.citationCount ?? 0}</p>
            <p>{paper.abstract ? paper.abstract.slice(0, 420) + (paper.abstract.length > 420 ? '…' : '') : '该来源未提供摘要。'}</p>
            <footer>
              <span>{(paper.categories ?? []).slice(0, 4).join(' · ')}{paper.arxivId ? ` · arXiv:${paper.arxivId}` : ''}</span>
              <div>
                {paper.url && <a href={paper.url} onClick={(e) => { e.preventDefault(); void window.allPaper.library.openExternal(paper.url!); }}><ExternalLink size={14} /> 来源</a>}
                <button className="secondary" onClick={() => void importOne(paper)} disabled={paper.inLibrary || importing === key(paper)}>
                  {importing === key(paper) ? <LoaderCircle size={14} className="spin" /> : <LibraryBig size={14} />}
                  {paper.inLibrary ? '已在文献库' : importing === key(paper) ? '获取全文中…' : paper.arxivId ? '入库并获取全文' : '仅入库元数据'}
                </button>
              </div>
            </footer>
          </article>
        ))}
        {!loading && searched && !results.length && <div className="search-placeholder"><Search size={30} /><p>没有找到结果。换几个英文关键词试试。</p></div>}
        {!loading && !searched && <div className="search-placeholder"><Search size={30} /><p>输入后回车开始搜索。也可以直接在文献库里粘贴 arXiv 链接入库。</p></div>}
      </div>
    </section>
  );
}
