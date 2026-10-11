import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { AtSign, Bold, Heading2, Italic, List, ListChecks, Quote } from 'lucide-react';
import { docToMarkdown, markdownToDoc, type CitationRef, type DocNode } from '../../core/note-markdown';
import { useWorkspace, authorsShort } from '../workspace';
import { registerNoteEditor } from './noteBus';
import { Citation } from './Citation';

interface Props {
  projectId: string;
  onOpenCitation(ref: CitationRef): void;
  /** Called after each save with the saved Markdown. */
  onSaved?(markdown: string): void;
  placeholder?: string;
}

export function NoteEditor({ projectId, onOpenCitation, onSaved, placeholder }: Props) {
  const { labelOf, papers } = useWorkspace();
  const labelRef = useRef(labelOf);
  labelRef.current = labelOf;
  const openRef = useRef(onOpenCitation);
  openRef.current = onOpenCitation;
  const savedRef = useRef(onSaved);
  savedRef.current = onSaved;
  const [status, setStatus] = useState<'idle' | 'dirty' | 'saved' | 'error'>('idle');
  const [picker, setPicker] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const dirty = useRef(false);
  const projectRef = useRef(projectId);

  const save = async (markdownOf: () => string, id: string) => {
    window.clearTimeout(timer.current);
    dirty.current = false;
    try {
      const markdown = markdownOf();
      await window.allPaper.projects.saveNote(id, markdown);
      if (projectRef.current === id) setStatus('saved');
      savedRef.current?.(markdown);
    } catch { setStatus('error'); }
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ underline: false, link: { openOnClick: false } }),
      Placeholder.configure({ placeholder: placeholder ?? '在这里记录想法、读到的要点和待验证的假设。读论文时选中文字点“摘录”，会带着出处加到这里。输入 @ 可引用文献。' }),
      TaskList, TaskItem.configure({ nested: true }), Citation
    ],
    content: '',
    editorProps: {
      attributes: { class: 'note-prose', spellcheck: 'false' },
      handleClick: (_view, _pos, event) => {
        const chip = (event.target as HTMLElement).closest<HTMLElement>('.cite-chip');
        if (!chip) return false;
        openRef.current({ key: chip.dataset.key ?? '', anchor: chip.dataset.anchor || undefined });
        return true;
      },
      handleKeyDown: (_view, event) => {
        if (event.key === '@' && !event.metaKey && !event.ctrlKey) { setPicker(true); return true; }
        return false;
      }
    },
    onUpdate: ({ editor: ed }) => {
      dirty.current = true;
      setStatus('dirty');
      window.clearTimeout(timer.current);
      const id = projectRef.current;
      timer.current = window.setTimeout(() => void save(() => docToMarkdown(ed.getJSON() as DocNode), id), 700);
    }
  });

  // Load the note whenever the project changes; flush the previous one first.
  useEffect(() => {
    if (!editor) return;
    if (dirty.current && projectRef.current !== projectId) {
      void save(() => docToMarkdown(editor.getJSON() as DocNode), projectRef.current);
    }
    projectRef.current = projectId;
    let cancelled = false;
    void window.allPaper.projects.note(projectId).then((markdown) => {
      if (cancelled) return;
      editor.commands.setContent(markdownToDoc(markdown, (ref) => labelRef.current(ref)) as never, { emitUpdate: false });
      dirty.current = false;
      setStatus('idle');
      savedRef.current?.(markdown);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, projectId]);

  // Appends from the reader, quick capture and assistant land here.
  useEffect(() => {
    if (!editor) return;
    return registerNoteEditor(projectId, (markdown) => {
      const doc = markdownToDoc(markdown, (ref) => labelRef.current(ref));
      editor.chain().insertContentAt(editor.state.doc.content.size, doc.content as never).run();
      requestAnimationFrame(() => editor.view.dom.parentElement?.scrollTo({ top: editor.view.dom.parentElement.scrollHeight, behavior: 'smooth' }));
    });
  }, [editor, projectId]);

  // Save on unmount.
  useEffect(() => () => {
    if (editor && !editor.isDestroyed && dirty.current) {
      void window.allPaper.projects.saveNote(projectRef.current, docToMarkdown(editor.getJSON() as DocNode));
    }
  }, [editor]);

  const insertCitation = (key: string) => {
    if (!editor) return;
    const paper = papers.find((p) => p.citekey === key);
    editor.chain().focus().insertContent([{ type: 'citation', attrs: { key, label: paper ? authorsShort(paper) : key } }, { type: 'text', text: ' ' }]).run();
    setPicker(false);
  };

  const run = (action: () => void) => () => { if (editor) { action(); editor.commands.focus(); } };
  const label = status === 'dirty' ? '编辑中…' : status === 'saved' ? '已保存' : status === 'error' ? '保存失败' : '';

  return (
    <div className="note-editor">
      <div className="note-toolbar">
        <button title="标题" onClick={run(() => editor?.chain().toggleHeading({ level: 2 }).run())} className={editor?.isActive('heading') ? 'on' : ''}><Heading2 size={15} /></button>
        <button title="加粗" onClick={run(() => editor?.chain().toggleBold().run())} className={editor?.isActive('bold') ? 'on' : ''}><Bold size={15} /></button>
        <button title="斜体" onClick={run(() => editor?.chain().toggleItalic().run())} className={editor?.isActive('italic') ? 'on' : ''}><Italic size={15} /></button>
        <button title="列表" onClick={run(() => editor?.chain().toggleBulletList().run())} className={editor?.isActive('bulletList') ? 'on' : ''}><List size={15} /></button>
        <button title="待办" onClick={run(() => editor?.chain().toggleTaskList().run())} className={editor?.isActive('taskList') ? 'on' : ''}><ListChecks size={15} /></button>
        <button title="引用块" onClick={run(() => editor?.chain().toggleBlockquote().run())} className={editor?.isActive('blockquote') ? 'on' : ''}><Quote size={15} /></button>
        <button title="引用文献（输入 @）" onClick={() => setPicker(true)}><AtSign size={15} /></button>
        <span className="note-status">{label}</span>
      </div>
      <div className="note-scroll"><EditorContent editor={editor} /></div>
      {picker && <CitationPicker onPick={insertCitation} onClose={() => { setPicker(false); editor?.commands.focus(); }} />}
    </div>
  );
}

function CitationPicker({ onPick, onClose }: { onPick(key: string): void; onClose(): void }) {
  const { papers } = useWorkspace();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return papers.filter((paper) => !q || `${paper.title} ${paper.citekey} ${paper.authors.map((a) => a.family).join(' ')} ${paper.year ?? ''}`.toLowerCase().includes(q)).slice(0, 8);
  }, [papers, query]);
  return (
    <div className="picker" role="dialog" aria-label="引用文献">
      <input
        autoFocus value={query} placeholder="搜索标题、作者、年份或引用键…"
        onChange={(event) => { setQuery(event.target.value); setCursor(0); }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
          else if (event.key === 'ArrowDown') { event.preventDefault(); setCursor((c) => Math.min(c + 1, matches.length - 1)); }
          else if (event.key === 'ArrowUp') { event.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
          else if (event.key === 'Enter' && matches[cursor]) { event.preventDefault(); onPick(matches[cursor].citekey); }
        }}
      />
      {matches.map((paper, index) => (
        <button key={paper.id} className={index === cursor ? 'on' : ''} onMouseEnter={() => setCursor(index)} onClick={() => onPick(paper.citekey)}>
          <strong>{paper.title}</strong><small>{authorsShort(paper)} · {paper.citekey}</small>
        </button>
      ))}
      {!matches.length && <p>文献库中没有匹配项。</p>}
    </div>
  );
}
