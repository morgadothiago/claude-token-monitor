'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Minimal, explicit surface exposed to the renderer. No direct Node/Electron
// object is ever handed over — only this one read-only async function.
contextBridge.exposeInMainWorld('tokenMonitorAPI', {
  scanSessions: () => ipcRenderer.invoke('tokens:scan'),
});
