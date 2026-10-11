import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileText, LockKeyhole, Plus, RotateCw, Sparkles, Trash2, Unlock } from 'lucide-react';
import { beginTranslation, editEnglish, failTranslation, hash, receiveTranslation, unlock, updateChinese, type DraftBlock } from '../core/draft';
import { citationsIn, type CitationRef } from '../core/note-markdown';
import type { DraftDocument } from '../shared/projects';
import type { Paper } from '../shared/types';
import { AssistantPanel, type QuickAction } from './AssistantPanel';
import { NoteEditor } from './notes/NoteEditor';
import { appendToNote } from './notes/noteBus';
import { ProjectPicker } from './notes/ProjectPicker';
import { authorsShort, useWorkspace } from './workspace';

export function ProjectView({ onOpenPaper }: { onOpenPaper(paper: Paper, anchor?: string): void }) {
  const ws = useWorkspace();
  const project = ws.currentProject;
  const [tab, setTab] = useState<'note' | 'writing'>('note');
  const [side, setSide] = useState<'assistant' | 'papers'>('assistant');
  const [markdown, setMarkdown] = useState('');

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

  if (!ws.projects.length || !project) {
    return (
      <section className="project-empty">
        <FileText size={30} />
        <h1>从一个研究项目开始</h1>
        <p>每个项目有一份自己的笔记：读论文时的摘录、想到的点子、待验证的假设都写在这里，并保留到原文的出处。</p>
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
    <section className="proj">
      <header className="proj-top">
        <div>
          <div className="eyebrow">研究项目</div>
          <ProjectPicker />
        </div>
        <div className="seg">
          <button className={tab === 'note' ? 'on' : ''} onClick={() => setTab('note')}>笔记</button>
          <button className={tab === 'writing' ? 'on' : ''} onClick={() => setTab('writing')}>双栏写作</button>
        </div>
      </header>
      {tab === 'note' ? (
        <div className="proj-body">
          <div className="proj-note"><NoteEditor key={project.id} projectId={project.id} onOpenCitation={openCitation} onSaved={setMarkdown} /></div>
          <aside className="proj-side">
            <div className="rd-tabs">
              <button className={side === 'assistant' ? 'on' : ''} onClick={() => setSide('assistant')}><Sparkles size={14} /> 助手</button>
              <button className={side === 'papers' ? 'on' : ''} onClick={() => setSide('papers')}>引用的文献 {cited.length || ''}</button>
            </div>
            <div className="rd-tabbody">
              {side === 'assistant'
                ? <AssistantPanel scope={`project:${project.id}`} projectId={project.id} actions={actions} placeholder="助手会读取这份项目笔记。点“插入笔记”可把回答加到笔记末尾。" onInsert={(md) => void appendToNote(project.id, md)} />
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
    </section>
  );
}

const statusName: Record<string, string> = { synced: '已同步', translating: '翻译中', locked: '英文已手改', changed: '中文已变更', failed: '翻译失败', pending: '待翻译' };

function Writing({ projectId }: { projectId: string }) {
  const { ai, settings, openSettings } = useWorkspace();
  const [draft, setDraft] = useState<DraftDocument>();
  const latest = useRef<DraftDocument | undefined>(undefined);
  const timers = useRef(new Map<string, number>());
  const saveTimer = useRef<number | undefined>(undefined);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    let alive = true;
    void window.allPaper.projects.draft(projectId).then((loaded) => { if (alive) { latest.current = loaded; setDraft(loaded); } });
    return () => { alive = false; timers.current.forEach((t) => window.clearTimeout(t)); timers.current.clear(); };
  }, [projectId]);

  const commit = useCallback((change: (doc: DraftDocument) => DraftDocument) => {
    if (!latest.current) return;
    const next = change(latest.current);
    latest.current = next;
    setDraft(next);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void window.allPaper.projects.saveDraft(projectId, next), 500);
  }, [projectId]);

  const update = (id: string, change: (block: DraftBlock) => DraftBlock) =>
    commit((doc) => ({ ...doc, blocks: doc.blocks.map((block) => block.id === id ? change(block) : block) }));

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
      setMessage(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onChinese = (id: string, text: string) => {
    update(id, (block) => updateChinese(block, text));
    window.clearTimeout(timers.current.get(id));
    if (!ai.configured) return;
    timers.current.set(id, window.setTimeout(() => void translate(id), settings.translationDelayMs));
  };

  const add = () => commit((doc) => ({
    ...doc,
    blocks: [...doc.blocks, { id: crypto.randomUUID().slice(0, 8), order: doc.blocks.length, type: 'paragraph', zhText: '', enText: '', zhHash: hash(''), locked: false, status: 'synced' }]
  }));

  if (!draft) return <div className="rd-empty">加载中…</div>;
  const waiting = draft.blocks.filter((b) => !b.locked && b.zhText.trim() && (b.status === 'pending' || b.status === 'failed'));

  return (
    <div className="writing">
      <div className="writing-toolbar">
        <button className="secondary" onClick={add}><Plus size={14} /> 新段落</button>
        <button className="secondary" onClick={() => void window.allPaper.projects.exportLatex(projectId)}><Download size={14} /> 导出 LaTeX</button>
        {!!waiting.length && ai.configured && <button className="secondary" onClick={() => waiting.forEach((b) => void translate(b.id))}><RotateCw size={14} /> 翻译 {waiting.length} 段待处理</button>}
        <span>停笔 {Math.round(settings.translationDelayMs / 100) / 10} 秒后自动翻译；直接改英文会锁定该段。</span>
      </div>
      {!ai.configured && <div className="rd-banner">未配置模型服务，只能写中文；配置后点“翻译待处理段落”。<button className="text-button" onClick={openSettings}>前往设置</button></div>}
      {message && <div className="rd-banner warn">{message}<button className="text-button" onClick={() => setMessage(undefined)}>知道了</button></div>}
      {draft.blocks.map((block) => (
        <div className="bilingual" key={block.id}>
          <div>
            <label>中文 <small className={`st st-${block.status}`}>{statusName[block.status] ?? block.status}</small></label>
            <textarea
              value={block.zhText} placeholder="写中文内容…"
              onChange={(e) => onChinese(block.id, e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && e.metaKey) { e.preventDefault(); void translate(block.id); } }}
            />
          </div>
          <div>
            <label>English {block.locked && <LockKeyhole size={12} />}</label>
            <textarea value={block.enText} placeholder="English translation…" onChange={(e) => update(block.id, (b) => editEnglish(b, e.target.value))} />
            <div className="bilingual-actions">
              {block.locked && <button onClick={() => { update(block.id, unlock); if (ai.configured) void translate(block.id); }}><Unlock size={12} /> 解锁并重新翻译</button>}
              <button className="danger" onClick={() => commit((doc) => ({ ...doc, blocks: doc.blocks.filter((b) => b.id !== block.id) }))}><Trash2 size={12} /></button>
            </div>
          </div>
        </div>
      ))}
      {!draft.blocks.length && <button className="new-block" onClick={add}>开始写第一段中文</button>}
    </div>
  );
}
