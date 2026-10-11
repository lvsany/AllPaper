import { useEffect, useState } from 'react';
import { BookOpen, Database, FolderKanban, PanelRight, Search, Settings as SettingsIcon, Sparkles } from 'lucide-react';
import type { LibraryStatus, Settings } from '../shared/types';
import { defaultSettings } from '../shared/types';
import { SettingsView } from './SettingsView';
import { LibraryView } from './LibraryView';
import { SearchView } from './SearchView';
import { ReaderView } from './ReaderView';
import { NoteView } from './NoteView';
import { ProjectView } from './ProjectView';
import type { Paper } from '../shared/types';
import type { Project } from '../shared/projects';

type Screen = 'library' | 'projects' | 'search' | 'settings' | 'reader' | 'note';

export function App() {
  const [screen, setScreen] = useState<Screen>('library');
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [status, setStatus] = useState<LibraryStatus>({ configured: false, paperCount: 0, indexHealthy: false });
  const [aiOpen, setAiOpen] = useState(true);
  const [reading,setReading]=useState<Paper>();
  const [commandOpen, setCommandOpen] = useState(false);
  const [quickIdeaOpen, setQuickIdeaOpen] = useState(false);
  const refresh = async () => { setSettings(await window.allPaper.settings.get()); setStatus(await window.allPaper.library.status()); };
  useEffect(() => { void refresh(); }, []);
  useEffect(() => { const command = () => setCommandOpen(true); const quickIdea = () => setQuickIdeaOpen(true); window.addEventListener('shortcut:command', command); window.addEventListener('shortcut:quick-idea', quickIdea); return () => { window.removeEventListener('shortcut:command', command); window.removeEventListener('shortcut:quick-idea', quickIdea); }; }, []);
  const nav = [
    ['library', BookOpen, '文献库'], ['projects', FolderKanban, '项目'], ['search', Search, '搜索'], ['settings', SettingsIcon, '设置']
  ] as const;
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">A</span><span>AllPaper</span></div>
      <nav>{nav.map(([id, Icon, label]) => <button key={id} className={screen === id ? 'nav-item active' : 'nav-item'} onClick={() => setScreen(id)}><Icon size={18}/>{label}</button>)}</nav>
      <div className="sidebar-foot"><button className="shortcut" onClick={() => setCommandOpen(true)}><span>命令面板</span><kbd>⌘ K</kbd></button><button className="shortcut" onClick={() => setQuickIdeaOpen(true)}><span>快速记点子</span><kbd>⌘ ⇧ I</kbd></button></div>
    </aside>
    <main className="workspace">
      {screen==='note'&&reading?<NoteView paper={reading} onBack={()=>setScreen('reader')}/>:screen==='reader'&&reading?<ReaderView paper={reading} onBack={()=>setScreen('library')} onNote={()=>setScreen('note')}/>:screen === 'settings' ? <SettingsView settings={settings} status={status} onSaved={refresh}/> : screen === 'projects' && status.configured?<ProjectView/>:screen === 'search' && status.configured ? <SearchView/> : screen === 'library' && status.configured ? <LibraryView onRead={(paper)=>{setReading(paper);setScreen('reader');}}/> : <Home screen={screen} status={status} onConfigure={() => setScreen('settings')}/>} 
    </main>
    {aiOpen && <aside className="ai-panel"><div className="panel-heading"><span><Sparkles size={17}/> AI 助手</span><button aria-label="收起 AI 侧栏" onClick={() => setAiOpen(false)}>×</button></div><div className="ai-empty"><Sparkles size={28}/><p>{settings.apiKeyConfigured || settings.aiProvider === 'mock' ? '打开论文、点子或草稿后，可在这里获取有出处的帮助。' : '尚未配置模型服务'}</p>{!settings.apiKeyConfigured && settings.aiProvider !== 'mock' && <button className="text-button" onClick={() => setScreen('settings')}>前往设置</button>}</div></aside>}
    {!aiOpen && <button className="ai-reopen" title="打开 AI 侧栏" onClick={() => setAiOpen(true)}><PanelRight size={18}/></button>}
    {commandOpen && <CommandPanel close={()=>setCommandOpen(false)} onSearch={()=>{setScreen('search');setCommandOpen(false);}} onOpenPaper={(paper)=>{setReading(paper);setScreen('reader');setCommandOpen(false);}} />}
    {quickIdeaOpen && <QuickIdea close={()=>setQuickIdeaOpen(false)} onSaved={()=>{setScreen('projects');setQuickIdeaOpen(false);}} />}
  </div>;
}

function CommandPanel({ close, onSearch, onOpenPaper }: { close:()=>void; onSearch:()=>void; onOpenPaper:(paper:Paper)=>void }) {
  const [query,setQuery]=useState(''); const [rows,setRows]=useState<Array<{id:string;title:string;excerpt:string}>>([]);
  useEffect(()=>{if(!query.trim()){setRows([]);return;}const timer=window.setTimeout(()=>void window.allPaper.library.fullText(query).then(setRows),120);return()=>window.clearTimeout(timer);},[query]);
  return <div className="overlay" role="dialog" aria-label="命令面板" onMouseDown={close}><div className="command-panel" onMouseDown={e=>e.stopPropagation()}><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索论文全文，或执行动作…"/><button className="command-action" onClick={onSearch}>搜索在线论文</button>{rows.map(row=><button key={row.id} className="command-result" onClick={async()=>{const bundle=await window.allPaper.papers.get(row.id);if(bundle)onOpenPaper(bundle.paper);}}><strong>{row.title}</strong><small dangerouslySetInnerHTML={{__html:row.excerpt}}/></button>)}{query&& !rows.length&&<p>没有本地匹配；可改用在线搜索。</p>}<kbd>Esc 关闭</kbd></div></div>;
}

function QuickIdea({ close, onSaved }: { close:()=>void; onSaved:()=>void }) {
  const [projects,setProjects]=useState<Project[]>([]);const [projectId,setProjectId]=useState('');const [text,setText]=useState('');const [saving,setSaving]=useState(false);
  useEffect(()=>{void window.allPaper.projects.list().then(items=>{setProjects(items);setProjectId(items[0]?.id??'');});},[]);
  const save=async()=>{if(!text.trim()||saving)return;setSaving(true);let id=projectId;if(!id){const inbox=await window.allPaper.projects.create('收集箱');id=inbox.id;}await window.allPaper.projects.createIdea(id,text.trim());onSaved();};
  return <div className="overlay" role="dialog" aria-label="快速记点子" onMouseDown={close}><div className="quick-idea-modal" onMouseDown={e=>e.stopPropagation()}><div className="eyebrow">快速记点子</div><h2>先留下它，稍后再展开。</h2><textarea autoFocus value={text} onChange={e=>setText(e.target.value)} placeholder="一句话记录研究想法…"/><label>存入项目<select value={projectId} onChange={e=>setProjectId(e.target.value)}>{projects.length?projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>):<option value="">收集箱（自动创建）</option>}</select></label><div><button className="secondary" onClick={close}>取消</button><button className="primary" onClick={()=>void save()} disabled={!text.trim()||saving}>{saving?'保存中…':'保存点子'}</button></div></div></div>;
}

function Home({ screen, status, onConfigure }: { screen: Screen; status: LibraryStatus; onConfigure: () => void }) {
  const labels: Record<'library'|'projects'|'search', string> = { library: '文献库', projects: '项目', search: '搜索' };
  if (!status.configured) return <section className="onboarding"><div className="onboarding-icon"><Database size={32}/></div><h1>先建立你的资料库</h1><p>AllPaper 将论文、笔记、点子和草稿保存在你选择的本地文件夹。文件保持开放格式，随时可迁走。</p><button className="primary" onClick={onConfigure}>选择资料库目录</button><small>可在设置中随时更改；API Key 可稍后再填。</small></section>;
  return <section className="empty-workspace"><div className="eyebrow">{labels[screen as 'library'|'projects'|'search']}</div><h1>{labels[screen as 'library'|'projects'|'search']}</h1><p>此功能会在后续模块中随其真实工作流一并开放。</p></section>;
}
