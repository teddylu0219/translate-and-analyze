import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { autoUpdater } from 'electron-updater'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })

  win.once('ready-to-show', () => win.show())

  // 外部連結一律用系統瀏覽器開，不在 app 內開新視窗
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('app:version', () => app.getVersion())

app.whenReady().then(() => {
  createWindow()

  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {
      // 沒網路或 GitHub 暫時連不上時略過，下次啟動再檢查
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
