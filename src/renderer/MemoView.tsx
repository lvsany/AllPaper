import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Eye, EyeOff, FileText, KeyRound, Lock, Plus, Search, Trash2 } from 'lucide-react';
import type { MemoItem } from '../shared/types';

const cleanError = (error: unknown) =>
  error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error);

/** Memos: plain notes (skill names, snippets) and secrets (API keys) whose values are kept encrypted outside the library. */
export function MemoView() {
  const [items, setItems] = useState<MemoItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string>();
  const [error, setError] = useState('');

  const load = async () => setItems(await window.allPaper.memos.list());
  useEffect(() => { void load(); }, []);

  const tags = useMemo(() => [...new Set(items.flatMap((item) => item.tags))].sort(), [items]);
  const shown = items.filter((item) => {
    if (tag && !item.tags.includes(tag)) return false;
    const q = query.trim().toLowerCase();
    return !q || `${item.title} ${item.kind === 'text' ? item.content : ''} ${item.tags.join(' ')}`.toLowerCase().includes(q);
  });
  const selected = items.find((item) => item.id === selectedId);

  const create = async (kind: MemoItem['kind']) => {
    try {
      const item = await window.allPaper.memos.save({ id: crypto.randomUUID().slice(0, 8), kind, title: kind === 'secret' ? '新的密钥' : '新备忘', content: '', tags: [] });
      await load();
      setSelectedId(item.id);
    } catch (reason) { setError(cleanError(reason)); }
  };

  return (
    <section className="memo">
      <aside className="memo-list">
        <header>
          <div className="eyebrow">备忘录</div>
          <div className="memo-new">
            <button className="primary tight" onClick={() => void create('text')}><Plus size={14} /> 备忘</button>
            <button className="secondary tight" onClick={() => void create('secret')}><KeyRound size={14} /> 密钥</button>
          </div>
        </header>
        <div className="memo-search"><Search size={14} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索标题、内容、标签" /></div>
        {tags.length > 0 && (
          <div className="ann-filter memo-tags">
            {tags.map((t) => <button key={t} className={tag === t ? 'on' : ''} onClick={() => setTag(tag === t ? undefined : t)}>#{t}</button>)}
          </div>
        )}
        {error && <div className="notice warn">{error}</div>}
        <div className="memo-items">
          {shown.map((item) => (
            <button key={item.id} className={item.id === selectedId ? 'on' : ''} onClick={() => setSelectedId(item.id)}>
              {item.kind === 'secret' ? <Lock size={14} /> : <FileText size={14} />}
              <span><strong>{item.title || '（无标题）'}</strong><small>{item.kind === 'secret' ? (item.hasSecret ? '已保存密钥 · ' : '尚未填写 · ') : ''}{item.content.replace(/\s+/g, ' ').slice(0, 50)}</small></span>
            </button>
          ))}
          {!shown.length && <p className="muted pad">{items.length ? '没有匹配的备忘。' : '还没有备忘。记下常用的 skills 名称、命令，或把 API Key 存进“密钥”。'}</p>}
        </div>
      </aside>
      <div className="memo-detail">
        {selected
          ? <MemoEditor key={selected.id} item={selected} onChanged={load} onDeleted={() => { setSelectedId(undefined); void load(); }} />
          : <div className="memo-blank"><KeyRound size={26} /><p>选择或新建一条备忘。</p><small>“密钥”的值用系统钥匙串加密，只保存在本机的应用数据目录，不会写进资料库，也不会随资料库备份或同步。</small></div>}
      </div>
    </section>
  );
}

function MemoEditor({ item, onChanged, onDeleted }: { item: MemoItem; onChanged(): Promise<void>; onDeleted(): void }) {
  const [title, setTitle] = useState(item.title);
  const [content, setContent] = useState(item.content);
  const [tagText, setTagText] = useState(item.tags.join(', '));
  const [secret, setSecret] = useState<string>();
  const [shown, setShown] = useState<string>();
  const [status, setStatus] = useState('');
  const timer = useRef<number | undefined>(undefined);
  const first = useRef(true);

  const persist = async (secretValue?: string) => {
    try {
      await window.allPaper.memos.save({
        id: item.id, kind: item.kind, title, content, tags: tagText.split(/[,，]/), ...(secretValue !== undefined ? { secret: secretValue } : {})
      });
      setStatus('已保存');
      await onChanged();
    } catch (reason) { setStatus(cleanError(reason)); }
  };

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setStatus('编辑中…');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void persist(), 600);
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content, tagText]);

  const saveSecret = async () => {
    if (secret === undefined) return;
    await persist(secret);
    setSecret(undefined);
    setShown(undefined);
  };

  return (
    <div className="memo-editor">
      <div className="memo-top">
        <input className="memo-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题" />
        <span className="muted">{status}</span>
        <button className="icon-button" title="删除" onClick={async () => { if (window.confirm(`删除“${item.title || '这条备忘'}”？${item.kind === 'secret' ? '保存的密钥值也会一并删除。' : ''}`)) { await window.allPaper.memos.remove(item.id); onDeleted(); } }}><Trash2 size={16} /></button>
      </div>
      <input className="memo-tagsinput" value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="标签，用逗号分隔（如：skills, api）" />

      {item.kind === 'secret' && (
        <div className="secret-box">
          <label>密钥值</label>
          {secret !== undefined ? (
            <div className="secret-row">
              <input autoFocus type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="粘贴 API Key" onKeyDown={(e) => { if (e.key === 'Enter') void saveSecret(); }} />
              <button className="primary tight" onClick={() => void saveSecret()}>保存</button>
              <button className="text-button" onClick={() => setSecret(undefined)}>取消</button>
            </div>
          ) : item.hasSecret ? (
            <div className="secret-row">
              <code>{shown ?? '••••••••••••••••'}</code>
              <button className="icon-button" title={shown ? '隐藏' : '显示'} onClick={async () => {
                if (shown) { setShown(undefined); return; }
                try { setShown(await window.allPaper.memos.reveal(item.id)); } catch (reason) { setStatus(cleanError(reason)); }
              }}>{shown ? <EyeOff size={15} /> : <Eye size={15} />}</button>
              <button className="icon-button" title="复制（30 秒后自动清空剪贴板）" onClick={async () => { try { await window.allPaper.memos.copySecret(item.id); setStatus('已复制，30 秒后清空剪贴板'); } catch (reason) { setStatus(cleanError(reason)); } }}><Copy size={15} /></button>
              <button className="text-button" onClick={() => setSecret('')}>更换</button>
            </div>
          ) : (
            <div className="secret-row"><button className="primary tight" onClick={() => setSecret('')}>填写密钥</button></div>
          )}
          <small>用系统钥匙串加密，只存在本机应用数据目录，不进入资料库、不随备份或同步。</small>
        </div>
      )}

      <textarea
        className="memo-body" value={content} onChange={(e) => setContent(e.target.value)}
        placeholder={item.kind === 'secret' ? '备注：用途、所属账号、控制台地址、额度…（不要把密钥本身写在这里）' : '写点什么：skills 名称、常用命令、待办的想法…'}
      />
    </div>
  );
}
