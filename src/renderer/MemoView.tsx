import { useEffect, useRef, useState } from 'react';
import { Copy, Eye, EyeOff, Lock, LockOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import type { MemoRow } from '../shared/types';
import { useWorkspace } from './workspace';

const cleanError = (error: unknown) =>
  error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error);

/** A table of API keys (and any other name → value pairs). Locked rows are encrypted and kept out of the library. */
export function MemoView() {
  const { settings } = useWorkspace();
  const [rows, setRows] = useState<MemoRow[]>([]);
  const [error, setError] = useState('');
  const [newId, setNewId] = useState<string>();

  const load = async () => setRows(await window.allPaper.memos.list());
  useEffect(() => {
    // rows added but never filled in are not worth keeping
    void (async () => {
      const all = await window.allPaper.memos.list();
      const blank = all.filter((row) => !row.name.trim() && !row.note.trim() && !row.value && !row.hasValue);
      await Promise.all(blank.map((row) => window.allPaper.memos.remove(row.id)));
      setRows(blank.length ? await window.allPaper.memos.list() : all);
    })();
  }, []);

  const addRow = async () => {
    try {
      const id = crypto.randomUUID().slice(0, 8);
      await window.allPaper.memos.save({ id, name: '', note: '', secret: true });
      await load();
      setNewId(id);
    } catch (reason) { setError(cleanError(reason)); }
  };

  return (
    <section className="keys">
      <header className="keys-head">
        <div>
          <div className="eyebrow">{settings.keysPageName.trim() || 'Keys'}</div>
          <h1>{settings.keysPageName.trim() || 'Keys'}</h1>
        </div>
        <button className="primary" onClick={() => void addRow()}><Plus size={15} /> 添加一行</button>
      </header>
      <p className="keys-hint"><Lock size={13} /> 锁定的行：值用系统钥匙串加密，只存在本机应用数据目录，不写入资料库，不随备份或同步。解锁的行以明文存进资料库，适合 skills 名称这类不敏感的内容。</p>
      {error && <div className="notice warn">{error}</div>}

      <table className="keys-table">
        <thead><tr><th style={{ width: '24%' }}>名称</th><th style={{ width: '36%' }}>值</th><th>备注</th><th style={{ width: 118 }} /></tr></thead>
        <tbody>
          {rows.map((row) => <KeyRow key={row.id} row={row} autoFocus={row.id === newId} onChanged={load} onError={setError} />)}
          {!rows.length && <tr><td colSpan={4} className="keys-empty">还没有记录。点右上角“添加一行”，例如：名称填 Anthropic，值粘贴 API Key。</td></tr>}
        </tbody>
      </table>
    </section>
  );
}

function KeyRow({ row, autoFocus, onChanged, onError }: { row: MemoRow; autoFocus: boolean; onChanged(): Promise<void>; onError(message: string): void }) {
  const [name, setName] = useState(row.name);
  const [note, setNote] = useState(row.note);
  const [value, setValue] = useState(row.value ?? '');
  const [replacing, setReplacing] = useState(false);
  const [shown, setShown] = useState<string>();
  const [copied, setCopied] = useState(false);
  const first = useRef(true);

  const save = async (patch: Partial<{ secret: boolean; value: string }> = {}) => {
    const secret = patch.secret ?? row.secret;
    try {
      await window.allPaper.memos.save({
        id: row.id, name, note, secret,
        ...(patch.value !== undefined ? { value: patch.value } : !secret ? { value } : {})
      });
      onError('');
      await onChanged();
    } catch (reason) { onError(cleanError(reason)); }
  };

  // Name, note and plain values save themselves shortly after typing stops.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const timer = window.setTimeout(() => void save(), 500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, note, row.secret ? '' : value]);

  const toggleLock = async () => {
    if (row.secret) {
      try {
        const current = row.hasValue ? await window.allPaper.memos.reveal(row.id) : '';
        setValue(current);
        await save({ secret: false, value: current });
      } catch (reason) { onError(cleanError(reason)); }
    } else {
      setShown(undefined);
      await save({ secret: true, value });
      setValue('');
      setReplacing(false);
    }
  };

  const commitSecret = async () => {
    if (!value) { setReplacing(false); return; }
    await save({ value });
    setValue('');
    setReplacing(false);
    setShown(undefined);
  };

  return (
    <tr className={row.secret ? 'locked' : ''}>
      <td><input autoFocus={autoFocus} value={name} onChange={(e) => setName(e.target.value)} placeholder="名称，如 Anthropic" /></td>
      <td>
        {!row.secret ? (
          <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="值" />
        ) : !row.hasValue || replacing ? (
          <div className="key-cell">
            <input type="password" autoFocus={replacing} value={value} placeholder="粘贴 API Key，回车保存"
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void commitSecret(); if (e.key === 'Escape') { setValue(''); setReplacing(false); } }}
              onBlur={() => void commitSecret()} />
          </div>
        ) : (
          <div className="key-cell">
            <code>{shown ?? '••••••••••••••••'}</code>
            <button className="icon-button" title={shown ? '隐藏' : '显示'} onClick={async () => {
              if (shown) { setShown(undefined); return; }
              try { setShown(await window.allPaper.memos.reveal(row.id)); } catch (reason) { onError(cleanError(reason)); }
            }}>{shown ? <EyeOff size={15} /> : <Eye size={15} />}</button>
            <button className="icon-button" title="复制（30 秒后自动清空剪贴板）" onClick={async () => {
              try { await window.allPaper.memos.copySecret(row.id); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch (reason) { onError(cleanError(reason)); }
            }}>{copied ? <span className="copied">已复制</span> : <Copy size={15} />}</button>
            <button className="icon-button" title="更换" onClick={() => { setValue(''); setReplacing(true); }}><Pencil size={14} /></button>
          </div>
        )}
      </td>
      <td><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="备注（用途、额度…）" /></td>
      <td className="row-tools">
        <button className="icon-button" title={row.secret ? '已锁定（加密，不进资料库）；点击解锁为明文' : '明文；点击锁定并加密'} onClick={() => void toggleLock()}>{row.secret ? <Lock size={15} /> : <LockOpen size={15} />}</button>
        <button className="icon-button" title="删除" onClick={async () => {
          if (!window.confirm(`删除“${row.name || '这一行'}”？`)) return;
          await window.allPaper.memos.remove(row.id);
          await onChanged();
        }}><Trash2 size={15} /></button>
      </td>
    </tr>
  );
}
