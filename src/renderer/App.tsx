import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { BookOpen, CalendarDays, Check, Database, FileText, FolderKanban, NotebookText, Plus, Settings as SettingsIcon, X } from 'lucide-react';
import type { LibraryStatus, Paper, Settings } from '../shared/types';
import { defaultSettings } from '../shared/types';
import { SettingsView } from './SettingsView';
import { LibraryView } from './LibraryView';
import { ReaderView } from './reader/ReaderView';
import { ProjectView } from './ProjectView';
import { ScheduleView } from './ScheduleView';
import { MemoView } from './MemoView';
import { appendToNote } from './notes/noteBus';
import { costOf, formatMoney, formatTokens, isPriced, taskCost, totalUsage } from '../core/usage';
import type { UsageSummary } from '../shared/types';
import { activate, closeTab, closedScreens, initialTabs, openPaper, openScreen, parseTabs, removePaper, screenLabel, SCREENS, type Screen, type TabsState } from '../core/tabs';
import { WorkspaceProvider, useWorkspace } from './workspace';

const STORAGE_KEY = 'allpaper.tabs.v1';

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<string>();

  useEffect(() => {
    const offCommand = window.allPaper.events.on('shortcut:command', () => setCommandOpen(true));
    const offQuick = window.allPaper.events.on('shortcut:quick-idea', () => setQuickOpen(true));
    return () => { offCommand(); offQuick(); };
  }, []);
  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(undefined), 2600); return () => window.clearTimeout(t); }, [toast]);

  const go = (screen: Screen) => { setTabs((s) => openScreen(s, screen)); setMenuOpen(false); };
  const open = (paper: Paper, anchor?: string) => setTabs((s) => openPaper(s, { id: paper.id, title: paper.title }, anchor));
  const close = (id: string) => setTabs((s) => closeTab(s, id));

  const active = tabs.tabs.find((tab) => tab.id === tabs.activeId);
  const activePaper = active?.kind === 'paper' ? ws.papers.find((p) => p.id === active.paperId) : undefined;
  const onSettings = active?.kind === 'screen' && active.screen === 'settings';

  // a paper that no longer exists (deleted, or the library was switched) should not linger as a page
  useEffect(() => {
    if (active?.kind === 'paper' && ws.papersLoaded && !activePaper) setTabs((s) => removePaper(s, active.paperId));
  }, [active, activePaper, ws.papersLoaded, setTabs]);

  const closed = closedScreens(tabs);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">A</span><span>AllPaper</span></div>
        <div className="tabs-head">
          <span>最近浏览</span>
          <div className="tabs-add">
            <button title="打开页面" aria-label="打开页面" onClick={() => setMenuOpen((v) => !v)}><Plus size={15} /></button>
            {menuOpen && (
              <div className="tabs-menu" onMouseLeave={() => setMenuOpen(false)}>
                {closed.length ? closed.map((screen) => {
                  const Icon = SCREEN_ICON[screen];
                  return <button key={screen} onClick={() => go(screen)}><Icon size={15} />{screenLabel(screen)}</button>;
                }) : <p>主要页面都已打开</p>}
              </div>
            )}
          </div>
        </div>
        <nav className="tabs-list">
          {tabs.tabs.map((tab) => {
            const Icon = tab.kind === 'screen' ? SCREEN_ICON[tab.screen] : FileText;
            const label = tab.kind === 'screen' ? screenLabel(tab.screen) : tab.title;
            return (
              <div
                key={tab.id} className={`tab-item${tab.id === tabs.activeId ? ' active' : ''}${tab.kind === 'paper' ? ' paper' : ''}`}
                title={label} role="button" tabIndex={0}
                onClick={() => setTabs((s) => activate(s, tab.id))}
                onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); close(tab.id); } }}
                onKeyDown={(e) => { if (e.key === 'Enter') setTabs((s) => activate(s, tab.id)); }}
              >
                <Icon size={tab.kind === 'screen' ? 17 : 15} />
                <span>{label}</span>
                <button className="tab-close" title="关闭" aria-label={`关闭 ${label}`} onClick={(e) => { e.stopPropagation(); close(tab.id); }}><X size={13} /></button>
              </div>
            );
          })}
          {!tabs.tabs.length && <p className="tabs-empty">没有打开的页面。点上面的 + 打开。</p>}
        </nav>
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
        {!status.configured && !onSettings
          ? <Onboarding onConfigure={() => go('settings')} />
          : !active
            ? <EmptyPages closed={closed} onOpen={go} />
            : active.kind === 'paper'
              ? (activePaper
                ? <ReaderView key={activePaper.id} paper={activePaper} anchor={active.anchor} onBack={() => go('library')} onOpenPaper={open} />
                : <div className="rd-empty"><p>正在打开论文…</p></div>)
              : active.screen === 'settings' ? <SettingsView settings={settings} status={status} onSaved={async () => { await refresh(); await ws.refreshAi(); await ws.refreshPapers(); await ws.refreshProjects(); }} />
                : active.screen === 'projects' ? <ProjectView onOpenPaper={open} />
                  : active.screen === 'schedule' ? <ScheduleView />
                    : active.screen === 'memo' ? <MemoView />
                      : <LibraryView onRead={(paper) => open(paper)} />}
      </main>
      {commandOpen && (
        <CommandPanel
          close={() => setCommandOpen(false)}
          onGo={(screen) => { go(screen); setCommandOpen(false); }}
          onOpenPaper={(paper) => { open(paper); setCommandOpen(false); }}
        />
      )}
      {quickOpen && <QuickIdea close={() => setQuickOpen(false)} onSaved={(name) => { setQuickOpen(false); setToast(`已记入「${name}」的笔记`); }} />}
      {toast && <div className="toast"><Check size={14} /> {toast}</div>}
    </div>
  );
}

function EmptyPages({ closed, onOpen }: { closed: Screen[]; onOpen(screen: Screen): void }) {
  return (
    <section className="empty-workspace">
      <h1>没有打开的页面</h1>
      <p>从下面选一个，或按 ⌘K 搜索文献库。</p>
      <div className="row">{closed.map((screen) => <button key={screen} className="secondary" onClick={() => onOpen(screen)}>{screenLabel(screen)}</button>)}</div>
    </section>
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
  const spend = costOf(usage.byTask, prices);
  const lines = Object.entries(usage.byTask).map(([task, item]) => `${task}：${item.calls} 次 · 输入 ${formatTokens(item.inputTokens)} · 输出 ${formatTokens(item.outputTokens)}${priced ? ` · ${formatMoney(taskCost(task, item, prices), currency)}` : ''}`);
  const title = [
    `${usage.month} 月累计：输入 ${formatTokens(total.inputTokens)} · 输出 ${formatTokens(total.outputTokens)} · ${total.calls} 次调用`,
    ...lines,
    priced ? '花费 = token 数 × 设置里各模型档位的单价，仅供参考，不含缓存折扣。' : '在设置里填入各模型的单价后显示花费估算。'
  ].join('\n');
  return (
    <button className="token-usage" title={title} onClick={onOpen}>
      <span>本月 token</span><b>{formatTokens(total.inputTokens + total.outputTokens)}</b>
      <span>本月花费</span><b className={priced ? '' : 'dim'}>{priced ? formatMoney(spend, currency) : '未设单价'}</b>
    </button>
  );
}

function CommandPanel({ close, onGo, onOpenPaper }: { close(): void; onGo(screen: Screen): void; onOpenPaper(paper: Paper): void }) {
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
        {!query.trim() && <div className="command-pages">{SCREENS.map((screen) => <button key={screen.id} className="command-action" onClick={() => onGo(screen.id)}>{screen.label}</button>)}</div>}
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
