// 把 build/icon.svg 轉成 build/icon.png（electron-builder 會再轉成 Windows 的 .ico）
// 以及 src/renderer/src/assets/logo.png（畫面左上角用）
// 用法：node_modules\electron\dist\electron.exe scripts/icon-main.cjs
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const svg = readFileSync(join(root, 'build', 'icon.svg'), 'utf8')
const html = `<!doctype html><html><head><style>
html,body{margin:0;overflow:hidden;background:transparent}svg{display:block;width:1024px;height:1024px}
</style></head><body>${svg}</body></html>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { zoomFactor: 1 } })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 400))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })
  const full = img.resize({ width: 1024, height: 1024, quality: 'best' })
  writeFileSync(join(root, 'build', 'icon.png'), full.resize({ width: 512, height: 512, quality: 'best' }).toPNG())
  mkdirSync(join(root, 'src', 'renderer', 'src', 'assets'), { recursive: true })
  writeFileSync(join(root, 'src', 'renderer', 'src', 'assets', 'logo.png'), full.resize({ width: 96, height: 96, quality: 'best' }).toPNG())
  app.quit()
})
