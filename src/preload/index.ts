import { contextBridge, ipcRenderer } from 'electron'

const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version')
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
