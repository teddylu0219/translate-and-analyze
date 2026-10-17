import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import * as auth from './auth'
import * as ai from './ai'
import * as library from './library'
import { getSettings, updateSettings } from './store'
import { checkForUpdates, getUpdateStatus, initUpdater, installUpdate } from './updater'
import type { AiRequest, DocData, Settings } from '../shared/types'

if (process.env.TA_USER_DATA) app.setPath('userData', process.env.TA_USER_DATA)

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: 'Translate and Analyze',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1b1a' : '#f7f7f5',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // 外部連結一律用系統瀏覽器開
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://') && !url.startsWith(process.env['ELECTRON_RENDERER_URL'] ?? '\0')) {
      e.preventDefault()
      if (url.startsWith('https://')) shell.openExternal(url)
    }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function applyTheme(theme: Settings['theme']): void {
  nativeTheme.themeSource = theme
}

function focusWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/** 把錯誤轉成可序列化的 { code, message } 讓畫面顯示 */
function wrap<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  return async (_e: Electron.IpcMainInvokeEvent, ...args: A): Promise<{ ok: true; value: R } | { ok: false; code: string; message: string }> => {
    try {
      return { ok: true, value: await fn(...args) }
    } catch (err) {
      const e = err as { code?: string; message?: string }
      return { ok: false, code: e?.code ?? 'error', message: e?.message ?? String(err) }
    }
  }
}

function registerIpc(): void {
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:openExternal', (_e, url: string) => {
    if (url.startsWith('https://')) shell.openExternal(url)
  })

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:update', async (_e, patch: Partial<Settings>) => {
    const s = await updateSettings(patch)
    if (patch.theme) applyTheme(s.theme)
    if (patch.provider) ai.clearModelCache()
    return s
  })

  ipcMain.handle('auth:status', wrap(() => auth.getStatus()))
  ipcMain.handle(
    'auth:signIn',
    wrap(async () => {
      try {
        return await auth.signIn()
      } finally {
        ai.clearModelCache()
        focusWindow()
      }
    })
  )
  ipcMain.handle('auth:cancelSignIn', () => auth.cancelSignIn())
  ipcMain.handle(
    'auth:signOut',
    wrap(async () => {
      ai.clearModelCache()
      return auth.signOut()
    })
  )
  ipcMain.handle(
    'auth:setApiKey',
    wrap(async (key: string) => {
      ai.clearModelCache()
      return auth.setApiKey(key)
    })
  )

  ipcMain.handle('ai:models', wrap(() => ai.listModels(true)))
  ipcMain.on('ai:start', (e, id: string, req: AiRequest) => {
    void ai.start(e.sender, id, req)
  })
  ipcMain.on('ai:cancel', (_e, id: string) => ai.cancel(id))

  ipcMain.handle('lib:list', wrap(() => library.list()))
  ipcMain.handle('lib:import', wrap((paths: string[]) => library.importFiles(paths)))
  ipcMain.handle(
    'lib:pick',
    wrap(async () => {
      const r = await dialog.showOpenDialog(mainWindow!, {
        title: '選擇要開啟的檔案',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'PDF / 文字檔', extensions: ['pdf', 'txt', 'md', 'markdown'] }]
      })
      return r.canceled ? [] : library.importFiles(r.filePaths)
    })
  )
  ipcMain.handle('lib:read', wrap((id: string) => library.readSource(id)))
  ipcMain.handle('lib:touch', wrap((id: string) => library.touch(id)))
  ipcMain.handle('lib:rename', wrap((id: string, title: string) => library.rename(id, title)))
  ipcMain.handle('lib:remove', wrap((id: string) => library.remove(id)))
  ipcMain.handle('lib:getData', wrap((id: string) => library.getData(id)))
  ipcMain.handle('lib:saveData', wrap((id: string, data: DocData) => library.saveData(id, data)))
  ipcMain.handle(
    'lib:exportMarkdown',
    wrap(async (title: string, md: string) => {
      const r = await dialog.showSaveDialog(mainWindow!, {
        title: '匯出筆記',
        defaultPath: `${title.replace(/[\\/:*?"<>|]/g, '_')}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      })
      if (r.canceled || !r.filePath) return null
      await fs.writeFile(r.filePath, md, 'utf8')
      shell.showItemInFolder(r.filePath)
      return r.filePath
    })
  )

  ipcMain.handle('update:status', () => getUpdateStatus())
  ipcMain.handle('update:check', () => checkForUpdates())
  ipcMain.handle('update:install', () => installUpdate())
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', focusWindow)

  app.whenReady().then(async () => {
    applyTheme((await getSettings()).theme)
    registerIpc()
    createWindow()
    initUpdater()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
