import type { DepCleanApi } from '../src/ipc-types.js';

const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

const api: DepCleanApi = {
  settings: {
    get: () => ipcRenderer.invoke('settings.get'),
    update: (partial) => ipcRenderer.invoke('settings.update', partial),
  },
  scan: {
    runManual: (paths) => ipcRenderer.invoke('scan.runManual', paths),
    runSet: (setId) => ipcRenderer.invoke('scan.runSet', setId),
    getLastResult: () => ipcRenderer.invoke('scan.getLastResult'),
    onProgress: (listener) => {
      const wrapped = (_event: unknown, payload: unknown) => listener(payload as Parameters<typeof listener>[0]);
      ipcRenderer.on('scan.progress', wrapped);
      return () => ipcRenderer.removeListener('scan.progress', wrapped);
    },
    onCompleted: (listener) => {
      const wrapped = (_event: unknown, payload: unknown) => listener(payload as Parameters<typeof listener>[0]);
      ipcRenderer.on('scan.completed', wrapped);
      return () => ipcRenderer.removeListener('scan.completed', wrapped);
    },
  },
  watch: {
    start: () => ipcRenderer.invoke('watch.start'),
    stop: () => ipcRenderer.invoke('watch.stop'),
    status: () => ipcRenderer.invoke('watch.status'),
    onStatusChanged: (listener) => {
      const wrapped = (_event: unknown, payload: unknown) => listener(payload as Parameters<typeof listener>[0]);
      ipcRenderer.on('watch.status.changed', wrapped);
      return () => ipcRenderer.removeListener('watch.status.changed', wrapped);
    },
  },
  alerts: {
    list: (options) => ipcRenderer.invoke('alerts.list', options),
    markRead: (ids) => ipcRenderer.invoke('alerts.markRead', ids),
    clear: () => ipcRenderer.invoke('alerts.clear'),
    onCreated: (listener) => {
      const wrapped = (_event: unknown, payload: unknown) => listener(payload as Parameters<typeof listener>[0]);
      ipcRenderer.on('alerts.created', wrapped);
      return () => ipcRenderer.removeListener('alerts.created', wrapped);
    },
  },
  cleanup: {
    preview: (paths) => ipcRenderer.invoke('cleanup.preview', paths),
    confirmDelete: (approvalId, selectedPaths) =>
      ipcRenderer.invoke('cleanup.confirmDelete', approvalId, selectedPaths),
  },
  folders: {
    pickMany: () => ipcRenderer.invoke('folders.pick'),
  },
};

contextBridge.exposeInMainWorld('depClean', api);
