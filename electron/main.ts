import { app, BrowserWindow, dialog, ipcMain, shell, safeStorage } from 'electron';
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ensureLibraryLayout } from '../src/main/library-layout';
import { PaperStore } from '../src/main/paper-store';
import { searchAll } from '../src/main/adapters';
import { ProjectStore } from '../src/main/project-store';
import { citedPapers, draftToLatex } from '../src/core/latex';
import { MockAiProvider } from '../src/main/ai';
import { defaultSettings, type LibraryStatus, type Settings } from '../src/shared/types';

let mainWindow: BrowserWindow | undefined;
const execFileAsync = promisify(execFile);
const configPath = () => join(app.getPath('userData'), 'settings.json');
const usagePath = () => join(app.getPath('userData'), 'usage.json');
let settings: Settings = { ...defaultSettings };

type UsageFile = { month: string; byTask: Record<string, { calls: number; inputTokens: number; outputTokens: number; estimatedCost: number }> };
const currentMonth = () => new Date().toISOString().slice(0, 7);
async function usage(): Promise<UsageFile> {
  try { const parsed = JSON.parse(await readFile(usagePath(), 'utf8')) as UsageFile; return parsed.month === currentMonth() ? parsed : { month: currentMonth(), byTask: {} }; }
  catch { return { month: currentMonth(), byTask: {} }; }
}
async function recordUsage(task: string, input: string, output: string): Promise<void> {
  const data = await usage(); const current = data.byTask[task] ?? { calls: 0, inputTokens: 0, outputTokens: 0, estimatedCost: 0 };
  current.calls += 1; current.inputTokens += Math.ceil(input.length / 4); current.outputTokens += Math.ceil(output.length / 4);
  // Mock has no external bill. Real providers can later attach their returned usage here.
  data.byTask[task] = current; await mkdir(app.getPath('userData'), { recursive: true }); await writeFile(usagePath(), JSON.stringify(data, null, 2));
}

async function loadSettings(): Promise<Settings> {
  try {
    const raw = JSON.parse(await readFile(configPath(), 'utf8')) as Partial<Settings> & { encryptedApiKey?: string };
    settings = { ...defaultSettings, ...raw, apiKeyConfigured: Boolean(raw.encryptedApiKey) };
  } catch { settings = { ...defaultSettings }; }
  return settings;
}

async function saveSettings(input: Partial<Settings> & { apiKey?: string }): Promise<Settings> {
  const { apiKey, apiKeyConfigured: _hidden, ...visible } = input;
  const previous = existsSync(configPath()) ? JSON.parse(await readFile(configPath(), 'utf8')) as Record<string, unknown> : {};
  if (apiKey !== undefined) {
    if (apiKey) previous.encryptedApiKey = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(apiKey).toString('base64') : Buffer.from(apiKey).toString('base64');
    else delete previous.encryptedApiKey;
  }
  settings = { ...settings, ...visible, apiKeyConfigured: Boolean(previous.encryptedApiKey) };
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(configPath(), JSON.stringify({ ...previous, ...settings, apiKeyConfigured: undefined }, null, 2));
  if (settings.libraryPath) await ensureLibrary(settings.libraryPath);
  return settings;
}

function indexPath(root: string) { return join(root, '.index', 'allpaper.sqlite'); }
async function ensureLibrary(root: string): Promise<void> {
  await ensureLibraryLayout(root);
  const db = new Database(indexPath(root));
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS paper_index (id TEXT PRIMARY KEY, citekey TEXT UNIQUE, title TEXT, authors TEXT, abstract TEXT, body TEXT, updated_at TEXT);
    CREATE VIRTUAL TABLE IF NOT EXISTS paper_fts USING fts5(id UNINDEXED, title, authors, abstract, body, tokenize='trigram');
  `);
  db.close();
}

async function rebuildIndex(root: string): Promise<void> {
  await rm(join(root, '.index'), { recursive: true, force: true });
  await ensureLibrary(root);
  const papersRoot = join(root, 'papers');
  const db = new Database(indexPath(root));
  for (const entry of await readdir(papersRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const meta = JSON.parse(await readFile(join(papersRoot, entry.name, 'meta.json'), 'utf8')) as { id: string; citekey: string; title: string; authors?: unknown[]; abstract?: string };
      const content = JSON.parse(await readFile(join(papersRoot, entry.name, 'content.json'), 'utf8')) as { paragraphs?: Array<{ text?: string }> };
      const authors = (meta.authors ?? []).map((a) => typeof a === 'string' ? a : JSON.stringify(a)).join(', ');
      const body = (content.paragraphs ?? []).map((p) => p.text ?? '').join('\n');
      db.prepare('INSERT OR REPLACE INTO paper_index VALUES (?, ?, ?, ?, ?, ?, ?)').run(meta.id, meta.citekey, meta.title, authors, meta.abstract ?? '', body, new Date().toISOString());
      db.prepare('INSERT INTO paper_fts (id, title, authors, abstract, body) VALUES (?, ?, ?, ?, ?)').run(meta.id, meta.title, authors, meta.abstract ?? '', body);
    } catch { /* Incomplete imported paper is simply picked up when metadata becomes valid. */ }
  }
  db.close();
}

async function libraryStatus(): Promise<LibraryStatus> {
  if (!settings.libraryPath) return { configured: false, paperCount: 0, indexHealthy: false };
  await ensureLibrary(settings.libraryPath);
  const db = new Database(indexPath(settings.libraryPath), { readonly: true });
  const paperCount = (db.prepare('SELECT COUNT(*) AS total FROM paper_index').get() as { total: number }).total;
  db.close();
  return { configured: true, root: settings.libraryPath, paperCount, indexHealthy: true };
}
async function fullTextSearch(query:string){if(!settings.libraryPath)return [];await ensureLibrary(settings.libraryPath);const db=new Database(indexPath(settings.libraryPath),{readonly:true});const tokens=query.trim().split(/\s+/).filter(Boolean);let rows:any[]=[];try{rows=db.prepare(`SELECT id,title,highlight(paper_fts,4,'<b>','</b>') as excerpt FROM paper_fts WHERE paper_fts MATCH ? LIMIT 30`).all(tokens.join(' OR ')) as any[]}catch{rows=db.prepare(`SELECT id,title,substr(body,1,280) as excerpt FROM paper_index WHERE title LIKE ? OR abstract LIKE ? OR body LIKE ? LIMIT 30`).all(`%${query}%`,`%${query}%`,`%${query}%`) as any[]}db.close();return rows;}
function papers(): PaperStore {
  if (!settings.libraryPath) throw new Error('请先在设置中选择资料库目录');
  return new PaperStore(settings.libraryPath, async () => rebuildIndex(settings.libraryPath!), (task, input, output) => { void recordUsage(task, input, output); });
}
function projects():ProjectStore{if(!settings.libraryPath)throw new Error('请先选择资料库目录');return new ProjectStore(settings.libraryPath)}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 960, minHeight: 680,
    titleBarStyle: 'hiddenInset', backgroundColor: '#f7f6f2',
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  const url = process.env.VITE_DEV_SERVER_URL;
  if (url) void mainWindow.loadURL(url); else void mainWindow.loadFile(join(__dirname, '../dist/index.html'));
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.meta && input.shift && input.key.toLowerCase() === 'i') { event.preventDefault(); mainWindow?.webContents.send('shortcut:quick-idea'); }
    if (input.meta && input.key.toLowerCase() === 'k') { event.preventDefault(); mainWindow?.webContents.send('shortcut:command'); }
  });
}

app.whenReady().then(async () => {
  await loadSettings();
  if (settings.libraryPath) await ensureLibrary(settings.libraryPath);
  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:save', (_event, input) => saveSettings(input));
  ipcMain.handle('settings:choose-library', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], title: '选择 AllPaper 资料库目录' });
    if (result.canceled) return undefined;
    const chosen = result.filePaths[0];
    if (!chosen) return undefined;
    await saveSettings({ libraryPath: chosen });
    return chosen;
  });
  ipcMain.handle('library:status', libraryStatus);
  ipcMain.handle('library:rebuild-index', async () => { if (settings.libraryPath) await rebuildIndex(settings.libraryPath); });
  ipcMain.handle('library:backup', async () => {
    if (!settings.libraryPath) throw new Error('请先选择资料库目录');
    const date = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog({ title: '备份资料库', defaultPath: `AllPaperLibrary-${date}.zip`, filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }] });
    if (result.canceled || !result.filePath) return undefined;
    await execFileAsync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', settings.libraryPath, result.filePath]);
    return result.filePath;
  });
  ipcMain.handle('library:open-path', (_event, path) => shell.openPath(path));
  ipcMain.handle('library:full-text',(_e,query:string)=>fullTextSearch(query));
  ipcMain.handle('library:file-url', (_event,path:string)=>pathToFileURL(path).toString());
  ipcMain.handle('papers:list', () => papers().list());
  ipcMain.handle('papers:get', (_event, id: string) => papers().get(id));
  ipcMain.handle('papers:translations', (_event,id:string)=>papers().translations(id));
  ipcMain.handle('papers:translate', (_event,id:string,paragraphIds?:string[])=>papers().translate(id,paragraphIds));
  ipcMain.handle('papers:annotations',(_event,id:string)=>papers().annotations(id));
  ipcMain.handle('papers:annotate',(_event,id:string,paragraphId:string,color:string,comment?:string)=>papers().annotate(id,paragraphId,color,comment));
  ipcMain.handle('papers:note',(_event,id:string)=>papers().note(id));
  ipcMain.handle('papers:save-note',(_event,id:string,markdown:string)=>papers().saveNote(id,markdown));
  ipcMain.handle('papers:append-annotation-note',(_event,id:string,annotationId:string)=>papers().appendAnnotationToNote(id,annotationId));
  ipcMain.handle('papers:import-pdf', async () => {
    if (!settings.libraryPath) throw new Error('请先选择资料库目录');
    const result = await dialog.showOpenDialog({ title: '导入 PDF 论文', filters: [{ name: 'PDF', extensions: ['pdf'] }], properties: ['openFile'] });
    return result.canceled || !result.filePaths[0] ? undefined : papers().importPdf(result.filePaths[0]);
  });
  ipcMain.handle('papers:import-dropped-pdf', (_event, path: string) => papers().importPdf(path));
  ipcMain.handle('papers:import-search-record', (_event, record) => papers().importSearchRecord(record));
  ipcMain.handle('papers:import-bibtex', async () => {
    if (!settings.libraryPath) throw new Error('请先选择资料库目录');
    const result = await dialog.showOpenDialog({ title: '导入 BibTeX', filters: [{ name: 'BibTeX', extensions: ['bib'] }], properties: ['openFile'] });
    return result.canceled || !result.filePaths[0] ? undefined : papers().importBibtex(await readFile(result.filePaths[0], 'utf8'));
  });
  ipcMain.handle('papers:update', (_event, id: string, patch) => papers().update(id, patch));
  ipcMain.handle('papers:change-citekey', (_event, id: string, citekey: string) => papers().changeCitekey(id, citekey));
  ipcMain.handle('papers:export-bibtex', async (_event, ids?: string[]) => {
    if (!settings.libraryPath) throw new Error('请先选择资料库目录'); const result = await dialog.showSaveDialog({ title: '导出 BibTeX', defaultPath: 'allpaper.bib', filters: [{ name: 'BibTeX', extensions: ['bib'] }] });
    if (result.canceled || !result.filePath) return undefined; await writeFile(result.filePath, await papers().exportBibtex(ids)); return result.filePath;
  });
  ipcMain.handle('search:query', (_event, query: string, online?: boolean) => searchAll(query, Boolean(online)));
  ipcMain.handle('projects:list',()=>projects().list());ipcMain.handle('projects:create',(_e,name:string)=>projects().create(name));ipcMain.handle('projects:ideas',(_e,id:string)=>projects().ideas(id));ipcMain.handle('projects:create-idea',(_e,id:string,one:string)=>projects().createIdea(id,one));ipcMain.handle('projects:save-idea',(_e,id:string,idea)=>projects().saveIdea(id,idea));ipcMain.handle('projects:create-pilot',(_e,id:string,idea)=>projects().createPilot(id,idea));ipcMain.handle('projects:draft',(_e,id:string)=>projects().draft(id));ipcMain.handle('projects:save-draft',(_e,id:string,draft)=>projects().saveDraft(id,draft));ipcMain.handle('projects:export-latex',async(_e,id:string)=>{const d=await projects().draft(id);const result=await dialog.showSaveDialog({title:'导出 LaTeX 与引用',defaultPath:'paper.tex',filters:[{name:'LaTeX',extensions:['tex']}]});if(result.canceled||!result.filePath)return undefined;await writeFile(result.filePath,draftToLatex(d.blocks));const cited=citedPapers(d.blocks,await papers().list());const bibPath=result.filePath.replace(/\.tex$/i,'')+'.bib';await writeFile(bibPath,await papers().exportBibtex(cited.map(p=>p.id)));return result.filePath;});
  ipcMain.handle('ai:translate-writing',async(_e,text:string)=>{const translated=await new MockAiProvider().translate({id:'writing',paperId:'',order:0,type:'paragraph',html:'',text,sectionPath:[]},{});await recordUsage('双栏写作翻译',text,translated);return translated;});
  ipcMain.handle('usage:get', usage);
  ipcMain.handle('window:toggle-ai', () => mainWindow?.webContents.send('toggle-ai'));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
