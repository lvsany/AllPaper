import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, FileText, Languages, ListTree, LoaderCircle, MessageSquare, NotebookPen, PanelRightClose, PanelRightOpen, Highlighter, Sparkles } from 'lucide-react';
import { TRANSLATABLE } from '../../core/arxiv-html';
import { excerptMarkdown, type CitationRef } from '../../core/note-markdown';
import type { Annotation, Paper, PaperBundle, Paragraph } from '../../shared/types';
import { AssistantPanel, type PendingQuestion, type QuickAction } from '../AssistantPanel';
import { NoteEditor } from '../notes/NoteEditor';
import { appendToNote } from '../notes/noteBus';
import { ProjectPicker } from '../notes/ProjectPicker';
import { useWorkspace } from '../workspace';
import { linearTextOf, locate, selectionPortions, type Highlight, type Portion } from '../lib/dom';
import { AnnotationsPanel } from './AnnotationsPanel';
import { Block, type DisplayMode } from './Block';
import { blockHtml, translationText } from './html';
import { SelectionBar, type SelectionRect } from './SelectionBar';

interface Props {
  paper: Paper;
  /** Annotation id or `P<n>` paragraph reference to jump to on open. */
  anchor?: string;
  onBack(): void;
  onOpenPaper(paper: Paper, anchor?: string): void;
}

type Tab = 'notes' | 'annotations' | 'assistant';
const SOURCE_LABEL: Record<string, string> = { 'arxiv-html': 'arXiv HTML', ar5iv: 'ar5iv HTML', pdf: 'PDF 文字层', none: '无正文' };
const read = <T extends string>(key: string, fallback: T): T => { try { return (localStorage.getItem(key) as T) || fallback; } catch { return fallback; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } };

export function ReaderView({ paper, anchor, onBack, onOpenPaper }: Props) {
  const ws = useWorkspace();
  const [bundle, setBundle] = useState<PaperBundle>();
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [mode, setMode] = useState<DisplayMode>(() => read<DisplayMode>('allpaper.readerMode', 'both'));
  const [view, setView] = useState<'reader' | 'pdf'>('reader');
  const [fontSize, setFontSize] = useState(() => Number(read('allpaper.readerFont', '17')));
  const [panelOpen, setPanelOpen] = useState(true);
  const [tocOpen, setTocOpen] = useState(true);
  const [tab, setTab] = useState<Tab>('notes');
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string>();
  const [selection, setSelection] = useState<{ portions: Portion[]; rect: SelectionRect }>();
  const [activeAnnotation, setActiveAnnotation] = useState<string>();
  const [question, setQuestion] = useState<PendingQuestion>();
  const [activeHeading, setActiveHeading] = useState<string>();
  const [refCard, setRefCard] = useState<{ text: string; arxivId?: string; top: number; left: number }>();

  const scroller = useRef<HTMLDivElement>(null);
  const article = useRef<HTMLElement>(null);
  const translationsRef = useRef(translations);
  translationsRef.current = translations;
  const inflight = useRef(new Set<string>());
  const visible = useRef(new Set<string>());
  const flushTimer = useRef<number | undefined>(undefined);
  const questionId = useRef(0);

  const aiReady = ws.ai.configured;
  const paragraphs = bundle?.paragraphs ?? [];
  const assetBase = bundle?.assetBase ?? '';
  const byId = useMemo(() => new Map(paragraphs.map((p) => [p.id, p])), [paragraphs]);
  const byOrder = useMemo(() => new Map(paragraphs.map((p) => [p.order, p])), [paragraphs]);
  const translatableIds = useMemo(() => paragraphs.filter((p) => TRANSLATABLE.has(p.type) && p.text).map((p) => p.id), [paragraphs]);
  const translatedCount = translatableIds.filter((id) => translations[id]).length;

  // ---- loading ---------------------------------------------------------------
  useEffect(() => {
    let alive = true;
    setBundle(undefined); setTranslations({}); setAnnotations([]); setPending(new Set()); setFailed(new Set());
    inflight.current.clear(); visible.current.clear();
    void Promise.all([window.allPaper.papers.get(paper.id), window.allPaper.papers.translations(paper.id), window.allPaper.papers.annotations(paper.id)])
      .then(([b, t, a]) => { if (alive) { setBundle(b); setTranslations(t); setAnnotations(a); if (!b?.paragraphs.length && b?.pdfUrl) setView('pdf'); } });
    return () => { alive = false; };
  }, [paper.id]);

  useEffect(() => window.allPaper.papers.onTranslation((event) => {
    if (event.paperId !== paper.id) return;
    inflight.current.delete(event.paragraphId);
    setTranslations((current) => ({ ...current, [event.paragraphId]: event.zh }));
    setPending((current) => { const next = new Set(current); next.delete(event.paragraphId); return next; });
  }), [paper.id]);

  // ---- scrolling helpers --------------------------------------------------------
  const scrollToBlock = useCallback((id: string, flash = true) => {
    const el = scroller.current?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (flash) { el.classList.add('rd-flash'); window.setTimeout(() => el.classList.remove('rd-flash'), 1800); }
  }, []);

  const focusAnnotation = useCallback((annotation: Annotation) => {
    setActiveAnnotation(annotation.id);
    if (annotation.paragraphId) scrollToBlock(annotation.paragraphId);
  }, [scrollToBlock]);

  const focusAnchor = useCallback((value?: string) => {
    if (!value) return;
    const order = value.match(/^P(\d+)$/);
    if (order) { const target = byOrder.get(Number(order[1])); if (target) scrollToBlock(target.id); return; }
    const found = annotations.find((a) => a.id === value);
    if (found) { setView('reader'); setTab('annotations'); setPanelOpen(true); focusAnnotation(found); }
  }, [annotations, byOrder, focusAnnotation, scrollToBlock]);

  const initialJump = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!bundle) return;
    const target = anchor ?? undefined;
    const key = `${paper.id}:${target ?? ''}`;
    if (initialJump.current === key) return;
    initialJump.current = key;
    const timer = window.setTimeout(() => {
      if (target) focusAnchor(target);
      else if (paper.lastPosition && byId.has(paper.lastPosition)) scrollToBlock(paper.lastPosition, false);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [bundle, anchor, paper.id, paper.lastPosition, byId, focusAnchor, scrollToBlock]);

  // ---- translation --------------------------------------------------------------
  const requestTranslation = useCallback(async (ids: string[], force = false) => {
    if (!aiReady) return;
    const todo = ids.filter((id) => force || (!translationsRef.current[id] && !inflight.current.has(id)));
    if (!todo.length) return;
    todo.forEach((id) => inflight.current.add(id));
    setPending((current) => new Set([...current, ...todo]));
    setFailed((current) => { const next = new Set(current); todo.forEach((id) => next.delete(id)); return next; });
    setNotice(undefined);
    for (let i = 0; i < todo.length; i += 12) {
      const chunk = todo.slice(i, i + 12);
      let result;
      try { result = await window.allPaper.papers.translate(paper.id, chunk, force); }
      catch (error) { result = { translations: {}, failed: chunk, error: error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error) }; }
      chunk.forEach((id) => inflight.current.delete(id));
      setPending((current) => { const next = new Set(current); chunk.forEach((id) => next.delete(id)); return next; });
      if (result.failed.length) setFailed((current) => new Set([...current, ...result.failed]));
      if (result.error) { setNotice(`翻译失败：${result.error}`); break; }
    }
  }, [aiReady, paper.id]);

  const flushVisible = useCallback(() => {
    if (mode === 'original' || view !== 'reader') return;
    const ids = paragraphs.filter((p) => visible.current.has(p.id) && TRANSLATABLE.has(p.type) && p.text).map((p) => p.id);
    void requestTranslation(ids);
  }, [mode, view, paragraphs, requestTranslation]);

  useEffect(() => {
    const root = scroller.current;
    if (!root || !paragraphs.length || view !== 'reader') return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.pid;
        if (!id) continue;
        if (entry.isIntersecting) visible.current.add(id); else visible.current.delete(id);
      }
      window.clearTimeout(flushTimer.current);
      flushTimer.current = window.setTimeout(flushVisible, 250);
    }, { root, rootMargin: '1400px 0px' });
    root.querySelectorAll('[data-block]').forEach((el) => observer.observe(el));
    return () => { observer.disconnect(); window.clearTimeout(flushTimer.current); };
  }, [paragraphs, view, flushVisible]);

  useEffect(() => { flushVisible(); }, [flushVisible, aiReady]);

  const translateAll = () => { setMode((m) => m === 'original' ? 'both' : m); void requestTranslation(translatableIds); };
  const retranslate = useCallback((p: Paragraph) => { void requestTranslation([p.id], true); }, [requestTranslation]);

  // ---- reading position, table of contents --------------------------------------
  const onScroll = useCallback(() => {
    const root = scroller.current;
    if (!root) return;
    const top = root.getBoundingClientRect().top + 90;
    let current: string | undefined;
    let first: string | undefined;
    root.querySelectorAll<HTMLElement>('[data-block]').forEach((el) => {
      if (first === undefined && el.getBoundingClientRect().bottom > top) first = el.dataset.pid;
      if (el.classList.contains('rd-block-heading') && el.getBoundingClientRect().top <= top) current = el.dataset.pid;
    });
    setActiveHeading(current);
    window.clearTimeout(positionTimer.current);
    positionTimer.current = window.setTimeout(() => {
      if (first) void window.allPaper.papers.update(paper.id, { lastPosition: first, ...(paper.readStatus === 'unread' ? { readStatus: 'reading' as const } : {}) });
    }, 1500);
  }, [paper.id, paper.readStatus]);
  const positionTimer = useRef<number | undefined>(undefined);

  const headings = useMemo(() => paragraphs.filter((p) => p.type === 'heading' && (p.level ?? 1) <= 2), [paragraphs]);

  // ---- annotations ---------------------------------------------------------------
  const { lost, highlightsByBlock } = useMemo(() => {
    const locations = new Map<string, [number, number]>();
    const lost = new Set<string>();
    const texts = new Map<string, string>();
    for (const annotation of annotations) {
      const p = annotation.paragraphId ? byId.get(annotation.paragraphId) : undefined;
      if (!p) { lost.add(annotation.id); continue; }
      if (!texts.has(p.id)) texts.set(p.id, linearTextOf(blockHtml(p, assetBase)));
      const found = locate(annotation, texts.get(p.id)!);
      if (found) locations.set(annotation.id, found); else lost.add(annotation.id);
    }
    const highlightsByBlock = new Map<string, { list: Highlight[]; key: string }>();
    for (const annotation of annotations) {
      const found = locations.get(annotation.id);
      if (!found || !annotation.paragraphId) continue;
      const entry = highlightsByBlock.get(annotation.paragraphId) ?? { list: [], key: '' };
      entry.list.push({ id: annotation.id, color: annotation.color, start: found[0], end: found[1], active: annotation.id === activeAnnotation });
      entry.key += `${annotation.id}:${annotation.color}:${found[0]}-${found[1]}:${annotation.id === activeAnnotation ? 1 : 0};`;
      highlightsByBlock.set(annotation.paragraphId, entry);
    }
    return { lost, highlightsByBlock };
  }, [annotations, byId, assetBase, activeAnnotation]);

  const createAnnotations = async (portions: Portion[], color: string, comment?: string): Promise<Annotation[]> => {
    const created: Annotation[] = [];
    for (const portion of portions) {
      created.push(await window.allPaper.papers.addAnnotation(paper.id, {
        color, comment, quotedText: portion.quotedText, prefix: portion.prefix, suffix: portion.suffix,
        paragraphId: portion.paragraphId, offsets: [portion.start, portion.end]
      }));
    }
    setAnnotations((current) => [...current, ...created]);
    return created;
  };

  const clearSelection = () => { window.getSelection()?.removeAllRanges(); setSelection(undefined); };

  const excerpt = async (portions: Portion[], existing?: Annotation[]) => {
    const project = ws.currentProject;
    if (!project) { setPanelOpen(true); setTab('notes'); setNotice('先创建一个项目，笔记会保存在项目里。'); return; }
    const made = existing ?? await createAnnotations(portions, 'yellow');
    let translation: string | undefined;
    if (portions.length === 1) {
      const p = byId.get(portions[0].paragraphId);
      const zh = p ? translationsRef.current[p.id] : undefined;
      if (p && zh && portions[0].quotedText.length >= p.text.length * 0.8) translation = translationText(zh, p);
    }
    await appendToNote(project.id, excerptMarkdown({ quote: portions.map((x) => x.quotedText), translation, key: paper.citekey, anchor: made[0]?.id }));
    setPanelOpen(true);
    setTab('notes');
  };

  const wholeParagraph = (p: Paragraph): Portion => {
    const text = linearTextOf(blockHtml(p, assetBase));
    return { paragraphId: p.id, start: 0, end: text.length, quotedText: text, prefix: '', suffix: '' };
  };

  const ask = (text: string, selectionText?: string, mode: 'chat' | 'explain' = 'chat') => {
    questionId.current += 1;
    setQuestion({ id: questionId.current, text, mode, selection: selectionText });
    setPanelOpen(true);
    setTab('assistant');
  };

  // ---- selection and clicks --------------------------------------------------------
  const readSelection = useCallback(() => {
    const sel = window.getSelection();
    const root = article.current;
    if (!sel || sel.isCollapsed || !sel.rangeCount || !root) { setSelection(undefined); return; }
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) { setSelection(undefined); return; }
    const portions = selectionPortions(range, root);
    if (!portions.length) { setSelection(undefined); return; }
    const box = range.getBoundingClientRect();
    setSelection({ portions, rect: { top: box.top, bottom: box.bottom, left: box.left, width: box.width } });
  }, []);

  const onArticleClick = (event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    const mark = target.closest<HTMLElement>('mark[data-ann]');
    if (mark && window.getSelection()?.isCollapsed) { setActiveAnnotation(mark.dataset.ann); setPanelOpen(true); setTab('annotations'); }
    const link = target.closest<HTMLAnchorElement>('a[href]');
    if (!link) { setRefCard(undefined); return; }
    const href = link.getAttribute('href') ?? '';
    event.preventDefault();
    if (/^https?:/i.test(href)) { void window.allPaper.library.openExternal(href); return; }
    if (!href.startsWith('#')) return;
    const id = decodeURIComponent(href.slice(1));
    const entry = byId.get(id);
    if (entry?.type === 'references') {
      const box = link.getBoundingClientRect();
      setRefCard({ text: entry.text.replace(/Cited by:.*$/, '').trim(), arxivId: entry.text.match(/\b(\d{4}\.\d{4,5})(?:v\d+)?\b/)?.[1], top: box.bottom + 8, left: Math.max(12, Math.min(window.innerWidth - 420, box.left)) });
      return;
    }
    scrollToBlock(id);
  };

  const openCitation = (ref: CitationRef) => {
    if (ref.key === paper.citekey) { focusAnchor(ref.anchor); return; }
    const target = ws.paperByKey(ref.key);
    if (target) onOpenPaper(target, ref.anchor);
    else setNotice(`文献库中没有 ${ref.key}（可能已被删除或改了引用键）。`);
  };

  const actions: QuickAction[] = [
    { label: '速览本文', prompt: '请用中文为这篇论文生成一张结构化速览卡：研究问题、核心方法、主要结论、实验设置（基准、基线、指标、所用模型）、局限。每一条都标注出处。' },
    { label: '实验设置', prompt: '这篇论文的实验是怎么设计的？列出基准/数据集、基线、评测指标、所用模型和关键超参数，并标注出处。' },
    { label: '与我的项目', prompt: '结合我的项目笔记，这篇论文对我的研究有什么可借鉴之处？有哪些结论与我的想法冲突？', mode: 'chat' },
    { label: '局限与可做的点', prompt: '这篇论文有哪些局限？基于这些局限，有哪些值得做的后续工作？论文中没有依据的请标“（推测）”。', mode: 'ideas' }
  ];

  const hasProject = Boolean(ws.currentProject);

  return (
    <section className="rd" style={{ ['--rd-font' as string]: `${fontSize}px` }}>
      <header className="rd-top">
        <button className="icon-button" title="返回" onClick={onBack}><ArrowLeft size={18} /></button>
        <div className="rd-doc">
          <h1 title={paper.title}>{paper.title}</h1>
          <span>{paper.authors.slice(0, 3).map((a) => a.family).join(', ')}{paper.authors.length > 3 ? ' 等' : ''}{paper.year ? ` · ${paper.year}` : ''} · 正文来源：{SOURCE_LABEL[paper.contentSource] ?? paper.contentSource}</span>
        </div>
        {view === 'reader' && (
          <>
            <div className="seg" role="group" aria-label="显示模式">
              {(['both', 'original', 'translation'] as const).map((value) => (
                <button key={value} className={mode === value ? 'on' : ''} onClick={() => { setMode(value); write('allpaper.readerMode', value); }}>{{ both: '双语', original: '原文', translation: '译文' }[value]}</button>
              ))}
            </div>
            <button className="secondary tight" disabled={!aiReady || !translatableIds.length} title={aiReady ? '' : '需要先配置模型服务'} onClick={translateAll}>
              {pending.size ? <LoaderCircle size={14} className="spin" /> : <Languages size={14} />}
              {pending.size ? `翻译中 ${translatedCount}/${translatableIds.length}` : translatedCount === translatableIds.length && translatableIds.length ? '已全部翻译' : `翻译全文 ${translatedCount}/${translatableIds.length}`}
            </button>
            <div className="size-ctl"><button onClick={() => { const v = Math.max(14, fontSize - 1); setFontSize(v); write('allpaper.readerFont', String(v)); }}>A−</button><button onClick={() => { const v = Math.min(22, fontSize + 1); setFontSize(v); write('allpaper.readerFont', String(v)); }}>A+</button></div>
          </>
        )}
        {bundle?.pdfUrl && paragraphs.length > 0 && <button className="secondary tight" onClick={() => setView(view === 'pdf' ? 'reader' : 'pdf')}><FileText size={14} /> {view === 'pdf' ? '阅读视图' : '原版 PDF'}</button>}
        <button className="icon-button" title="目录" onClick={() => setTocOpen(!tocOpen)}><ListTree size={17} /></button>
        <button className="icon-button" title={panelOpen ? '收起侧栏' : '展开侧栏'} onClick={() => setPanelOpen(!panelOpen)}>{panelOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}</button>
      </header>

      {!aiReady && view === 'reader' && (
        <div className="rd-banner">未配置模型服务，译文与助手暂不可用。<button className="text-button" onClick={ws.openSettings}>前往设置</button></div>
      )}
      {notice && <div className="rd-banner warn">{notice}<button className="text-button" onClick={() => setNotice(undefined)}>知道了</button></div>}

      <div className="rd-body">
        {tocOpen && view === 'reader' && (
          <nav className="rd-toc" aria-label="目录">
            {headings.map((h) => (
              <button key={h.id} className={`${activeHeading === h.id ? 'on' : ''} lvl-${h.level ?? 1}`} title={h.text} onClick={() => scrollToBlock(h.id, false)}>{h.text}</button>
            ))}
            {!headings.length && <p className="muted">没有章节标题</p>}
          </nav>
        )}

        {view === 'pdf' && bundle?.pdfUrl
          ? <embed className="rd-pdf" src={bundle.pdfUrl} type="application/pdf" />
          : (
            <div className="rd-scroll" ref={scroller} onScroll={onScroll}>
              {!bundle ? <div className="rd-empty"><LoaderCircle className="spin" /></div>
                : !paragraphs.length ? (
                  <div className="rd-empty">
                    <FileText size={30} />
                    <h2>这篇论文还没有可阅读的正文</h2>
                    <p>只入库了元数据。回到文献库选中它，点“获取全文”（会尝试 arXiv 和开放获取来源），或“选择本地 PDF”。</p>
                    {paper.url && <button className="secondary" onClick={() => void window.allPaper.library.openExternal(paper.url!)}>在浏览器中打开来源</button>}
                  </div>
                )
                : (
                  <article
                    ref={article} className={`rd-article tstyle-${ws.settings.translationStyle}`}
                    onMouseUp={() => window.setTimeout(readSelection, 0)} onKeyUp={(e) => { if (e.shiftKey) readSelection(); }}
                    onClick={onArticleClick}
                  >
                    {paragraphs.map((p) => {
                      const hl = highlightsByBlock.get(p.id);
                      return (
                        <Block
                          key={p.id} p={p} assetBase={assetBase} mode={mode} zh={translations[p.id]}
                          pending={pending.has(p.id)} failed={failed.has(p.id)} highlights={hl?.list ?? NO_HIGHLIGHTS} highlightKey={hl?.key ?? ''}
                          canTranslate={aiReady} onRetranslate={retranslate}
                          onExplain={(block) => ask('请解释这一段在讲什么，以及它在全文中的作用。', block.text, 'explain')}
                          onExcerpt={(block) => void excerpt([wholeParagraph(block)])}
                          onCopy={(text) => void navigator.clipboard.writeText(text)}
                        />
                      );
                    })}
                  </article>
                )}
            </div>
          )}

        {panelOpen && (
          <aside className="rd-side">
            <div className="rd-tabs" role="tablist">
              <button className={tab === 'notes' ? 'on' : ''} onClick={() => setTab('notes')}><NotebookPen size={14} /> 笔记</button>
              <button className={tab === 'annotations' ? 'on' : ''} onClick={() => setTab('annotations')}><Highlighter size={14} /> 批注{annotations.length ? ` ${annotations.length}` : ''}</button>
              <button className={tab === 'assistant' ? 'on' : ''} onClick={() => setTab('assistant')}><Sparkles size={14} /> 助手</button>
            </div>
            <div className="rd-tabbody">
              {tab === 'notes' && (
                <div className="rd-notes">
                  <ProjectPicker compact />
                  {ws.currentProject
                    ? <NoteEditor key={ws.currentProject.id} projectId={ws.currentProject.id} onOpenCitation={openCitation} />
                    : <div className="panel-empty"><p>每个项目只有一份笔记。创建项目后，选中正文点“摘录”，原文、译文和出处会直接加进来。</p></div>}
                </div>
              )}
              {tab === 'annotations' && (
                <AnnotationsPanel
                  annotations={annotations} lost={lost} activeId={activeAnnotation} hasProject={hasProject}
                  onFocus={focusAnnotation}
                  onExcerpt={(annotation) => {
                    const portion: Portion = { paragraphId: annotation.paragraphId ?? '', start: annotation.offsets?.[0] ?? 0, end: annotation.offsets?.[1] ?? 0, quotedText: annotation.quotedText, prefix: annotation.prefix, suffix: annotation.suffix };
                    void excerpt([portion], [annotation]);
                  }}
                  onDelete={(annotation) => { void window.allPaper.papers.deleteAnnotation(paper.id, annotation.id); setAnnotations((current) => current.filter((a) => a.id !== annotation.id)); }}
                  onChange={(annotation, patch) => { void window.allPaper.papers.updateAnnotation(paper.id, annotation.id, patch); setAnnotations((current) => current.map((a) => a.id === annotation.id ? { ...a, ...patch } : a)); }}
                />
              )}
              {tab === 'assistant' && (
                <AssistantPanel
                  scope={`paper:${paper.id}`} paperId={paper.id} citekey={paper.citekey} projectId={ws.currentProject?.id}
                  paragraphCount={Math.max(0, ...paragraphs.map((p) => p.order + 1))} actions={actions} pending={question}
                  onJump={(order) => { const target = byOrder.get(order); if (target) { setView('reader'); scrollToBlock(target.id); } }}
                  onInsert={ws.currentProject ? (markdown) => { void appendToNote(ws.currentProject!.id, markdown); setTab('notes'); } : undefined}
                />
              )}
            </div>
          </aside>
        )}
      </div>

      {selection && (
        <SelectionBar
          rect={selection.rect} aiReady={aiReady}
          onHighlight={(color) => { void createAnnotations(selection.portions, color).then((made) => setActiveAnnotation(made[0]?.id)); clearSelection(); }}
          onComment={(color, text) => { void createAnnotations(selection.portions, color, text).then((made) => { setActiveAnnotation(made[0]?.id); setPanelOpen(true); setTab('annotations'); }); clearSelection(); }}
          onExcerpt={() => { void excerpt(selection.portions); clearSelection(); }}
          onExplain={() => { ask('请解释这段内容。', selection.portions.map((x) => x.quotedText).join('\n'), 'explain'); clearSelection(); }}
          translate={() => window.allPaper.ai.translateText(selection.portions.map((x) => x.quotedText).join(' '))}
          onClose={clearSelection}
        />
      )}

      {refCard && (
        <div className="refcard" style={{ top: refCard.top, left: refCard.left }}>
          <p>{refCard.text}</p>
          {refCard.arxivId && (
            <button className="primary" onClick={async () => {
              try {
                setRefCard(undefined);
                setNotice(`正在入库 arXiv:${refCard.arxivId}…`);
                const result = await window.allPaper.papers.importArxiv(refCard.arxivId!);
                await ws.refreshPapers();
                setNotice(`已入库《${result.paper.title}》`);
              } catch (error) { setNotice(error instanceof Error ? error.message : '入库失败'); }
            }}><MessageSquare size={13} /> 入库这篇</button>
          )}
        </div>
      )}
    </section>
  );
}

const NO_HIGHLIGHTS: Highlight[] = [];
