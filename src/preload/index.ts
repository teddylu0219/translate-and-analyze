import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AiError, AiRequest, AuthStatus, DocData, DocMeta, ModelInfo, Settings, UpdateStatus } from '../shared/types'

type Result<T> = { ok: true; value: T } | { ok: false; code: string; message: string }

/** 把 main 回傳的 { ok, ... } 轉回 Promise 的 resolve / reject */
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const r = (await ipcRenderer.invoke(channel, ...args)) as Result<T>
  if (r.ok) return r.value
  throw { code: r.code, message: r.message }
}

interface AiHandlers {
  onDelta: (text: string) => void
  onDone: (text: string) => void
  onError: (err: AiError) => void
}

const aiHandlers = new Map<string, AiHandlers>()
ipcRenderer.on('ai:delta', (_e, id: string, d: string) => aiHandlers.get(id)?.onDelta(d))
ipcRenderer.on('ai:done', (_e, id: string, t: string) => {
  aiHandlers.get(id)?.onDone(t)
  aiHandlers.delete(id)
})
ipcRenderer.on('ai:error', (_e, id: string, err: AiError) => {
  aiHandlers.get(id)?.onError(err)
  aiHandlers.delete(id)
})

const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:openExternal', url),
  pathForFile: (file: File): string => webUtils.getPathForFile(file),

  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:update', patch),

  authStatus: () => call<AuthStatus>('auth:status'),
  signIn: () => call<AuthStatus>('auth:signIn'),
  cancelSignIn: (): Promise<void> => ipcRenderer.invoke('auth:cancelSignIn'),
  signOut: () => call<AuthStatus>('auth:signOut'),
  setApiKey: (key: string) => call<AuthStatus>('auth:setApiKey', key),

  listModels: () => call<ModelInfo[]>('ai:models'),
  aiStart: (id: string, req: AiRequest, handlers: AiHandlers): void => {
    aiHandlers.set(id, handlers)
    ipcRenderer.send('ai:start', id, req)
  },
  aiCancel: (id: string): void => ipcRenderer.send('ai:cancel', id),

  listDocs: () => call<DocMeta[]>('lib:list'),
  importDocs: (paths: string[]) => call<DocMeta[]>('lib:import', paths),
  pickDocs: () => call<DocMeta[]>('lib:pick'),
  readDoc: (id: string) => call<Uint8Array>('lib:read', id),
  touchDoc: (id: string) => call<void>('lib:touch', id),
  renameDoc: (id: string, title: string) => call<void>('lib:rename', id, title),
  removeDoc: (id: string) => call<void>('lib:remove', id),
  setThumb: (id: string, thumb: string) => call<void>('lib:setThumb', id, thumb),
  getDocData: (id: string) => call<DocData>('lib:getData', id),
  saveDocData: (id: string, data: DocData) => call<void>('lib:saveData', id, data),
  exportMarkdown: (title: string, md: string) => call<string | null>('lib:exportMarkdown', title, md),

  updateStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:status'),
  checkUpdate: (): Promise<void> => ipcRenderer.invoke('update:check'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (cb: (s: UpdateStatus) => void): (() => void) => {
    const fn = (_e: unknown, s: UpdateStatus): void => cb(s)
    ipcRenderer.on('update:status', fn)
    return () => ipcRenderer.removeListener('update:status', fn)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
