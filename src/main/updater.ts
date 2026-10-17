import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '../shared/types'

let status: UpdateStatus = { state: 'idle' }

function broadcast(next: UpdateStatus): void {
  status = next
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update:status', status)
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

export function initUpdater(): void {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => broadcast({ state: 'checking' }))
  autoUpdater.on('update-not-available', () => broadcast({ state: 'none' }))
  autoUpdater.on('update-available', (info) => broadcast({ state: 'downloading', percent: 0, version: info.version }))
  autoUpdater.on('download-progress', (p) =>
    broadcast({ state: 'downloading', percent: Math.round(p.percent), version: status.state === 'downloading' ? status.version : undefined })
  )
  autoUpdater.on('update-downloaded', (info) => broadcast({ state: 'downloaded', version: info.version }))
  autoUpdater.on('error', (err) => broadcast({ state: 'error', message: err?.message ?? String(err) }))

  checkForUpdates()
  // 長時間開著也會定期檢查
  setInterval(checkForUpdates, 4 * 60 * 60 * 1000)
}

export function checkForUpdates(): void {
  if (!app.isPackaged) {
    broadcast({ state: 'none' })
    return
  }
  autoUpdater.checkForUpdates().catch((err) => broadcast({ state: 'error', message: err?.message ?? String(err) }))
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall(true, true)
}
