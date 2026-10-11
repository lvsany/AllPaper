import { useEffect, useState } from 'react';
import { BookOpen, Database, FolderKanban, PanelRight, Search, Settings as SettingsIcon, Sparkles } from 'lucide-react';
import type { LibraryStatus, Settings } from '../shared/types';
import { defaultSettings } from '../shared/types';
import { SettingsView } from './SettingsView';

type Screen = 'library' | 'projects' | 'search' | 'settings';

export function App() {
  const [screen, setScreen] = useState<Screen>('library');
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [status, setStatus] = useState<LibraryStatus>({ configured: false, paperCount: 0, indexHealthy: false });
  const [aiOpen, setAiOpen] = useState(true);
  const refresh = async () => { setSettings(await window.allPaper.settings.get()); setStatus(await window.allPaper.library.status()); };
  useEffect(() => { void refresh(); }, []);
  const nav = [
    ['library', BookOpen, '文献库'], ['projects', FolderKanban, '项目'], ['search', Search, '搜索'], ['settings', SettingsIcon, '设置']
  ] as const;
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">A</span><span>AllPaper</span></div>
      <nav>{nav.map(([id, Icon, label]) => <button key={id} className={screen === id ? 'nav-item active' : 'nav-item'} onClick={() => setScreen(id)}><Icon size={18}/>{label}</button>)}</nav>
      <div className="sidebar-foot"><button className="shortcut" onClick={() => setScreen('search')}><span>命令面板</span><kbd>⌘ K</kbd></button></div>
    </aside>
    <main className="workspace">
      {screen === 'settings' ? <SettingsView settings={settings} status={status} onSaved={refresh}/> : <Home screen={screen} status={status} onConfigure={() => setScreen('settings')}/>} 
    </main>
    {aiOpen && <aside className="ai-panel"><div className="panel-heading"><span><Sparkles size={17}/> AI 助手</span><button aria-label="收起 AI 侧栏" onClick={() => setAiOpen(false)}>×</button></div><div className="ai-empty"><Sparkles size={28}/><p>{settings.apiKeyConfigured || settings.aiProvider === 'mock' ? '打开论文、点子或草稿后，可在这里获取有出处的帮助。' : '尚未配置模型服务'}</p>{!settings.apiKeyConfigured && settings.aiProvider !== 'mock' && <button className="text-button" onClick={() => setScreen('settings')}>前往设置</button>}</div></aside>}
    {!aiOpen && <button className="ai-reopen" title="打开 AI 侧栏" onClick={() => setAiOpen(true)}><PanelRight size={18}/></button>}
  </div>;
}

function Home({ screen, status, onConfigure }: { screen: Screen; status: LibraryStatus; onConfigure: () => void }) {
  const labels: Record<Exclude<Screen, 'settings'>, string> = { library: '文献库', projects: '项目', search: '搜索' };
  if (!status.configured) return <section className="onboarding"><div className="onboarding-icon"><Database size={32}/></div><h1>先建立你的资料库</h1><p>AllPaper 将论文、笔记、点子和草稿保存在你选择的本地文件夹。文件保持开放格式，随时可迁走。</p><button className="primary" onClick={onConfigure}>选择资料库目录</button><small>可在设置中随时更改；API Key 可稍后再填。</small></section>;
  return <section className="empty-workspace"><div className="eyebrow">{labels[screen as Exclude<Screen, 'settings'>]}</div><h1>{screen === 'library' ? '你的研究资料库已准备就绪' : labels[screen as Exclude<Screen, 'settings'>]}</h1><p>{screen === 'library' ? `当前有 ${status.paperCount} 篇文献。可从“搜索”查找公开论文，或将 PDF、BibTeX、DOI 和 arXiv ID 导入。` : '此功能会在后续模块中随其真实工作流一并开放。'}</p>{screen === 'library' && <button className="secondary" onClick={() => window.allPaper.library.openPath(status.root!)}>在 Finder 中打开资料库</button>}</section>;
}
