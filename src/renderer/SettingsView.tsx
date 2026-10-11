import { useState } from 'react';
import { Check, Database, Eye, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import type { LibraryStatus, Settings } from '../shared/types';

export function SettingsView({ settings, status, onSaved }: { settings: Settings; status: LibraryStatus; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState(settings); const [apiKey, setApiKey] = useState(''); const [saved, setSaved] = useState(false);
  const save = async () => { await window.allPaper.settings.save({ ...draft, apiKey: apiKey || undefined }); setApiKey(''); setSaved(true); await onSaved(); setTimeout(() => setSaved(false), 1600); };
  const choose = async () => { const chosen = await window.allPaper.settings.chooseLibrary(); if (chosen) { setDraft((v) => ({ ...v, libraryPath: chosen })); await onSaved(); } };
  return <section className="settings-page"><header><div><div className="eyebrow">偏好设置</div><h1>设置</h1></div><button className="primary" onClick={() => void save()}>{saved ? <><Check size={16}/> 已保存</> : '保存设置'}</button></header>
    <div className="settings-grid">
      <section className="settings-card"><h2><Database size={18}/> 资料库</h2><p>所有研究数据保留在本地；SQLite 索引位于可删除重建的 <code>.index</code> 中。</p><div className="path-box">{status.root ?? '尚未选择资料库目录'}</div><div className="row"><button className="secondary" onClick={() => void choose()}>选择资料库目录</button>{status.configured && <button className="secondary" onClick={async () => { await window.allPaper.library.rebuildIndex(); await onSaved(); }}><RefreshCw size={15}/> 重建索引</button>}</div></section>
      <section className="settings-card"><h2><KeyRound size={18}/> 模型服务</h2><p>使用 AI 时，相关论文内容、点子和草稿将发送给你配置的模型服务。密钥加密保存在 macOS 应用数据中，绝不写入资料库。</p><label>提供商<select value={draft.aiProvider} onChange={(e) => setDraft({ ...draft, aiProvider: e.target.value as Settings['aiProvider'] })}><option value="mock">Mock（离线演示）</option><option value="anthropic">Anthropic</option><option value="openai-compatible">OpenAI 兼容接口</option></select></label>
        {draft.aiProvider === 'openai-compatible' && <label>接口地址<input value={draft.aiBaseUrl ?? ''} placeholder="http://localhost:.../v1" onChange={(e) => setDraft({ ...draft, aiBaseUrl: e.target.value })}/></label>}
        {draft.aiProvider !== 'mock' && <label>API Key<input type="password" value={apiKey} placeholder={settings.apiKeyConfigured ? '已配置；留空则保持不变' : '输入后加密保存'} onChange={(e) => setApiKey(e.target.value)}/></label>}
        <div className="model-grid"><label>阅读翻译<input value={draft.aiModelTranslation} onChange={(e) => setDraft({ ...draft, aiModelTranslation: e.target.value })}/></label><label>论文写作<input value={draft.aiModelWriting} onChange={(e) => setDraft({ ...draft, aiModelWriting: e.target.value })}/></label><label>推理任务<input value={draft.aiModelReasoning} onChange={(e) => setDraft({ ...draft, aiModelReasoning: e.target.value })}/></label></div></section>
      <section className="settings-card"><h2><Eye size={18}/> 阅读与写作</h2><label>译文样式<select value={draft.translationStyle} onChange={(e) => setDraft({ ...draft, translationStyle: e.target.value as Settings['translationStyle'] })}><option value="muted">弱化颜色</option><option value="border">左侧竖线</option><option value="background">浅色底</option></select></label><label>自动翻译延迟（毫秒）<input type="number" min="0" step="100" value={draft.translationDelayMs} onChange={(e) => setDraft({ ...draft, translationDelayMs: Number(e.target.value) })}/></label><label>每月 AI 预算（美元）<input type="number" min="0" step="1" value={draft.monthlyBudget} onChange={(e) => setDraft({ ...draft, monthlyBudget: Number(e.target.value) })}/></label></section>
      <section className="settings-card"><h2><ShieldCheck size={18}/> 隐私与离线</h2><p>AllPaper 不含遥测或云同步。未配置 API Key 时，本地阅读、批注、笔记、检索与中文草稿编辑仍可使用；AI 入口会明确说明未配置状态。</p><p>术语表、提示词和用量统计将随着对应功能模块保存于本地资料库。</p></section>
    </div>
  </section>;
}
