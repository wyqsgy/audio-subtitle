import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  openSettings: () => ipcRenderer.invoke('open-settings'),
  getBackendUrl: () => ipcRenderer.invoke('get-backend-url'),
  getWsUrl: () => ipcRenderer.invoke('get-ws-url'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  showWindow: () => ipcRenderer.invoke('show-window'),
  resizeWindow: (width: number, height: number) =>
    ipcRenderer.invoke('resize-window', width, height),
  saveWindowPosition: (x: number, y: number) =>
    ipcRenderer.invoke('save-window-position', x, y),
  getWindowPosition: () => ipcRenderer.invoke('get-window-position'),
  quitApp: () => ipcRenderer.invoke('quit-app')
})