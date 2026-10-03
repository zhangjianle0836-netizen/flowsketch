const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('flowAPI', {
  openFlow: () => ipcRenderer.invoke('flow:open'),
  activateOpenedFlow: (requestId) => ipcRenderer.invoke('flow:activate-open', requestId),
  saveFlow: (document, session, saveAs = false) => ipcRenderer.invoke('flow:save', { document, session, saveAs }),
  autosaveFlow: (document, session) => ipcRenderer.invoke('flow:autosave', { document, session }),
  loadRecovery: () => ipcRenderer.invoke('flow:load-recovery'),
  newFlow: () => ipcRenderer.invoke('flow:new'),
  exportMarkdown: (content, title) => ipcRenderer.invoke('flow:export-markdown', { content, title }),
  exportImage: (dataUrl, format, title) => ipcRenderer.invoke('flow:export-image', { dataUrl, format, title }),
  getTheme: () => ipcRenderer.invoke('theme:get'),
  onThemeChange: (callback) => {
    const listener = (_event, theme) => callback(theme);
    ipcRenderer.on('theme:changed', listener);
    return () => ipcRenderer.removeListener('theme:changed', listener);
  },
  onPrepareClose: (callback) => {
    const listener = () => {
      Promise.resolve().then(callback)
        .then(() => ipcRenderer.send('flow:close-ready', true))
        .catch(() => ipcRenderer.send('flow:close-ready', false));
    };
    ipcRenderer.on('flow:prepare-close', listener);
    return () => ipcRenderer.removeListener('flow:prepare-close', listener);
  }
});
