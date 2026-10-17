// 驗證自動更新：啟動已安裝的舊版本，等待「新版本已準備好」的提示
// 用法：node e2e/update-check.mjs "<已安裝的 exe 路徑>"
import { _electron as electron } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const out = join(import.meta.dirname, 'out')
mkdirSync(out, { recursive: true })
const app = await electron.launch({
  executablePath: process.argv[2],
  args: [],
  env: { ...process.env, TA_USER_DATA: join(out, 'update-userdata') }
})
const page = await app.firstWindow()
console.log('running version:', await page.evaluate(() => window.api.getVersion()))
await page.waitForSelector('.update-banner', { timeout: 180000 })
console.log('banner:', await page.locator('.update-banner').innerText())
await page.screenshot({ path: join(out, 'update-banner.png') })
await page.click('.update-banner button:has-text("立即重新啟動更新")')
await new Promise((r) => setTimeout(r, 2000))
console.log('install triggered')
