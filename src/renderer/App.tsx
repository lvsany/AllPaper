import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { BookOpen, CalendarDays, Check, Database, FileText, FolderKanban, NotebookText, Settings as SettingsIcon, X } from 'lucide-react';
import type { LibraryStatus, Paper, Settings } from '../shared/types';
import { defaultSettings } from '../shared/types';
import { SettingsView } from './SettingsView';
import { LibraryView } from './LibraryView';
import { ReaderView } from './reader/ReaderView';
import { ProjectView } from './ProjectView';
import { ScheduleView } from './ScheduleView';
import { MemoView } from './MemoView';
import { appendToNote } from './notes/noteBus';
import { costParts, formatMoney, formatTokens, isPriced, taskCostParts, totalUsage } from '../core/usage';
import type { UsageSummary } from '../shared/types';
import { activate, activeRecent, activeScreen, closeRecent, initialTabs, openNote, openPaper, openScreen, parentScreen, parseTabs, screenLabel, SCREENS, type Recent, type Screen, type TabsState } from '../core/tabs';
import { WorkspaceProvider, useWorkspace } from './workspace';

const STORAGE_KEY = 'allpaper.recents.v2';

function loadTabs(): TabsState {
  try { return parseTabs(localStorage.getItem(STORAGE_KEY)) ?? initialTabs(); } catch { return initialTabs(); }
}

const SCREEN_ICON: Record<Screen, typeof BookOpen> = {
  library: BookOpen, projects: FolderKanban, schedule: CalendarDays, memo: NotebookText, settings: SettingsIcon
};

export function App() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [status, setStatus] = useState<LibraryStatus>({ configured: false, paperCount: 0, indexHealthy: false });
  const [tabs, setTabs] = useState<TabsState>(loadTabs);
  const refresh = useCallback(async () => {
    setSettings(await window.allPaper.settings.get());
    setStatus(await window.allPaper.library.status());
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs)); } catch { /* storage unavailable */ } }, [tabs]);

  return (
    <WorkspaceProvider libraryReady={status.configured} settings={settings} openSettings={() => setTabs((s) => openScreen(s, 'settings'))}>
      <Shell tabs={tabs} setTabs={setTabs} status={status} settings={settings} refresh={refresh} />
    </WorkspaceProvider>
  );
}

function Shell({ tabs, setTabs, status, settings, refresh }: { tabs: TabsState; setTabs: Dispatch<SetStateAction<TabsState>>; status: LibraryStatus; settings: Settings; refresh(): Promise<void> }) {
  const ws = useWorkspace();
  const [commandOpen, setCommandOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [toast, setToast] = useState<string>();

  useEffect(() => {
    const offCommand = window.allPaper.events.on('shortcut:command', () => setCommandOpen(true));
    const offQuick = window.allPaper.events.on('shortcut:quick-idea', () => setQuickOpen(true));
    return () => { offCommand(); offQuick(); };
  }, []);
  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(undefined), 2600); return () => window.clearTimeout(t); }, [toast]);

  const project = ws.currentProject;
  /** The keys page can be renamed in Settings. */
  const nameOf = (screen: Screen) => screen === 'memo' ? (settings.keysPageName.trim() || 'Keys') : screenLabel(screen);
  /** A fixed entry. "项目笔记" opens the current project's note, which then shows up under recent pages. */
  const go = (screen: Screen) => {
    if (screen === 'projects' && project) setTabs((s) => openNote(s, { id: project.id, name: project.name }));
    else setTabs((s) => openScreen(s, screen));
  };
  const open = (paper: Paper, anchor?: string) => setTabs((s) => openPaper(s, { id: paper.id, title: paper.title }, anchor));
  const close = (id: string) => setTabs((s) => closeRecent(s, id));
  const activateRecent = (recent: Recent) => {
    if (recent.kind === 'note') ws.selectProject(recent.projectId);
    setTabs((s) => activate(s, recent.id));
  };

  const recent = activeRecent(tabs);
  const screen = activeScreen(tabs);
  const parent = parentScreen(recent);
  const activePaper = recent?.kind === 'paper' ? ws.papers.find((p) => p.id === recent.paperId) : undefined;

  // The note page follows the project picked inside it, and a project created from the empty page gets a recent entry.
  useEffect(() => {
    if (!project) return;
    if (recent?.kind === 'note' && recent.projectId !== project.id) setTabs((s) => openNote(s, { id: project.id, name: project.name }));
    else if (screen === 'projects') setTabs((s) => openNote(s, { id: project.id, name: project.name }));
  }, [project, recent, screen, setTabs]);

  // pages whose paper or project no longer exists should not linger
  useEffect(() => {
    if (recent?.kind === 'paper' && ws.papersLoaded && !activePaper) setTabs((s) => closeRecent(s, recent.id));
    if (recent?.kind === 'note' && ws.projects.length > 0 && !ws.projects.some((p) => p.id === recent.projectId)) setTabs((s) => closeRecent(s, recent.id));
  }, [recent, activePaper, ws.papersLoaded, ws.projects, setTabs]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">A</span><span>AllPaper</span></div>
        <nav>
          {SCREENS.map(({ id }) => {
            const Icon = SCREEN_ICON[id];
            const cls = screen === id ? 'nav-item active' : parent === id ? 'nav-item parent' : 'nav-item';
            return <button key={id} className={cls} onClick={() => go(id)}><Icon size={18} />{nameOf(id)}</button>;
          })}
        </nav>
        <div className="tabs-head"><span>最近浏览</span></div>
        <div className="tabs-list">
          {tabs.recents.map((item) => {
            const Icon = item.kind === 'note' ? FolderKanban : FileText;
            const label = item.kind === 'note' ? (ws.projects.find((p) => p.id === item.projectId)?.name ?? item.title) : item.title;
            return (
              <div
                key={item.id} className={`tab-item${item.id === tabs.activeId ? ' active' : ''}`}
                title={item.kind === 'note' ? `笔记：${label}` : label} role="button" tabIndex={0}
                onClick={() => activateRecent(item)}
                onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); close(item.id); } }}
                onKeyDown={(e) => { if (e.key === 'Enter') activateRecent(item); }}
              >
                <Icon size={15} />
                <span>{label}</span>
                <button className="tab-close" title="关闭" aria-label={`关闭 ${label}`} onClick={(e) => { e.stopPropagation(); close(item.id); }}><X size={13} /></button>
              </div>
            );
          })}
          {!tabs.recents.length && <p className="tabs-empty">打开过的论文和笔记会出现在这里。</p>}
        </div>
        <div className="sidebar-foot">
          <button className="shortcut" onClick={() => setCommandOpen(true)}><span>搜索与命令</span><kbd>⌘ K</kbd></button>
          <button className="shortcut" onClick={() => setQuickOpen(true)}><span>快速记点子</span><kbd>⌘ ⇧ I</kbd></button>
          <div className={`ai-dot ${ws.ai.configured ? 'on' : ''}`} title={ws.ai.mock ? '测试用 Mock，输出不是真实模型' : ''}>
            {ws.ai.configured ? (ws.ai.mock ? 'AI：测试 Mock' : 'AI 已配置') : <button onClick={() => go('settings')}>AI 未配置</button>}
          </div>
          <TokenUsage onOpen={() => go('settings')} />
        </div>
      </aside>
      <main className="workspace">
        {!status.configured && screen !== 'settings'
          ? <Onboarding onConfigure={() => go('settings')} />
          : recent?.kind === 'paper'
            ? (activePaper
              ? <ReaderView key={activePaper.id} paper={activePaper} anchor={recent.anchor} onBack={() => go('library')} onOpenPaper={open} />
              : <div className="rd-empty"><p>正在打开论文…</p></div>)
            : recent?.kind === 'note' || screen === 'projects' ? <ProjectView onOpenPaper={open} />
              : screen === 'settings' ? <SettingsView settings={settings} status={status} onSaved={async () => { await refresh(); await ws.refreshAi(); await ws.refreshPapers(); await ws.refreshProjects(); }} />
                : screen === 'schedule' ? <ScheduleView />
                  : screen === 'memo' ? <MemoView />
                    : <LibraryView onRead={(paper) => open(paper)} />}
      </main>
      {commandOpen && (
        <CommandPanel
          close={() => setCommandOpen(false)}
          nameOf={nameOf}
          onGo={(target) => { go(target); setCommandOpen(false); }}
          onOpenPaper={(paper) => { open(paper); setCommandOpen(false); }}
        />
      )}
      {quickOpen && <QuickIdea close={() => setQuickOpen(false)} onSaved={(name) => { setQuickOpen(false); setToast(`已记入「${name}」的笔记`); }} />}
      {toast && <div className="toast"><Check size={14} /> {toast}</div>}
    </div>
  );
}

/** This month's model usage, bottom-left of the sidebar; updates after every call. */
function TokenUsage({ onOpen }: { onOpen(): void }) {
  const ws = useWorkspace();
  const [usage, setUsage] = useState<UsageSummary>();
  useEffect(() => {
    const load = () => void window.allPaper.usage.get().then(setUsage);
    load();
    return window.allPaper.events.on('usage:changed', load);
  }, []);
  if (!usage) return null;
  const { currency, prices } = ws.settings;
  const priced = isPriced(prices);
  const total = totalUsage(usage.byTask);
  const parts = costParts(usage.byTask, prices);
  const spend = parts.input + parts.output;
  const money = (n: number) => formatMoney(n, currency);
  const lines = Object.entries(usage.byTask).map(([task, item]) => {
    const part = taskCostParts(task, item, prices);
    return `${task}：${item.calls} 次 · 输入 ${formatTokens(item.inputTokens)}${priced ? `（${money(part.input)}）` : ''} · 输出 ${formatTokens(item.outputTokens)}${priced ? `（${money(part.output)}）` : ''}`;
  });
  const title = [
    `${usage.month} 月累计：${total.calls} 次调用`,
    `输入 ${formatTokens(total.inputTokens)} token${priced ? ` → ${money(parts.input)}` : ''}`,
    `输出 ${formatTokens(total.outputTokens)} token${priced ? ` → ${money(parts.output)}` : ''}`,
    '',
    ...lines,
    priced ? '花费 = 输入 token × 输入单价 + 输出 token × 输出单价，按各模型档位分别计算；仅供参考，不含缓存折扣。' : '在设置里填入各模型的单价后显示花费估算。'
  ].join('\n');
  return (
    <button className="token-usage" title={title} onClick={onOpen}>
      <span>本月 token</span><b>{formatTokens(total.inputTokens + total.outputTokens)}</b>
      <span>本月花费</span><b className={priced ? '' : 'dim'}>{priced ? money(spend) : '未设单价'}</b>
    </button>
  );
}

function CommandPanel({ close, onGo, nameOf, onOpenPaper }: { close(): void; onGo(screen: Screen): void; nameOf(screen: Screen): string; onOpenPaper(paper: Paper): void }) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<Array<{ id: string; title: string; excerpt: string }>>([]);
  useEffect(() => {
    if (!query.trim()) { setRows([]); return; }
    const timer = window.setTimeout(() => void window.allPaper.library.fullText(query).then(setRows), 120);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  return (
    <div className="overlay" role="dialog" aria-label="命令面板" onMouseDown={close}>
      <div className="command-panel" onMouseDown={(e) => e.stopPropagation()}>
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索文献库全文（标题、摘要、正文）…" />
        {!query.trim() && <div className="command-pages">{SCREENS.map((screen) => <button key={screen.id} className="command-action" onClick={() => onGo(screen.id)}>{nameOf(screen.id)}</button>)}</div>}
        {query.trim() && <button className="command-action" onClick={() => onGo('library')}>在文献库中搜索“{query.trim()}”并在线检索</button>}
        {rows.map((row) => (
          <button key={row.id} className="command-result" onClick={async () => { const bundle = await window.allPaper.papers.get(row.id); if (bundle) onOpenPaper(bundle.paper); }}>
            <strong>{row.title}</strong><small dangerouslySetInnerHTML={{ __html: row.excerpt.replace(/<(?!\/?b>)[^>]*>/g, '') }} />
          </button>
        ))}
        {query && !rows.length && <p>文献库里没有匹配项。</p>}
        <kbd>Esc 关闭</kbd>
      </div>
    </div>
  );
}

function QuickIdea({ close, onSaved }: { close(): void; onSaved(projectName: string): void }) {
  const ws = useWorkspace();
  const [text, setText] = useState('');
  const [projectId, setProjectId] = useState(ws.currentProject?.id ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    let target = ws.projects.find((p) => p.id === projectId);
    if (!target) target = await ws.createProject('收集箱');
    await appendToNote(target.id, `- ${text.trim().replace(/\n+/g, ' ')}`);
    onSaved(target.name);
  };

  return (
    <div className="overlay" role="dialog" aria-label="快速记点子" onMouseDown={close}>
      <div className="quick-idea-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="eyebrow">快速记点子</div>
        <h2>先记下来，稍后在笔记里展开。</h2>
        <textarea
          autoFocus value={text} placeholder="一句话记录研究想法…（⌘Enter 保存）" onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && e.metaKey) void save(); if (e.key === 'Escape') close(); }}
        />
        <label>记入哪个项目的笔记
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {ws.projects.length ? ws.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>) : <option value="">收集箱（自动创建）</option>}
          </select>
        </label>
        <div>
          <button className="secondary" onClick={close}>取消</button>
          <button className="primary" onClick={() => void save()} disabled={!text.trim() || saving}>{saving ? '保存中…' : '记下'}</button>
        </div>
      </div>
    </div>
  );
}

function Onboarding({ onConfigure }: { onConfigure(): void }) {
  return (
    <section className="onboarding">
      <div className="onboarding-icon"><Database size={32} /></div>
      <h1>先选择资料库目录</h1>
      <p>论文、批注和项目笔记都以普通文件保存在你选的文件夹里，随时可以迁走。</p>
      <button className="primary" onClick={onConfigure}>选择资料库目录</button>
      <small>API Key 可以稍后在设置里填写；没有它也能阅读、批注、记笔记。</small>
    </section>
  );
}
