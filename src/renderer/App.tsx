import { useCallback, useEffect, useState } from 'react';
import { BookOpen, Check, Database, FolderKanban, Settings as SettingsIcon } from 'lucide-react';
import type { LibraryStatus, Paper, Settings } from '../shared/types';
import { defaultSettings } from '../shared/types';
import { SettingsView } from './SettingsView';
import { LibraryView } from './LibraryView';
import { ReaderView } from './reader/ReaderView';
import { ProjectView } from './ProjectView';
import { appendToNote } from './notes/noteBus';
import { WorkspaceProvider, useWorkspace } from './workspace';

type Screen = 'library' | 'projects' | 'settings';
interface Reading { paper: Paper; anchor?: string }

export function App() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [status, setStatus] = useState<LibraryStatus>({ configured: false, paperCount: 0, indexHealthy: false });
  const [screen, setScreen] = useState<Screen>('library');
  const refresh = useCallback(async () => {
    setSettings(await window.allPaper.settings.get());
    setStatus(await window.allPaper.library.status());
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <WorkspaceProvider libraryReady={status.configured} settings={settings} openSettings={() => setScreen('settings')}>
      <Shell screen={screen} setScreen={setScreen} status={status} settings={settings} refresh={refresh} />
    </WorkspaceProvider>
  );
}

function Shell({ screen, setScreen, status, settings, refresh }: { screen: Screen; setScreen(s: Screen): void; status: LibraryStatus; settings: Settings; refresh(): Promise<void> }) {
  const ws = useWorkspace();
  const [reading, setReading] = useState<Reading>();
  const [inReader, setInReader] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [toast, setToast] = useState<string>();

  useEffect(() => {
    const offCommand = window.allPaper.events.on('shortcut:command', () => setCommandOpen(true));
    const offQuick = window.allPaper.events.on('shortcut:quick-idea', () => setQuickOpen(true));
    return () => { offCommand(); offQuick(); };
  }, []);
  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(undefined), 2600); return () => window.clearTimeout(t); }, [toast]);

  const open = (paper: Paper, anchor?: string) => { setReading({ paper, anchor }); setInReader(true); };
  const go = (next: Screen) => { setInReader(false); setScreen(next); };

  const nav = [
    ['library', BookOpen, '文献库'], ['projects', FolderKanban, '项目笔记'], ['settings', SettingsIcon, '设置']
  ] as const;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">A</span><span>AllPaper</span></div>
        <nav>
          {nav.map(([id, Icon, label]) => (
            <button key={id} className={!inReader && screen === id ? 'nav-item active' : 'nav-item'} onClick={() => go(id)}><Icon size={18} />{label}</button>
          ))}
        </nav>
        {reading && <button className={inReader ? 'nav-reading active' : 'nav-reading'} onClick={() => setInReader(true)} title={reading.paper.title}><BookOpen size={14} /><span>{reading.paper.title}</span></button>}
        <div className="sidebar-foot">
          <button className="shortcut" onClick={() => setCommandOpen(true)}><span>搜索与命令</span><kbd>⌘ K</kbd></button>
          <button className="shortcut" onClick={() => setQuickOpen(true)}><span>快速记点子</span><kbd>⌘ ⇧ I</kbd></button>
          <div className={`ai-dot ${ws.ai.configured ? 'on' : ''}`} title={ws.ai.mock ? '测试用 Mock，输出不是真实模型' : ''}>
            {ws.ai.configured ? (ws.ai.mock ? 'AI：测试 Mock' : 'AI 已配置') : <button onClick={() => go('settings')}>AI 未配置</button>}
          </div>
        </div>
      </aside>
      <main className="workspace">
        {!status.configured && screen !== 'settings'
          ? <Onboarding onConfigure={() => go('settings')} />
          : reading && inReader
            ? <ReaderView key={reading.paper.id} paper={reading.paper} anchor={reading.anchor} onBack={() => setInReader(false)} onOpenPaper={open} />
            : screen === 'settings' ? <SettingsView settings={settings} status={status} onSaved={async () => { await refresh(); await ws.refreshAi(); await ws.refreshPapers(); await ws.refreshProjects(); }} />
              : screen === 'projects' ? <ProjectView onOpenPaper={open} />
                : <LibraryView onRead={(paper) => open(paper)} />}
      </main>
      {commandOpen && <CommandPanel close={() => setCommandOpen(false)} onSearch={() => { go('library'); setCommandOpen(false); }} onOpenPaper={(paper) => { open(paper); setCommandOpen(false); }} />}
      {quickOpen && <QuickIdea close={() => setQuickOpen(false)} onSaved={(name) => { setQuickOpen(false); setToast(`已记入「${name}」的笔记`); }} />}
      {toast && <div className="toast"><Check size={14} /> {toast}</div>}
    </div>
  );
}

function CommandPanel({ close, onSearch, onOpenPaper }: { close(): void; onSearch(): void; onOpenPaper(paper: Paper): void }) {
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
        <button className="command-action" onClick={onSearch}>去文献库搜索在线论文</button>
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
