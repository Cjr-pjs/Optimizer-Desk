const { contextBridge, ipcRenderer } = require('electron');

window.addEventListener("DOMContentLoaded", () => {
  const replaceText = (selector, text) => {
    const element = document.getElementById(selector);
    if (element) element.innerText = text;
  };

  for (const type of ["chrome", "node", "electron"]) {
    replaceText(`${type}-version`, process.versions[type]);
  }
});

contextBridge.exposeInMainWorld('api', {
  limparTemporarios: () => ipcRenderer.invoke('limpar-temporarios'),
  getRamUsage: () => ipcRenderer.invoke('get-ram-usage'),
  emptyTrash: () => ipcRenderer.invoke('empty-trash')
});