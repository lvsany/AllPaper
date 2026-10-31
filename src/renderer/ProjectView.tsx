import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileText, LockKeyhole, Plus, Redo2, RotateCw, Search, Sparkles, Trash2, Undo2, Unlock } from 'lucide-react';
import { beginTranslation, failTranslation, hash, receiveTranslation, splitPastedText, unlock, type DraftBlock } from '../core/draft';
import { columnText, documentFrom, mergeInto, pasteInto, pasteSegments, setText, splitAt, textOf, type Side } from '../core/draft-edit';
import { History } from '../core/history';
import { citationsIn, type CitationRef } from '../core/note-markdown';
import { relativeTime } from '../core/note-preview';
import type { DraftDocument, Project } from '../shared/projects';
import type { Paper } from '../shared/types';
import { AssistantPanel, type QuickAction } from './AssistantPanel';
import { NoteEditor } from './notes/NoteEditor';
import { appendToNote } from './notes/noteBus';
import { ProjectPicker } from './notes/ProjectPicker';
import { authorsShort, useWorkspace } from './workspace';

const cleanError = (error: unknown) =>
  error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error);

/** Notion / Feishu style: a list of notes on the left, the open note (editable title, body, paper draft) on the right. */
export function ProjectView({ onOpenPaper }: { onOpenPaper(paper: Paper, anchor?: string): void }) {
  const ws = useWorkspace();
  const project = ws.currentProject;
  const [tab, setTab] = useState<'note' | 'writing'>('note');
  const [side, setSide] = useState<'assistant' | 'papers'>('assistant');
  const [markdown, setMarkdown] = useState('');
  const [focusTitle, setFocusTitle] = useState(false);

  const cited = useMemo(() => {
    const seen = new Map<string, Paper>();
    for (const ref of citationsIn(markdown)) {
      const paper = ws.paperByKey(ref.key);
      if (paper) seen.set(paper.id, paper);
    }
    return [...seen.values()];
  }, [markdown, ws]);

  const openCitation = (ref: CitationRef) => {
    const paper = ws.paperByKey(ref.key);
    if (paper) onOpenPaper(paper, ref.anchor);
  };

  const newNote = async () => {
    await ws.createProject('无标题');
    setTab('note');
    setFocusTitle(true);
  };

  if (!ws.projects.length || !project) {
    return (
      <section className="project-empty">
        <FileText size={30} />
        <h1>新建第一篇笔记</h1>
        <p>每篇笔记属于一个研究项目：读论文时的摘录、点子、假设都写在这里，并保留到原文的出处；项目里还有对应的中英双栏论文草稿。</p>
        <ProjectPicker />
      </section>
    );
  }

  const actions: QuickAction[] = [
    { label: '整理成点子', mode: 'ideas', prompt: '读一遍我的笔记，把其中值得做的研究点子整理出来：每个点子写动机、核心假设、大致方法和预期贡献。' },
    { label: '设计预实验', mode: 'pilot', prompt: '针对我笔记中最有希望的点子，设计一份最小预实验方案。' },
    { label: '梳理论点', prompt: '梳理我笔记中的论点和证据：哪些结论有文献支持，哪些还缺证据，下一步该读什么？' }
  ];

  return (
    <section className="notes-app">
      <NotesList onNew={() => void newNote()} />
      <div className="note-main">
        <header className="note-head">
          <TitleField key={project.id} project={project} autoFocus={focusTitle} onFocused={() => setFocusTitle(false)} />
          <div className="seg">
            <button className={tab === 'note' ? 'on' : ''} onClick={() => setTab('note')}>笔记</button>
            <button className={tab === 'writing' ? 'on' : ''} onClick={() => setTab('writing')}>双栏写作</button>
          </div>
        </header>
        {tab === 'note' ? (
          <div className="proj-body">
            <div className="proj-note">
              <NoteEditor key={project.id} projectId={project.id} onOpenCitation={openCitation} onSaved={(md) => { setMarkdown(md); void ws.refreshProjects(); }} />
            </div>
            <aside className="proj-side">
              <div className="rd-tabs">
                <button className={side === 'assistant' ? 'on' : ''} onClick={() => setSide('assistant')}><Sparkles size={14} /> 助手</button>
                <button className={side === 'papers' ? 'on' : ''} onClick={() => setSide('papers')}>引用的文献 {cited.length || ''}</button>
              </div>
              <div className="rd-tabbody">
                {side === 'assistant'
                  ? <AssistantPanel scope={`project:${project.id}`} projectId={project.id} actions={actions} placeholder="助手会读取这份笔记。点“插入笔记”可把回答加到笔记末尾。" onInsert={(md) => void appendToNote(project.id, md)} />
                  : (
                    <div className="cited">
                      {cited.map((paper) => (
                        <button key={paper.id} onClick={() => onOpenPaper(paper)}><strong>{paper.title}</strong><small>{authorsShort(paper)} · {paper.citekey}</small></button>
                      ))}
                      {!cited.length && <div className="panel-empty"><p>笔记里还没有引用文献。读论文时选中文字点“摘录”，或在笔记中输入 @ 引用。</p></div>}
                    </div>
                  )}
              </div>
            </aside>
          </div>
        ) : <Writing key={project.id} projectId={project.id} />}
      </div>
    </section>
  );
}

function NotesList({ onNew }: { onNew(): void }) {
  const ws = useWorkspace();
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...ws.projects]
      .filter((p) => !q || `${p.name} ${p.preview ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt));
  }, [ws.projects, query]);

  const remove = async (project: Project) => {
    if (!window.confirm(`删除笔记「${project.name || '无标题'}」？\n\n笔记正文和这个项目的双栏写作草稿都会一起删除，且无法恢复。`)) return;
    try { await window.allPaper.projects.remove(project.id); await ws.refreshProjects(); } catch (error) { window.alert(cleanError(error)); }
  };

  return (
    <aside className="notes-list">
      <header>
        <strong>笔记</strong>
        <button className="icon-button" title="新建笔记" onClick={onNew}><Plus size={17} /></button>
      </header>
      <div className="memo-search"><Search size={14} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索标题和内容" /></div>
      <div className="notes-items">
        {shown.map((project) => (
          <div key={project.id} className={`note-item${project.id === ws.currentProject?.id ? ' on' : ''}`} role="button" tabIndex={0}
            onClick={() => ws.selectProject(project.id)} onKeyDown={(e) => { if (e.key === 'Enter') ws.selectProject(project.id); }}>
            <div className="note-item-top">
              <strong>{project.name || '无标题'}</strong>
              <button className="icon-button danger" title="删除" aria-label={`删除 ${project.name}`} onClick={(e) => { e.stopPropagation(); void remove(project); }}><Trash2 size={13} /></button>
            </div>
            <small>{project.preview || '空白笔记'}</small>
            <em>{relativeTime(project.updatedAt ?? project.createdAt)}</em>
          </div>
        ))}
        {!shown.length && <p className="muted pad">没有匹配的笔记。</p>}
      </div>
    </aside>
  );
}

/** The note's title; editing it renames the note. */
function TitleField({ project, autoFocus, onFocused }: { project: Project; autoFocus: boolean; onFocused(): void }) {
  const ws = useWorkspace();
  const [title, setTitle] = useState(project.name);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => { setTitle(project.name); }, [project.name]);
  useEffect(() => {
    if (autoFocus) { input.current?.focus(); input.current?.select(); onFocused(); }
  }, [autoFocus, onFocused]);

  const save = useCallback(async (value: string) => {
    if (!value.trim() || value.trim() === project.name) return;
    try { await window.allPaper.projects.rename(project.id, value); await ws.refreshProjects(); } catch { /* keep the old title */ }
  }, [project.id, project.name, ws]);

  return (
    <div className="note-title-wrap">
      <input
        ref={input} className="note-title" value={title} placeholder="无标题" spellCheck={false}
        onChange={(e) => { setTitle(e.target.value); window.clearTimeout(timer.current); const v = e.target.value; timer.current = window.setTimeout(() => void save(v), 600); }}
        onBlur={() => { window.clearTimeout(timer.current); if (title.trim()) void save(title); else setTitle(project.name); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
      <span className="note-meta">最后编辑 {relativeTime(project.updatedAt ?? project.createdAt)}</span>
    </div>
  );
}

// ---- bilingual writing, laid out like a document ---------------------------------------------

const statusName: Record<string, string> = { synced: '已同步', translating: '翻译中', locked: '英文已手改（已锁定）', changed: '中文已变更，英文未更新', failed: '翻译失败', pending: '待翻译' };

function AutoText({ value, onChange, onKeyDown, onFocus, onPaste, placeholder, setRef, className }: {
  value: string; onChange(value: string): void; onKeyDown?(event: React.KeyboardEvent<HTMLTextAreaElement>): void; onFocus?(): void;
  onPaste?(event: React.ClipboardEvent<HTMLTextAreaElement>): void;
  placeholder?: string; setRef?(el: HTMLTextAreaElement | null): void; className?: string;
}) {
  return (
    <textarea
      ref={setRef} className={className} value={value} rows={1} placeholder={placeholder} spellCheck={false}
      onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} onFocus={onFocus} onPaste={onPaste}
    />
  );
}

interface Focus { id: string; side: Side; caret: number | 'end' }
interface Snapshot { blocks: DraftBlock[]; focus?: Focus }

const newId = () => crypto.randomUUID().slice(0, 8);
const mod = (event: React.KeyboardEvent) => event.metaKey || event.ctrlKey;

function Writing({ projectId }: { projectId: string }) {
  const { ai, settings, openSettings } = useWorkspace();
  const [draft, setDraft] = useState<DraftDocument>();
  const latest = useRef<DraftDocument | undefined>(undefined);
  const timers = useRef(new Map<string, number>());
  const saveTimer = useRef<number | undefined>(undefined);
  const fields = useRef(new Map<string, HTMLTextAreaElement>());
  const pendingFocus = useRef<Focus | undefined>(undefined);
  const history = useRef(new History<Snapshot>());
  const [activeId, setActiveId] = useState<string>();
  const [allSelected, setAllSelected] = useState<Side>();
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    let alive = true;
    void window.allPaper.projects.draft(projectId).then((loaded) => {
      if (!alive) return;
      // a document always has somewhere to type
      const doc = loaded.blocks.length ? loaded : { ...loaded, blocks: [newBlock(0)] };
      latest.current = doc;
      setDraft(doc);
    });
    return () => { alive = false; timers.current.forEach((t) => window.clearTimeout(t)); timers.current.clear(); };
  }, [projectId]);

  /** Replaces the blocks and saves shortly after. Not an undo step by itself; see `edit`. */
  const commit = useCallback((change: (doc: DraftDocument) => DraftDocument) => {
    if (!latest.current) return;
    const next = change(latest.current);
    next.blocks = next.blocks.map((block, order) => ({ ...block, order }));
    latest.current = next;
    setDraft(next);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void window.allPaper.projects.saveDraft(projectId, next), 500);
  }, [projectId]);

  /** Where the caret is now, so undo can put it back. */
  const currentFocus = (): Focus | undefined => {
    const el = document.activeElement as HTMLTextAreaElement | null;
    for (const [key, field] of fields.current) {
      if (field === el) { const [side, id] = key.split(':') as [Side, string]; return { id, side, caret: el.selectionStart }; }
    }
    return undefined;
  };

  /** A user edit: recorded for undo (typing in one place groups into one step), then applied. */
  const edit = useCallback((change: (doc: DraftDocument) => DraftDocument, key?: string) => {
    if (!latest.current) return;
    history.current.record({ blocks: latest.current.blocks, focus: currentFocus() }, key);
    commit(change);
  }, [commit]);

  /** Machine updates (translation status and results) are not undo steps. */
  const update = useCallback((id: string, change: (block: DraftBlock) => DraftBlock) =>
    commit((doc) => ({ ...doc, blocks: doc.blocks.map((block) => block.id === id ? change(block) : block) })), [commit]);

  const translate = useCallback(async (id: string) => {
    const doc = latest.current;
    const index = doc?.blocks.findIndex((b) => b.id === id) ?? -1;
    const block = doc?.blocks[index];
    if (!doc || !block || block.locked || !block.zhText.trim()) return;
    update(id, beginTranslation);
    try {
      const english = await window.allPaper.ai.translateWriting(block.zhText, {
        before: doc.blocks.slice(Math.max(0, index - 2), index).map((b) => b.zhText).join('\n'),
        after: doc.blocks.slice(index + 1, index + 3).map((b) => b.zhText).join('\n'),
        neighbourEnglish: doc.blocks[index - 1]?.enText
      });
      const sourceHash = hash(block.zhText);
      update(id, (current) => current.zhHash === sourceHash ? receiveTranslation(current, english) : { ...current, status: 'pending' });
      setMessage(undefined);
    } catch (error) {
      update(id, failTranslation);
      setMessage(cleanError(error));
    }
  }, [update]);

  const schedule = (id: string) => {
    window.clearTimeout(timers.current.get(id));
    if (!ai.configured) return;
    timers.current.set(id, window.setTimeout(() => void translate(id), settings.translationDelayMs));
  };
  const scheduleChanged = (blocks: DraftBlock[]) => blocks.forEach((b) => { if (!b.locked && b.status === 'pending') schedule(b.id); });

  // move the caret where the last structural edit asked for it
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const el = fields.current.get(`${target.side}:${target.id}`);
    if (!el) return;
    pendingFocus.current = undefined;
    el.focus();
    const at = target.caret === 'end' ? el.value.length : Math.min(target.caret, el.value.length);
    el.setSelectionRange(at, at);
  });

  const focus = (target: Focus) => { pendingFocus.current = target; setDraft({ ...latest.current! }); };

  const restore = (snapshot: Snapshot | undefined) => {
    if (!snapshot) return;
    pendingFocus.current = snapshot.focus ?? (snapshot.blocks[0] && { id: snapshot.blocks[0].id, side: 'zh', caret: 'end' });
    commit((doc) => ({ ...doc, blocks: snapshot.blocks }));
    setAllSelected(undefined);
  };
  const undo = () => latest.current && restore(history.current.undo({ blocks: latest.current.blocks, focus: currentFocus() }));
  const redo = () => latest.current && restore(history.current.redo({ blocks: latest.current.blocks, focus: currentFocus() }));

  const onType = (block: DraftBlock, side: Side, text: string) => {
    setAllSelected(undefined);
    edit((doc) => ({ ...doc, blocks: doc.blocks.map((b) => b.id === block.id ? setText(b, side, text) : b) }), `${side}:${block.id}`);
    if (side === 'zh') schedule(block.id);
  };

  const clearDocument = () => {
    const blank = newBlock(0);
    pendingFocus.current = { id: blank.id, side: 'zh', caret: 0 };
    edit((doc) => ({ ...doc, blocks: [blank] }));
    setAllSelected(undefined);
  };

  const onKey = (block: DraftBlock, side: Side, event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = event.currentTarget;
    const caret = el.selectionStart;
    const blocks = latest.current?.blocks ?? [];
    const index = blocks.findIndex((b) => b.id === block.id);
    const key = event.key.toLowerCase();

    // undo / redo for the whole document (the textarea's own undo cannot see block splits and merges)
    if (mod(event) && key === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
    if (event.ctrlKey && !event.metaKey && key === 'y') { event.preventDefault(); redo(); return; }

    // select all: the first press selects this paragraph, the next one the whole column
    if (mod(event) && key === 'a') {
      const whole = el.selectionStart === 0 && el.selectionEnd === el.value.length;
      if (whole || !el.value) { event.preventDefault(); setAllSelected(side); }
      return;
    }
    if (allSelected) {
      if (mod(event) && (key === 'c' || key === 'x')) {
        event.preventDefault();
        void navigator.clipboard.writeText(columnText(blocks, allSelected));
        if (key === 'x') clearDocument();
        return;
      }
      if (event.key === 'Backspace' || event.key === 'Delete') { event.preventDefault(); clearDocument(); return; }
      if (event.key !== 'Shift' && event.key !== 'Meta' && event.key !== 'Control' && event.key !== 'Alt') setAllSelected(undefined);
    }

    if (event.key === 'Enter' && mod(event) && side === 'zh') { event.preventDefault(); void translate(block.id); return; }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      const [first, second] = splitAt(block, side, caret, newId());
      pendingFocus.current = { id: second.id, side, caret: 0 };
      edit((doc) => ({ ...doc, blocks: doc.blocks.flatMap((b) => b.id === block.id ? [first, second] : [b]) }));
      scheduleChanged([first, second]);
    } else if (event.key === 'Backspace' && caret === 0 && el.selectionEnd === 0) {
      if (block.type === 'heading') { event.preventDefault(); edit((doc) => ({ ...doc, blocks: doc.blocks.map((b) => b.id === block.id ? { ...b, type: 'paragraph', level: undefined } : b) })); return; }
      if (index > 0) {
        event.preventDefault();
        const merged = mergeInto(blocks[index - 1], block, side);
        pendingFocus.current = { id: merged.block.id, side, caret: merged.caret };
        edit((doc) => ({ ...doc, blocks: doc.blocks.filter((b) => b.id !== block.id).map((b) => b.id === merged.block.id ? merged.block : b) }));
        scheduleChanged([merged.block]);
      }
    } else if (event.key === 'ArrowUp' && caret === 0 && index > 0) {
      event.preventDefault(); focus({ id: blocks[index - 1].id, side, caret: 'end' });
    } else if (event.key === 'ArrowDown' && caret === el.value.length && index < blocks.length - 1) {
      event.preventDefault(); focus({ id: blocks[index + 1].id, side, caret: 0 });
    }
  };

  /** Pasting several paragraphs makes one block per paragraph, in either column. */
  const onPaste = (id: string, side: Side, event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const block = latest.current?.blocks.find((b) => b.id === id);
    if (!block) return;
    const raw = event.clipboardData.getData('text/plain');
    if (allSelected) {
      const paragraphs = splitPastedText(raw);
      // select all, then paste: the pasted text replaces the document
      event.preventDefault();
      const blocks = documentFrom(side, paragraphs, newId);
      const last = blocks[blocks.length - 1];
      pendingFocus.current = { id: last.id, side, caret: 'end' };
      edit((doc) => ({ ...doc, blocks }));
      setAllSelected(undefined);
      scheduleChanged(blocks);
      return;
    }
    const el = event.currentTarget;
    const result = pasteInto(block, side, el.selectionStart, el.selectionEnd, pasteSegments(raw), newId);
    if (!result) return; // one paragraph: let the textarea paste it as usual
    event.preventDefault();
    const last = result.blocks[result.blocks.length - 1];
    pendingFocus.current = { id: last.id, side, caret: result.caret };
    edit((doc) => ({ ...doc, blocks: doc.blocks.flatMap((b) => b.id === id ? result.blocks : [b]) }));
    scheduleChanged(result.blocks);
  };

  const setLevel = (level: 0 | 1 | 2 | 3) => {
    if (!activeId) return;
    edit((doc) => ({ ...doc, blocks: doc.blocks.map((b) => b.id !== activeId ? b : level ? { ...b, type: 'heading', level } : { ...b, type: 'paragraph', level: undefined }) }));
  };

  const remove = (id: string) => edit((doc) => ({ ...doc, blocks: doc.blocks.length > 1 ? doc.blocks.filter((b) => b.id !== id) : [newBlock(0)] }));

  if (!draft) return <div className="rd-empty">加载中…</div>;
  const waiting = draft.blocks.filter((b) => !b.locked && b.zhText.trim() && (b.status === 'pending' || b.status === 'failed'));
  const activeBlock = draft.blocks.find((b) => b.id === activeId);
  const fieldRef = (side: Side, id: string) => (el: HTMLTextAreaElement | null) => { if (el) fields.current.set(`${side}:${id}`, el); else fields.current.delete(`${side}:${id}`); };

  return (
    <div className="wdoc">
      <div className="wbar">
        <div className="wbar-group" role="group" aria-label="段落样式">
          {([[0, '正文'], [1, 'H1'], [2, 'H2'], [3, 'H3']] as const).map(([level, label]) => (
            <button key={level} className={(activeBlock?.type === 'heading' ? activeBlock.level ?? 1 : 0) === level ? 'on' : ''} disabled={!activeId} onClick={() => setLevel(level)}>{label}</button>
          ))}
        </div>
        <div className="wbar-group" role="group" aria-label="撤销">
          <button title="撤销（⌘Z / Ctrl+Z）" disabled={!history.current.canUndo} onClick={undo}><Undo2 size={14} /></button>
          <button title="重做（⌘⇧Z / Ctrl+Y）" disabled={!history.current.canRedo} onClick={redo}><Redo2 size={14} /></button>
        </div>
        <button className="secondary tight" onClick={() => void window.allPaper.projects.exportLatex(projectId)}><Download size={14} /> 导出 LaTeX</button>
        {!!waiting.length && ai.configured && <button className="secondary tight" onClick={() => waiting.forEach((b) => void translate(b.id))}><RotateCw size={14} /> 翻译 {waiting.length} 段待处理</button>}
        <span className="wbar-hint">中英两栏都像普通编辑器：Enter 新段落，粘贴多段自动分段，# 变标题；⌘/Ctrl+Z 撤销，⌘/Ctrl+A 连按两次全选整栏。停笔 {Math.round(settings.translationDelayMs / 100) / 10} 秒自动翻译，改英文会锁定该段。</span>
      </div>
      {!ai.configured && <div className="rd-banner">未配置模型服务，只能写中文；配置后点“翻译待处理段落”。<button className="text-button" onClick={openSettings}>前往设置</button></div>}
      {message && <div className="rd-banner warn">{message}<button className="text-button" onClick={() => setMessage(undefined)}>知道了</button></div>}
      {allSelected && <div className="rd-banner">已全选{allSelected === 'zh' ? '中文' : '英文'}栏：⌘/Ctrl+C 复制，⌘/Ctrl+X 剪切，Delete 清空，粘贴替换整篇，Esc 或点击取消。<button className="text-button" onClick={() => setAllSelected(undefined)}>取消</button></div>}

      <div className={`wpage${allSelected ? ` select-${allSelected}` : ''}`} onMouseDown={() => allSelected && setAllSelected(undefined)}>
        <div className="wcols"><span>中文</span><span>English</span></div>
        {draft.blocks.map((block) => {
          const headingClass = block.type === 'heading' ? ` h${block.level ?? 1}` : '';
          return (
            <div className={`wrow${block.id === activeId ? ' active' : ''}`} key={block.id}>
              <span className={`wdot st-${block.status}`} title={statusName[block.status] ?? block.status}>{block.locked && <LockKeyhole size={11} />}</span>
              {(['zh', 'en'] as const).map((side) => (
                <div key={side} className={`wcell${side === 'en' ? ' en' : ''}`} onClick={() => fields.current.get(`${side}:${block.id}`)?.focus()}>
                  <AutoText
                    className={`wtext${headingClass}`} value={textOf(block, side)} setRef={fieldRef(side, block.id)}
                    placeholder={side === 'zh' ? (block.id === draft.blocks[0].id && !block.zhText ? '开始写中文…' : '') : block.status === 'translating' ? '翻译中…' : ''}
                    onFocus={() => setActiveId(block.id)} onChange={(text) => onType(block, side, text)}
                    onKeyDown={(e) => onKey(block, side, e)} onPaste={(e) => onPaste(block.id, side, e)}
                  />
                  {side === 'en' && (
                    <div className="wactions">
                      {(block.locked || block.status === 'failed' || block.status === 'changed') && <button title={block.locked ? '解锁并重新翻译' : '重新翻译'} onClick={(e) => { e.stopPropagation(); if (block.locked) edit((doc) => ({ ...doc, blocks: doc.blocks.map((b) => b.id === block.id ? unlock(b) : b) })); if (ai.configured) void translate(block.id); }}>{block.locked ? <Unlock size={12} /> : <RotateCw size={12} />}</button>}
                      <button title="删除这一段" onClick={(e) => { e.stopPropagation(); remove(block.id); }}><Trash2 size={12} /></button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
        <button className="wadd" onClick={() => { const block = newBlock(draft.blocks.length); pendingFocus.current = { id: block.id, side: 'zh', caret: 0 }; edit((doc) => ({ ...doc, blocks: [...doc.blocks, block] })); }}><Plus size={13} /> 添加段落</button>
      </div>
    </div>
  );
}

function newBlock(order: number): DraftBlock {
  return { id: crypto.randomUUID().slice(0, 8), order, type: 'paragraph', zhText: '', enText: '', zhHash: hash(''), locked: false, status: 'synced' };
}
