import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  openSettings: () => ipcRenderer.invoke('open-settings'),
  getBackendUrl: () => ipcRenderer.invoke('get-backend-url'),
  getWsUrl: () => ipcRenderer.invoke('get-ws-url'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  resizeWindow: (width: number, height: number) =>
    ipcRenderer.invoke('resize-window', width, height),
  quitApp: () => ipcRenderer.invoke('quit-app')
})