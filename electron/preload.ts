import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { DesktopApi } from '../src/shared/types';

const invoke = <T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>;

const api: DesktopApi = {
  settings: {
    get: () => invoke('settings:get'),
    save: (input) => invoke('settings:save', input),
    chooseLibrary: () => invoke('settings:choose-library')
  },
  library: {
    status: () => invoke('library:status'),
    rebuildIndex: () => invoke('library:rebuild-index'),
    backup: () => invoke('library:backup'),
    openPath: (path) => invoke('library:open-path', path),
    openExternal: (url) => invoke('library:open-external', url),
    fullText: (query) => invoke('library:full-text', query)
  },
  papers: {
    list: () => invoke('papers:list'),
    get: (id) => invoke('papers:get', id),
    importPdf: () => invoke('papers:import-pdf'),
    importBibtex: () => invoke('papers:import-bibtex'),
    importDroppedPdf: (path) => invoke('papers:import-dropped-pdf', path),
    importArxiv: (input) => invoke('papers:import-arxiv', input),
    fetchFullText: (id) => invoke('papers:fetch-full-text', id),
    fetchMissingFullTexts: () => invoke('papers:fetch-missing'),
    attachPdf: (id) => invoke('papers:attach-pdf', id),
    onImportProgress: (listener) => {
      const handler = (_event: unknown, payload: Parameters<typeof listener>[0]) => listener(payload);
      ipcRenderer.on('papers:import-progress', handler);
      return () => { ipcRenderer.removeListener('papers:import-progress', handler); };
    },
    importSearchRecord: (record) => invoke('papers:import-search-record', record),
    create: (input) => invoke('papers:create', input),
    remove: (id) => invoke('papers:remove', id),
    citedBy: (id) => invoke('papers:cited-by', id),
    update: (id, patch) => invoke('papers:update', id, patch),
    changeCitekey: (id, citekey) => invoke('papers:change-citekey', id, citekey),
    exportBibtex: (ids) => invoke('papers:export-bibtex', ids),
    translations: (id) => invoke('papers:translations', id),
    translate: (id, paragraphIds, force) => invoke('papers:translate', id, paragraphIds, force),
    onTranslation: (listener) => {
      const handler = (_event: unknown, payload: Parameters<typeof listener>[0]) => listener(payload);
      ipcRenderer.on('papers:translation', handler);
      return () => { ipcRenderer.removeListener('papers:translation', handler); };
    },
    annotations: (id) => invoke('papers:annotations', id),
    addAnnotation: (id, input) => invoke('papers:add-annotation', id, input),
    updateAnnotation: (id, annotationId, patch) => invoke('papers:update-annotation', id, annotationId, patch),
    deleteAnnotation: (id, annotationId) => invoke('papers:delete-annotation', id, annotationId),
    pathForFile: (file) => webUtils.getPathForFile(file)
  },
  search: { query: (query, online) => invoke('search:query', query, online) },
  projects: {
    list: () => invoke('projects:list'),
    create: (name) => invoke('projects:create', name),
    rename: (id, name) => invoke('projects:rename', id, name),
    remove: (id) => invoke('projects:remove', id),
    note: (id) => invoke('projects:note', id),
    saveNote: (id, markdown) => invoke('projects:save-note', id, markdown),
    appendNote: (id, markdown) => invoke('projects:append-note', id, markdown),
    draft: (id) => invoke('projects:draft', id),
    saveDraft: (id, draft) => invoke('projects:save-draft', id, draft),
    exportLatex: (id) => invoke('projects:export-latex', id)
  },
  ai: {
    status: () => invoke('ai:status'),
    test: () => invoke('ai:test'),
    ask: (request, onDelta) => {
      const requestId = crypto.randomUUID();
      const handler = (_event: unknown, payload: { requestId: string; text: string }) => { if (payload.requestId === requestId) onDelta(payload.text); };
      ipcRenderer.on('ai:delta', handler);
      const promise = invoke<string>('ai:ask', { ...request, requestId }).finally(() => ipcRenderer.removeListener('ai:delta', handler));
      return { promise, cancel: () => { void ipcRenderer.invoke('ai:cancel', requestId); } };
    },
    translateText: (text) => invoke('ai:translate-text', text),
    translateWriting: (text, context) => invoke('ai:translate-writing', text, context)
  },
  schedule: {
    list: () => invoke('schedule:list'),
    save: (events) => invoke('schedule:save', events)
  },
  memos: {
    list: () => invoke('memos:list'),
    save: (input) => invoke('memos:save', input),
    remove: (id) => invoke('memos:remove', id),
    reveal: (id) => invoke('memos:reveal', id),
    copySecret: (id) => invoke('memos:copy-secret', id)
  },
  usage: { get: () => invoke('usage:get') },
  events: {
    on: (channel, listener) => {
      const handler = () => listener();
      ipcRenderer.on(channel, handler);
      return () => { ipcRenderer.removeListener(channel, handler); };
    }
  }
};
contextBridge.exposeInMainWorld('allPaper', api);
