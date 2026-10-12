import { app, BrowserWindow, clipboard, dialog, ipcMain, net, protocol, safeStorage, shell } from 'electron';
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ensureLibraryLayout } from '../src/main/library-layout';
import { PaperStore } from '../src/main/paper-store';
import { searchAll } from '../src/main/adapters';
import { ProjectStore } from '../src/main/project-store';
import { ScheduleStore } from '../src/main/schedule-store';
import { MemoStore } from '../src/main/memo-store';
import { citedPapers, draftToLatex } from '../src/core/latex';
import { createProvider, MockProvider, AiError, type AiProvider, type Completion } from '../src/main/ai';
import { runAssistant, searchQueries, translateText, translateWriting, type AssistantDeps } from '../src/main/assistant';
import { DEFAULT_GLOSSARY, parseGlossary } from '../src/core/prompts';
import { defaultSettings, type AssistantRequest, type LibraryStatus, type Settings } from '../src/shared/types';

protocol.registerSchemesAsPrivileged([{ scheme: 'allpaper', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false } }]);

let mainWindow: BrowserWindow | undefined;
const execFileAsync = promisify(execFile);
const configPath = () => join(app.getPath('userData'), 'settings.json');
const usagePath = () => join(app.getPath('userData'), 'usage.json');
let settings: Settings = { ...defaultSettings };
const useMock = () => process.env.ALLPAPER_AI === 'mock';

// ---- usage ----------------------------------------------------------------

type UsageFile = { month: string; byTask: Record<string, { calls: number; inputTokens: number; outputTokens: number; estimatedCost: number }> };
const currentMonth = () => new Date().toISOString().slice(0, 7);
async function usage(): Promise<UsageFile> {
  try {
    const parsed = JSON.parse(await readFile(usagePath(), 'utf8')) as UsageFile;
    return parsed.month === currentMonth() ? parsed : { month: currentMonth(), byTask: {} };
  } catch { return { month: currentMonth(), byTask: {} }; }
}
let usageChain: Promise<void> = Promise.resolve();
function recordUsage(task: string, completion: Pick<Completion, 'inputTokens' | 'outputTokens'>): void {
  usageChain = usageChain.then(async () => {
    const data = await usage();
    const item = data.byTask[task] ?? { calls: 0, inputTokens: 0, outputTokens: 0, estimatedCost: 0 };
    item.calls += 1;
    item.inputTokens += completion.inputTokens;
    item.outputTokens += completion.outputTokens;
    data.byTask[task] = item;
    await mkdir(app.getPath('userData'), { recursive: true });
    await writeFile(usagePath(), JSON.stringify(data, null, 2));
    mainWindow?.webContents.send('usage:changed');
  }).catch(() => undefined);
}

// ---- settings and secrets -------------------------------------------------

async function readRawSettings(): Promise<Record<string, unknown>> {
  try { return JSON.parse(await readFile(configPath(), 'utf8')) as Record<string, unknown>; } catch { return {}; }
}
function decodeKey(encoded: unknown): string | undefined {
  if (typeof encoded !== 'string' || !encoded) return undefined;
  const buffer = Buffer.from(encoded, 'base64');
  try { return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buffer) : buffer.toString('utf8'); } catch { return undefined; }
}
async function apiKey(): Promise<string | undefined> { return decodeKey((await readRawSettings()).encryptedApiKey); }

function publicSettings(raw: Record<string, unknown>): Settings {
  const merged = { ...defaultSettings, ...raw } as Settings & { aiProvider: string };
  // Earlier builds offered a "mock" provider that only did dictionary substitution; it no longer exists.
  const aiProvider = merged.aiProvider === 'openai-compatible' ? 'openai-compatible' : 'anthropic';
  // earlier builds had one price pair for everything
  if (!raw.prices && (raw.priceInPerMTok || raw.priceOutPerMTok)) {
    const pair = { input: Number(raw.priceInPerMTok) || 0, output: Number(raw.priceOutPerMTok) || 0 };
    merged.prices = { translate: pair, write: pair, reason: pair };
  }
  const keyConfigured = Boolean(raw.encryptedApiKey);
  const aiConfigured = useMock() || (aiProvider === 'anthropic' ? keyConfigured : keyConfigured || Boolean(merged.aiBaseUrl?.trim()));
  return { ...merged, aiProvider, apiKeyConfigured: keyConfigured, aiConfigured, aiMock: useMock() };
}

async function loadSettings(): Promise<Settings> {
  settings = publicSettings(await readRawSettings());
  return settings;
}

async function saveSettings(input: Partial<Settings> & { apiKey?: string }): Promise<Settings> {
  const { apiKey: newKey, apiKeyConfigured: _a, aiConfigured: _b, aiMock: _c, ...visible } = input;
  const raw = await readRawSettings();
  if (newKey !== undefined) {
    if (newKey) raw.encryptedApiKey = (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(newKey) : Buffer.from(newKey)).toString('base64');
    else delete raw.encryptedApiKey;
  }
  const next = { ...raw, ...visible };
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(configPath(), JSON.stringify(next, null, 2));
  settings = publicSettings(next);
  if (settings.libraryPath) await ensureLibrary(settings.libraryPath);
  return settings;
}

// ---- AI wiring ------------------------------------------------------------

let aiProvider: AiProvider | undefined;
/** Rebuilds the model client; called at start-up and whenever settings change. */
async function refreshProvider(): Promise<void> {
  aiProvider = useMock() ? new MockProvider() : createProvider({ provider: settings.aiProvider, baseUrl: settings.aiBaseUrl, apiKey: await apiKey() });
}
const provider = async () => aiProvider;
const glossaryText = () => settings.glossary.trim() || DEFAULT_GLOSSARY;

async function assistantDeps(): Promise<AssistantDeps> {
  const p = await provider();
  return {
    provider: p,
    models: { translate: settings.aiModelTranslation, write: settings.aiModelWriting, reason: settings.aiModelReasoning },
    glossary: glossaryText(),
    loadPaper: (id) => papers().get(id),
    loadProject: async (id) => {
      const project = (await projects().list()).find((item) => item.id === id);
      return project ? { name: project.name, note: await projects().note(id) } : undefined;
    },
    usage: recordUsage
  };
}

// ---- library --------------------------------------------------------------

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
      const content = JSON.parse(await readFile(join(papersRoot, entry.name, 'content.json'), 'utf8')) as { paragraphs?: Array<{ text?: string; type?: string }> };
      const authors = (meta.authors ?? []).map((a) => typeof a === 'string' ? a : JSON.stringify(a)).join(', ');
      const body = (content.paragraphs ?? []).filter((p) => p.type !== 'references').map((p) => p.text ?? '').join('\n');
      db.prepare('INSERT OR REPLACE INTO paper_index VALUES (?, ?, ?, ?, ?, ?, ?)').run(meta.id, meta.citekey, meta.title, authors, meta.abstract ?? '', body, new Date().toISOString());
      db.prepare('INSERT INTO paper_fts (id, title, authors, abstract, body) VALUES (?, ?, ?, ?, ?)').run(meta.id, meta.title, authors, meta.abstract ?? '', body);
    } catch { /* an incomplete import is picked up once its metadata is valid */ }
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

async function fullTextSearch(query: string) {
  if (!settings.libraryPath || !query.trim()) return [];
  await ensureLibrary(settings.libraryPath);
  const db = new Database(indexPath(settings.libraryPath), { readonly: true });
  const tokens = query.trim().split(/\s+/).filter(Boolean).map((t) => `"${t.replace(/"/g, '""')}"`);
  let rows: Array<{ id: string; title: string; excerpt: string }> = [];
  try {
    rows = db.prepare(`SELECT id, title, snippet(paper_fts, 4, '<b>', '</b>', '…', 24) AS excerpt FROM paper_fts WHERE paper_fts MATCH ? LIMIT 30`).all(tokens.join(' OR ')) as typeof rows;
  } catch {
    const like = `%${query}%`;
    rows = db.prepare(`SELECT id, title, substr(body, 1, 280) AS excerpt FROM paper_index WHERE title LIKE ? OR abstract LIKE ? OR body LIKE ? LIMIT 30`).all(like, like, like) as typeof rows;
  }
  db.close();
  return rows.map((row) => ({ ...row, excerpt: row.excerpt.replace(/<(?!\/?b>)[^>]*>/g, '') }));
}

let paperStore: { root: string; store: PaperStore } | undefined;
function papers(): PaperStore {
  const root = settings.libraryPath;
  if (!root) throw new Error('请先在设置中选择资料库目录');
  if (paperStore?.root !== root) {
    paperStore = {
      root,
      store: new PaperStore({
        root,
        onChanged: () => rebuildIndex(root),
        ai: () => aiProvider ? { provider: aiProvider, model: settings.aiModelTranslation, glossary: parseGlossary(glossaryText()) } : undefined,
        onUsage: recordUsage
      })
    };
  }
  return paperStore.store;
}
function memos(): MemoStore {
  if (!settings.libraryPath) throw new Error('请先选择资料库目录');
  return new MemoStore(settings.libraryPath, join(app.getPath('userData'), 'secrets.json'), {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value) => safeStorage.encryptString(value).toString('base64'),
    decrypt: (encoded) => safeStorage.decryptString(Buffer.from(encoded, 'base64'))
  });
}
function schedule(): ScheduleStore {
  if (!settings.libraryPath) throw new Error('请先选择资料库目录');
  return new ScheduleStore(settings.libraryPath);
}

function projects(): ProjectStore {
  if (!settings.libraryPath) throw new Error('请先选择资料库目录');
  return new ProjectStore(settings.libraryPath);
}

function safeAssetPath(url: string): string | undefined {
  if (!settings.libraryPath) return undefined;
  const parsed = new URL(url);
  const relative = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
  const root = join(settings.libraryPath, 'papers');
  const full = normalize(join(root, relative));
  return full.startsWith(root + sep) ? full : undefined;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 960, minHeight: 680,
    titleBarStyle: 'hiddenInset', backgroundColor: '#f7f6f2',
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  const url = process.env.VITE_DEV_SERVER_URL;
  if (url) void mainWindow.loadURL(url); else void mainWindow.loadFile(join(__dirname, '../dist/index.html'));
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/i.test(target)) void shell.openExternal(target);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (/^https?:/i.test(target) && !target.startsWith('http://127.0.0.1:5173')) { event.preventDefault(); void shell.openExternal(target); }
  });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.meta && input.shift && input.key.toLowerCase() === 'i') { event.preventDefault(); mainWindow?.webContents.send('shortcut:quick-idea'); }
    if (input.meta && !input.shift && input.key.toLowerCase() === 'k') { event.preventDefault(); mainWindow?.webContents.send('shortcut:command'); }
  });
}

const askControllers = new Map<string, AbortController>();

app.whenReady().then(async () => {
  await loadSettings();
  await refreshProvider();
  if (settings.libraryPath) await ensureLibrary(settings.libraryPath);

  protocol.handle('allpaper', async (request) => {
    const file = safeAssetPath(request.url);
    if (!file || !existsSync(file)) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  const send = (channel: string, payload: unknown) => mainWindow?.webContents.send(channel, payload);
  const needLibrary = () => { if (!settings.libraryPath) throw new Error('请先选择资料库目录'); return settings.libraryPath; };

  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:save', async (_e, input) => {
    const saved = await saveSettings(input);
    await refreshProvider();
    return saved;
  });
  ipcMain.handle('settings:choose-library', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], title: '选择 AllPaper 资料库目录' });
    const chosen = result.canceled ? undefined : result.filePaths[0];
    if (!chosen) return undefined;
    await saveSettings({ libraryPath: chosen });
    return chosen;
  });

  ipcMain.handle('library:status', libraryStatus);
  ipcMain.handle('library:rebuild-index', async () => { if (settings.libraryPath) { await rebuildIndex(settings.libraryPath); papers().invalidate(); } });
  ipcMain.handle('library:backup', async () => {
    const root = needLibrary();
    const date = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog({ title: '备份资料库', defaultPath: `AllPaperLibrary-${date}.zip`, filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }] });
    if (result.canceled || !result.filePath) return undefined;
    await execFileAsync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', root, result.filePath]);
    return result.filePath;
  });
  ipcMain.handle('library:open-path', (_e, path: string) => shell.openPath(path));
  ipcMain.handle('library:open-external', (_e, url: string) => { if (/^https?:\/\//i.test(url)) return shell.openExternal(url); });
  ipcMain.handle('library:full-text', (_e, query: string) => fullTextSearch(query));

  ipcMain.handle('papers:list', () => papers().list());
  ipcMain.handle('papers:get', (_e, id: string) => papers().get(id));
  ipcMain.handle('papers:translations', (_e, id: string) => papers().translations(id));
  ipcMain.handle('papers:translate', async (_e, id: string, paragraphIds?: string[], force?: boolean) => {
    try {
      return await papers().translate(id, paragraphIds, { force, onEntry: (paragraphId, zh) => send('papers:translation', { paperId: id, paragraphId, zh }) });
    } catch (error) {
      if (error instanceof AiError) return { translations: {}, failed: paragraphIds ?? [], error: error.message };
      throw error;
    }
  });
  ipcMain.handle('papers:annotations', (_e, id: string) => papers().annotations(id));
  ipcMain.handle('papers:add-annotation', (_e, id: string, input) => papers().addAnnotation(id, input));
  ipcMain.handle('papers:update-annotation', (_e, id: string, annotationId: string, patch) => papers().updateAnnotation(id, annotationId, patch));
  ipcMain.handle('papers:delete-annotation', (_e, id: string, annotationId: string) => papers().deleteAnnotation(id, annotationId));
  ipcMain.handle('papers:import-pdf', async () => {
    needLibrary();
    const result = await dialog.showOpenDialog({ title: '导入 PDF 论文', filters: [{ name: 'PDF', extensions: ['pdf'] }], properties: ['openFile'] });
    return result.canceled || !result.filePaths[0] ? undefined : papers().importPdf(result.filePaths[0]);
  });
  ipcMain.handle('papers:import-dropped-pdf', (_e, path: string) => papers().importPdf(path));
  ipcMain.handle('papers:import-arxiv', (_e, input: string) => papers().importArxiv(input, (message) => send('papers:import-progress', { message })));
  ipcMain.handle('papers:fetch-full-text', (_e, id: string) => papers().fetchFullText(id, (message) => send('papers:import-progress', { message })));
  ipcMain.handle('papers:fetch-missing', () => papers().fetchMissingFullTexts((progress) => send('papers:import-progress', progress)));
  ipcMain.handle('papers:attach-pdf', async (_e, id: string) => {
    const result = await dialog.showOpenDialog({ title: '选择这篇论文的 PDF', filters: [{ name: 'PDF', extensions: ['pdf'] }], properties: ['openFile'] });
    return result.canceled || !result.filePaths[0] ? undefined : papers().attachPdf(id, result.filePaths[0]);
  });
  ipcMain.handle('papers:import-search-record', (_e, record) => papers().importSearchRecord(record));
  ipcMain.handle('papers:import-bibtex', async () => {
    needLibrary();
    const result = await dialog.showOpenDialog({ title: '导入 BibTeX', filters: [{ name: 'BibTeX', extensions: ['bib'] }], properties: ['openFile'] });
    return result.canceled || !result.filePaths[0] ? undefined : papers().importBibtex(await readFile(result.filePaths[0], 'utf8'), (progress) => send('papers:import-progress', progress));
  });
  ipcMain.handle('papers:update', (_e, id: string, patch) => papers().update(id, patch));
  ipcMain.handle('papers:change-citekey', (_e, id: string, citekey: string) => papers().changeCitekey(id, citekey));
  ipcMain.handle('papers:export-bibtex', async (_e, ids?: string[]) => {
    needLibrary();
    const result = await dialog.showSaveDialog({ title: '导出 BibTeX', defaultPath: 'allpaper.bib', filters: [{ name: 'BibTeX', extensions: ['bib'] }] });
    if (result.canceled || !result.filePath) return undefined;
    await writeFile(result.filePath, await papers().exportBibtex(ids));
    return result.filePath;
  });

  ipcMain.handle('search:query', async (_e, query: string, online = true) => {
    const queries = [query.trim()];
    const extra: string[] = [];
    if (online && settings.aiConfigured) {
      try { extra.push(...await searchQueries(await assistantDeps(), query)); } catch { /* fall back to the raw query */ }
    }
    const all = [...new Set([...queries, ...extra])].filter(Boolean);
    const outcome = await searchAll(all);
    const known = await papers().list();
    const results = outcome.results.map((r) => ({ ...r, inLibrary: known.some((p) => (r.arxivId && p.arxivId === r.arxivId) || (r.doi && p.doi === r.doi) || p.title.toLowerCase() === r.title.toLowerCase()) }));
    return { results, queries: all, errors: outcome.errors };
  });

  ipcMain.handle('projects:list', () => projects().list());
  ipcMain.handle('projects:create', (_e, name: string) => projects().create(name));
  ipcMain.handle('projects:note', (_e, id: string) => projects().note(id));
  ipcMain.handle('projects:save-note', (_e, id: string, markdown: string) => projects().saveNote(id, markdown));
  ipcMain.handle('projects:append-note', async (_e, id: string, markdown: string) => { await projects().appendToNote(id, markdown); });
  ipcMain.handle('projects:draft', (_e, id: string) => projects().draft(id));
  ipcMain.handle('projects:save-draft', (_e, id: string, draft) => projects().saveDraft(id, draft));
  ipcMain.handle('projects:export-latex', async (_e, id: string) => {
    const draft = await projects().draft(id);
    const result = await dialog.showSaveDialog({ title: '导出 LaTeX 与引用', defaultPath: 'paper.tex', filters: [{ name: 'LaTeX', extensions: ['tex'] }] });
    if (result.canceled || !result.filePath) return undefined;
    await writeFile(result.filePath, draftToLatex(draft.blocks));
    const cited = citedPapers(draft.blocks, await papers().list());
    await writeFile(result.filePath.replace(/\.tex$/i, '') + '.bib', await papers().exportBibtex(cited.map((p) => p.id)));
    return result.filePath;
  });

  ipcMain.handle('ai:status', () => ({ configured: settings.aiConfigured, provider: settings.aiProvider, mock: settings.aiMock }));
  ipcMain.handle('ai:test', async () => {
    const p = await provider();
    if (!p) return { ok: false, message: '尚未填写 API Key 或接口地址。' };
    try {
      const started = Date.now();
      const reply = await p.complete({ model: settings.aiModelTranslation, messages: [{ role: 'user', content: 'Reply with the single word: ok' }], maxTokens: 16 });
      return { ok: true, message: `连接成功（${Date.now() - started} ms），模型回复：${reply.text.trim().slice(0, 40) || '（空）'}` };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('ai:ask', async (event, request: AssistantRequest) => {
    const controller = new AbortController();
    askControllers.set(request.requestId, controller);
    try {
      return await runAssistant(await assistantDeps(), request, (text) => event.sender.send('ai:delta', { requestId: request.requestId, text }), controller.signal);
    } finally { askControllers.delete(request.requestId); }
  });
  ipcMain.handle('ai:cancel', (_e, requestId: string) => { askControllers.get(requestId)?.abort(); });
  ipcMain.handle('ai:translate-text', async (_e, text: string) => translateText(await assistantDeps(), text));
  ipcMain.handle('ai:translate-writing', async (_e, text: string, context) => translateWriting(await assistantDeps(), text, context));
  ipcMain.handle('schedule:list', () => schedule().list());
  ipcMain.handle('schedule:save', (_e, events) => schedule().save(events));
  ipcMain.handle('memos:list', () => memos().list());
  ipcMain.handle('memos:save', (_e, input) => memos().save(input));
  ipcMain.handle('memos:remove', (_e, id: string) => memos().remove(id));
  ipcMain.handle('memos:reveal', (_e, id: string) => memos().reveal(id));
  ipcMain.handle('memos:copy-secret', async (_e, id: string) => {
    const value = await memos().reveal(id);
    await clipboard.writeText(value);
    setTimeout(() => {
      void (async () => { if (await clipboard.readText() === value) await clipboard.clear(); })();
    }, 30_000);
  });
  ipcMain.handle('usage:get', usage);

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
