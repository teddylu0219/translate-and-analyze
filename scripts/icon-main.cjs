// 產生 build/icon.png（electron-builder 會自動轉成 Windows 的 .ico）
// 用法：npx electron scripts/icon-main.cjs
const { app, BrowserWindow } = require('electron')
const { writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const html = `<!doctype html><html><body style="margin:0;background:transparent">
<div style="width:512px;height:512px;border-radius:112px;background:linear-gradient(145deg,#3b7cf0,#1f4fb8);
display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden">
<div style="font:700 300px 'Microsoft JhengHei','Segoe UI',sans-serif;color:#fff;line-height:1;margin-top:-20px">譯</div>
<div style="position:absolute;left:96px;right:96px;bottom:78px;height:26px;border-radius:13px;background:#ffd60a"></div>
</div></body></html>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, useContentSize: true })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 300))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 })
  mkdirSync(join(__dirname, '..', 'build'), { recursive: true })
  writeFileSync(join(__dirname, '..', 'build', 'icon.png'), img.resize({ width: 512, height: 512 }).toPNG())
  app.quit()
})
