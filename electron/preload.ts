import { contextBridge, ipcRenderer } from 'electron';
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
  window: { toggleAi: () => ipcRenderer.invoke('window:toggle-ai') }
};
contextBridge.exposeInMainWorld('allPaper', api);
