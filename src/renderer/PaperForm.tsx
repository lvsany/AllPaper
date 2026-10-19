import { useState } from 'react';
import { formatAuthors, parseAuthors } from '../core/authors';
import type { Paper, ReadStatus } from '../shared/types';

export const READ_STATUS: ReadonlyArray<{ id: ReadStatus; label: string }> = [
  { id: 'unread', label: '未读' }, { id: 'reading', label: '在读' }, { id: 'read', label: '已读' }, { id: 'deep-read', label: '精读' }
];

export interface PaperFormValues {
  title: string; authors: Paper['authors']; year?: number; venue?: string; doi?: string; arxivId?: string; url?: string;
  abstract?: string; tags: string[]; readStatus: ReadStatus; citekey?: string;
}

/** Metadata form used both to add a paper by hand and to edit an existing one. */
export function PaperForm({ initial, onSubmit, onCancel }: { initial?: Paper; onSubmit(values: PaperFormValues): Promise<void>; onCancel(): void }) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [authors, setAuthors] = useState(initial ? formatAuthors(initial.authors) : '');
  const [year, setYear] = useState(initial?.year?.toString() ?? '');
  const [venue, setVenue] = useState(initial?.venue ?? '');
  const [doi, setDoi] = useState(initial?.doi ?? '');
  const [arxivId, setArxivId] = useState(initial?.arxivId ?? '');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [abstract, setAbstract] = useState(initial?.abstract ?? '');
  const [tags, setTags] = useState(initial?.tags.join(', ') ?? '');
  const [readStatus, setReadStatus] = useState<ReadStatus>(initial?.readStatus ?? 'unread');
  const [citekey, setCitekey] = useState(initial?.citekey ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim()) { setError('标题不能为空'); return; }
    const yearNumber = year.trim() ? Number(year) : undefined;
    if (yearNumber !== undefined && (!Number.isInteger(yearNumber) || yearNumber < 1000 || yearNumber > 2200)) { setError('年份不对'); return; }
    setSaving(true);
    try {
      await onSubmit({
        title: title.trim(), authors: parseAuthors(authors), year: yearNumber, venue: venue.trim() || undefined, doi: doi.trim() || undefined,
        arxivId: arxivId.trim() || undefined, url: url.trim() || undefined, abstract: abstract.trim() || undefined,
        tags: tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean), readStatus, citekey: initial ? citekey.trim() : undefined
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : '保存失败');
      setSaving(false);
    }
  };

  return (
    <form className="metadata-form paper-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <h2>{initial ? '编辑文献' : '新建文献条目'}</h2>
      <label>标题<input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>作者<textarea rows={2} value={authors} placeholder="Wang, Lin; Chen, Yu（用分号或换行分隔，姓在前或在后都行）" onChange={(e) => setAuthors(e.target.value)} /></label>
      <div className="form-row">
        <label>年份<input value={year} inputMode="numeric" onChange={(e) => setYear(e.target.value)} /></label>
        <label>会议 / 期刊<input value={venue} onChange={(e) => setVenue(e.target.value)} /></label>
      </div>
      <div className="form-row">
        <label>DOI<input value={doi} onChange={(e) => setDoi(e.target.value)} /></label>
        <label>arXiv 编号<input value={arxivId} placeholder="2512.07404" onChange={(e) => setArxivId(e.target.value)} /></label>
      </div>
      <label>链接<input value={url} onChange={(e) => setUrl(e.target.value)} /></label>
      <label>摘要<textarea rows={4} value={abstract} onChange={(e) => setAbstract(e.target.value)} /></label>
      <div className="form-row">
        <label>标签（逗号分隔）<input value={tags} onChange={(e) => setTags(e.target.value)} /></label>
        {initial && <label>阅读状态<select value={readStatus} onChange={(e) => setReadStatus(e.target.value as ReadStatus)}>{READ_STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>}
      </div>
      {initial && <label>引用键（改动会同步更新所有笔记和草稿里的引用）<input value={citekey} onChange={(e) => setCitekey(e.target.value)} /></label>}
      {error && <p className="error-text">{error}</p>}
      <div className="row">
        <button type="button" className="secondary" onClick={onCancel}>取消</button>
        <button type="submit" className="primary" disabled={saving}>{initial ? '保存' : '添加'}</button>
      </div>
    </form>
  );
}
