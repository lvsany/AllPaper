import { useEffect, useMemo, useState } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { EVENT_KINDS, agenda, isOverdue, relativeLabel, toDateKey, weekdayOf, type EventKind, type ScheduleEvent } from '../core/schedule';
import { useWorkspace } from './workspace';

const kindLabel = (kind: EventKind) => EVENT_KINDS.find((k) => k.id === kind)?.label ?? kind;

/** A plain list: unfinished past items on top, then everything ahead grouped by date. */
export function ScheduleView() {
  const { projects } = useWorkspace();
  const today = toDateKey(new Date());
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [draft, setDraft] = useState({ title: '', date: today, time: '', kind: 'other' as EventKind });
  const [error, setError] = useState('');

  useEffect(() => { void window.allPaper.schedule.list().then((list) => { setEvents(list); setLoaded(true); }); }, []);

  const commit = async (next: ScheduleEvent[]) => {
    setEvents(next);
    try { setEvents(await window.allPaper.schedule.save(next)); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败'); }
  };
  const patch = (id: string, change: Partial<ScheduleEvent>) => void commit(events.map((e) => e.id === id ? { ...e, ...change } : e));
  const plan = useMemo(() => agenda(events, today), [events, today]);

  const add = () => {
    if (!draft.title.trim() || !draft.date) return;
    const event: ScheduleEvent = { id: crypto.randomUUID().slice(0, 8), title: draft.title.trim(), date: draft.date, time: draft.time || undefined, kind: draft.kind, done: false };
    void commit([...events, event]);
    setDraft({ ...draft, title: '', time: '' });
  };

  const row = (event: ScheduleEvent) => {
    const open = editing === event.id;
    return (
      <div key={event.id} className={`ev k-${event.kind}${event.done ? ' done' : ''}${isOverdue(event, today) ? ' late' : ''}`}>
        <div className="ev-main">
          <button className={`ev-check${event.done ? ' on' : ''}`} title={event.done ? '标为未完成' : '标为完成'} onClick={() => patch(event.id, { done: !event.done })}>{event.done && <Check size={12} />}</button>
          <button className="ev-title" onClick={() => setEditing(open ? undefined : event.id)}>
            <span>{event.time && <b>{event.time}</b>}{event.title}</span>
            {event.notes && !open && <small>{event.notes.split('\n')[0]}</small>}
          </button>
          <span className="kind-chip">{kindLabel(event.kind)}</span>
        </div>
        {open && (
          <div className="ev-edit">
            <input value={event.title} onChange={(e) => setEvents(events.map((x) => x.id === event.id ? { ...x, title: e.target.value } : x))} onBlur={() => void commit(events)} />
            <div className="ev-edit-row">
              <input type="date" value={event.date} onChange={(e) => e.target.value && patch(event.id, { date: e.target.value })} />
              <input type="time" value={event.time ?? ''} onChange={(e) => patch(event.id, { time: e.target.value || undefined })} />
              <select value={event.kind} onChange={(e) => patch(event.id, { kind: e.target.value as EventKind })}>{EVENT_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select>
            </div>
            <select value={event.projectId ?? ''} onChange={(e) => patch(event.id, { projectId: e.target.value || undefined })}>
              <option value="">不关联项目</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <textarea rows={3} placeholder="备注（地点、链接、要准备的东西…）" value={event.notes ?? ''}
              onChange={(e) => setEvents(events.map((x) => x.id === event.id ? { ...x, notes: e.target.value } : x))} onBlur={() => void commit(events)} />
            <button className="text-button danger" onClick={() => { setEditing(undefined); void commit(events.filter((x) => x.id !== event.id)); }}><Trash2 size={13} /> 删除</button>
          </div>
        )}
      </div>
    );
  };

  const empty = loaded && !plan.overdue.length && !plan.groups.length;

  return (
    <section className="planner">
      <header className="planner-head">
        <div><div className="eyebrow">{plan.overdue.length + plan.groups.reduce((n, g) => n + g.events.length, 0)} 项未完成</div><h1>日程</h1></div>
        <label className="check-inline"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> 显示已完成</label>
      </header>
      {error && <div className="rd-banner warn">{error}</div>}

      <form className="plan-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input autoFocus value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="添加日程，例如：ICSE 投稿截止" />
        <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
        <input type="time" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} title="时间（可不填，表示全天）" />
        <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as EventKind })}>{EVENT_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select>
        <button className="primary tight" type="submit" disabled={!draft.title.trim() || !draft.date}><Plus size={14} /> 添加</button>
      </form>

      <div className="agenda">
        {plan.overdue.length > 0 && <div className="agenda-group late"><h3>已逾期 · {plan.overdue.length}</h3>{plan.overdue.map(row)}</div>}
        {plan.groups.map((group) => (
          <div className="agenda-group" key={group.date}>
            <h3>{group.date.slice(5).replace('-', ' 月 ')} 日 {weekdayOf(group.date)} · {relativeLabel(group.date, today)}</h3>
            {group.events.map(row)}
          </div>
        ))}
        {showDone && plan.done.length > 0 && <div className="agenda-group"><h3>已完成 · {plan.done.length}</h3>{plan.done.map(row)}</div>}
        {empty && <div className="panel-empty"><p>还没有日程。在上面填一个标题和日期，回车添加。</p></div>}
      </div>
    </section>
  );
}
