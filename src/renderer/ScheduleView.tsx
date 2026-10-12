import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Check, ListTodo, Plus, Trash2 } from 'lucide-react';
import {
  EVENT_KINDS, agenda, eventsByDate, isOverdue, monthGrid, parseDateKey, relativeLabel, toDateKey, weekdayOf,
  type EventKind, type ScheduleEvent
} from '../core/schedule';
import { useWorkspace } from './workspace';

const kindLabel = (kind: EventKind) => EVENT_KINDS.find((k) => k.id === kind)?.label ?? kind;
const WEEK_HEAD = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export function ScheduleView() {
  const { projects } = useWorkspace();
  const today = toDateKey(new Date());
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [selected, setSelected] = useState(today);
  const [view, setView] = useState<'month' | 'list'>('month');
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [draft, setDraft] = useState({ title: '', time: '', kind: 'other' as EventKind });
  const [error, setError] = useState('');

  useEffect(() => { void window.allPaper.schedule.list().then((list) => { setEvents(list); setLoaded(true); }); }, []);

  const commit = async (next: ScheduleEvent[]) => {
    setEvents(next);
    try { setEvents(await window.allPaper.schedule.save(next)); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败'); }
  };
  const patch = (id: string, change: Partial<ScheduleEvent>) => void commit(events.map((e) => e.id === id ? { ...e, ...change } : e));

  const byDate = useMemo(() => eventsByDate(events), [events]);
  const grid = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const plan = useMemo(() => agenda(events, today, 60, showDone), [events, today, showDone]);
  const dayEvents = byDate.get(selected) ?? [];

  const shiftMonth = (delta: number) => setCursor(({ year, month }) => {
    const d = new Date(year, month + delta, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const goToday = () => { const d = new Date(); setCursor({ year: d.getFullYear(), month: d.getMonth() }); setSelected(today); };

  const add = () => {
    if (!draft.title.trim()) return;
    const event: ScheduleEvent = { id: crypto.randomUUID().slice(0, 8), title: draft.title.trim(), date: selected, time: draft.time || undefined, kind: draft.kind, done: false };
    void commit([...events, event]);
    setDraft({ title: '', time: '', kind: draft.kind });
  };

  const row = (event: ScheduleEvent, showDate = false) => {
    const open = editing === event.id;
    return (
      <div key={event.id} className={`ev k-${event.kind}${event.done ? ' done' : ''}${isOverdue(event, today) ? ' late' : ''}`}>
        <div className="ev-main">
          <button className={`ev-check${event.done ? ' on' : ''}`} title={event.done ? '标为未完成' : '标为完成'} onClick={() => patch(event.id, { done: !event.done })}>{event.done && <Check size={12} />}</button>
          <button className="ev-title" onClick={() => { setEditing(open ? undefined : event.id); setSelected(event.date); }}>
            {showDate && <small>{event.date.slice(5)} {weekdayOf(event.date)} · {relativeLabel(event.date, today)}</small>}
            <span>{event.time && <b>{event.time}</b>}{event.title}</span>
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

  const monthLabel = `${cursor.year} 年 ${cursor.month + 1} 月`;
  const selectedDate = parseDateKey(selected);

  return (
    <section className="planner">
      <header className="planner-head">
        <div>
          <div className="eyebrow">日程</div>
          <h1>{view === 'month' ? monthLabel : '接下来 60 天'}</h1>
        </div>
        <div className="planner-tools">
          {view === 'month' && <>
            <button className="icon-button" onClick={() => shiftMonth(-1)} title="上个月"><ChevronLeft size={18} /></button>
            <button className="secondary tight" onClick={goToday}>今天</button>
            <button className="icon-button" onClick={() => shiftMonth(1)} title="下个月"><ChevronRight size={18} /></button>
          </>}
          <div className="seg">
            <button className={view === 'month' ? 'on' : ''} onClick={() => setView('month')}><CalendarDays size={13} /> 月历</button>
            <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}><ListTodo size={13} /> 列表</button>
          </div>
        </div>
      </header>
      {error && <div className="rd-banner warn">{error}</div>}

      <div className="planner-body">
        {view === 'month' ? (
          <div className="month">
            <div className="month-head">{WEEK_HEAD.map((d) => <span key={d}>{d}</span>)}</div>
            <div className="month-grid">
              {grid.map((key) => {
                const list = byDate.get(key) ?? [];
                const inMonth = parseDateKey(key).getMonth() === cursor.month;
                return (
                  <button key={key} className={`cell${inMonth ? '' : ' out'}${key === today ? ' today' : ''}${key === selected ? ' sel' : ''}`} onClick={() => setSelected(key)}>
                    <span className="cell-day">{parseDateKey(key).getDate()}</span>
                    {list.slice(0, 3).map((e) => <span key={e.id} className={`cell-ev k-${e.kind}${e.done ? ' done' : ''}`}>{e.time ? `${e.time} ` : ''}{e.title}</span>)}
                    {list.length > 3 && <span className="cell-more">+{list.length - 3} 项</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="agenda">
            <label className="check-inline"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> 显示已完成</label>
            {plan.overdue.length > 0 && <div className="agenda-group late"><h3>已逾期 · {plan.overdue.length}</h3>{plan.overdue.map((e) => row(e, true))}</div>}
            {plan.groups.map((group) => (
              <div className="agenda-group" key={group.date}>
                <h3>{group.date.slice(5)} {weekdayOf(group.date)} · {relativeLabel(group.date, today)}</h3>
                {group.events.map((e) => row(e))}
              </div>
            ))}
            {loaded && !plan.overdue.length && !plan.groups.length && <div className="panel-empty"><p>接下来 60 天没有安排。切回月历，选一天添加。</p></div>}
          </div>
        )}

        <aside className="day">
          <div className="day-head">
            <strong>{selectedDate.getMonth() + 1} 月 {selectedDate.getDate()} 日 {weekdayOf(selected)}</strong>
            <span>{relativeLabel(selected, today)}</span>
          </div>
          <form className="day-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
            <input autoFocus value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="添加日程，例如：ICSE 投稿截止" />
            <div>
              <input type="time" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} title="时间（可不填，表示全天）" />
              <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as EventKind })}>{EVENT_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select>
              <button className="primary tight" type="submit" disabled={!draft.title.trim()}><Plus size={14} /> 添加</button>
            </div>
          </form>
          <div className="day-list">
            {dayEvents.map((e) => row(e))}
            {loaded && !dayEvents.length && <p className="muted">这一天没有安排。</p>}
          </div>
        </aside>
      </div>
    </section>
  );
}
