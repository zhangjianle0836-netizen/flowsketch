const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('flowAPI', {
  openFlow: () => ipcRenderer.invoke('flow:open'),
  saveFlow: (document, saveAs = false) => ipcRenderer.invoke('flow:save', { document, saveAs }),
  autosaveFlow: (document) => ipcRenderer.invoke('flow:autosave', document),
  loadRecovery: () => ipcRenderer.invoke('flow:load-recovery'),
  newFlow: () => ipcRenderer.invoke('flow:new'),
  exportMarkdown: (content, title) => ipcRenderer.invoke('flow:export-markdown', { content, title }),
  exportImage: (dataUrl, format, title) => ipcRenderer.invoke('flow:export-image', { dataUrl, format, title }),
  getTheme: () => ipcRenderer.invoke('theme:get'),
  onThemeChange: (callback) => {
    const listener = (_event, theme) => callback(theme);
    ipcRenderer.on('theme:changed', listener);
    return () => ipcRenderer.removeListener('theme:changed', listener);
  }
});
