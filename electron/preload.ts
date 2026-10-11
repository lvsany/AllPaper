import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { DesktopApi } from '../src/shared/types';

const api: DesktopApi = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (input) => ipcRenderer.invoke('settings:save', input),
    chooseLibrary: () => ipcRenderer.invoke('settings:choose-library')
  },
  library: {
    status: () => ipcRenderer.invoke('library:status'),
    rebuildIndex: () => ipcRenderer.invoke('library:rebuild-index'),
    openPath: (path) => ipcRenderer.invoke('library:open-path', path)
  },
  papers: {
    list: () => ipcRenderer.invoke('papers:list'), get: (id) => ipcRenderer.invoke('papers:get', id),
    importPdf: () => ipcRenderer.invoke('papers:import-pdf'), importBibtex: () => ipcRenderer.invoke('papers:import-bibtex'),
    update: (id, patch) => ipcRenderer.invoke('papers:update', id, patch), changeCitekey: (id, citekey) => ipcRenderer.invoke('papers:change-citekey', id, citekey),
    exportBibtex: (ids) => ipcRenderer.invoke('papers:export-bibtex', ids), importDroppedPdf: (path) => ipcRenderer.invoke('papers:import-dropped-pdf', path),
    importSearchRecord: (record) => ipcRenderer.invoke('papers:import-search-record', record),
    pathForFile: (file) => webUtils.getPathForFile(file)
  },
  search: { query: (query, online) => ipcRenderer.invoke('search:query', query, online) },
  window: { toggleAi: () => ipcRenderer.invoke('window:toggle-ai') }
};
contextBridge.exposeInMainWorld('allPaper', api);
