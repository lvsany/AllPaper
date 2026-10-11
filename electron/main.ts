import { app, BrowserWindow, dialog, ipcMain, shell, safeStorage } from 'electron';
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureLibraryLayout } from '../src/main/library-layout';
import { defaultSettings, type LibraryStatus, type Settings } from '../src/shared/types';

let mainWindow: BrowserWindow | undefined;
const configPath = () => join(app.getPath('userData'), 'settings.json');
let settings: Settings = { ...defaultSettings };

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
  ipcMain.handle('library:open-path', (_event, path) => shell.openPath(path));
  ipcMain.handle('window:toggle-ai', () => mainWindow?.webContents.send('toggle-ai'));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
