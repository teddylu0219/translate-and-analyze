// 端對端測試：用模擬 AI（TA_MOCK_AI=1）啟動真正的 app，走過主要功能並截圖到 e2e/out/
// 用法：npm run build && npm run e2e
import { _electron as electron } from 'playwright'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const out = join(import.meta.dirname, 'out')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const para = (n) =>
  `Transformer models have become the dominant architecture for sequence modeling tasks in natural language processing. ` +
  `In this section we describe experiment ${n}, where the self-attention mechanism allows each token to attend to every other token, ` +
  `capturing long-range dependencies that recurrent networks struggle to learn. We find that scaling the number of attention heads improves ` +
  `performance up to a point, after which the gains saturate and the computational cost dominates.`

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:'Times New Roman',serif;font-size:10.5pt;margin:0}
h1{text-align:center;font-size:17pt;margin:0 0 6pt} .authors{text-align:center;margin-bottom:14pt}
.cols{column-count:2;column-gap:22pt;text-align:justify;hyphens:auto} h2{font-size:12pt;margin:10pt 0 4pt}
p{margin:0 0 6pt;text-indent:12pt}
</style></head><body>
<h1>Attention Scaling in Sequence Models</h1><div class="authors">Ada Example, Bob Sample — Example University</div>
<div class="cols">
<h2>Abstract</h2><p>${para(0)}</p>
<h2>1 Introduction</h2><p>${para(1)}</p><p>${para(2)}</p>
<h2>2 Method</h2><p>${para(3)}</p><p>${para(4)}</p><p>${para(5)}</p>
<h2>3 Results</h2><p>${para(6)}</p><p>${para(7)}</p><p>${para(8)}</p><p>${para(9)}</p>
<h2>4 Conclusion</h2><p>${para(10)}</p><p>${para(11)}</p>
<h2>References</h2><p>[1] A. Vaswani et al. Attention is all you need. NeurIPS 2017.</p>
</div></body></html>`

const txt = `Sample Notes\n\nThis is the first paragraph of a plain text document. It talks about reading papers efficiently and taking notes.\n\nSecond Section\n\nThe second paragraph explains why translation and analysis should live on the same page, so readers never lose context.\n`
writeFileSync(join(out, 'sample.txt'), txt)

// TA_E2E_EXE=dist\win-unpacked\Translate and Analyze.exe 可以改測打包後的程式
const env = { ...process.env, TA_MOCK_AI: '1', TA_USER_DATA: join(out, 'userdata') }
const app = await electron.launch(
  process.env.TA_E2E_EXE ? { executablePath: process.env.TA_E2E_EXE, args: [], env } : { args: [root], cwd: root, env }
)

const errors = []
const page = await app.firstWindow()
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {})
const shot = async (name) => {
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(out, `${name}.png`) })
  console.log('shot', name)
}

// 用 Electron 本身把 HTML 印成雙欄論文 PDF 當測試檔
const pdfPath = join(out, 'sample-paper.pdf')
await app.evaluate(async ({ BrowserWindow }, { html, pdfPath }) => {
  const fs = process.mainModule.require('node:fs')
  const w = new BrowserWindow({ show: false })
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  const buf = await w.webContents.printToPDF({ pageSize: 'Letter', margins: { top: 0.8, bottom: 0.8, left: 0.8, right: 0.8 } })
  fs.writeFileSync(pdfPath, buf)
  w.destroy()
}, { html, pdfPath })

await page.waitForSelector('.library')
// 第一次登入會顯示方案使用說明
const gotIt = page.locator('button:has-text("Got it")')
await gotIt.waitFor({ timeout: 3000 }).then(() => gotIt.click()).catch(() => {})
await shot('01-library-empty')

await page.evaluate((paths) => window.api.importDocs(paths), [pdfPath, join(out, 'sample.txt')])
await page.reload()
await page.waitForSelector('.doc-card')
await shot('02-library')

// 開 PDF
await page.click('.doc-card:has-text("sample-paper")')
await page.waitForSelector('.pdf-page canvas')
await page.waitForSelector('.para-card', { timeout: 20000 })
await page.waitForTimeout(800)
const paraCount = await page.locator('.para-card, .para-heading').count()
console.log('paragraph cards:', paraCount)
const paraTexts = await page.locator('.para-card .orig').allTextContents()
console.log('first paragraphs:', paraTexts.slice(0, 3).map((t) => t.slice(0, 90)))
await shot('03-reader')

// 全文翻譯
await page.click('button:has-text("全文翻譯")')
await page.waitForSelector('.job', { timeout: 5000 })
await shot('04-translating')
await page.waitForSelector('.job', { state: 'detached', timeout: 60000 })
console.log('translations:', await page.locator('.para-card .trans').count())

// 翻譯＋分析
await page.click('button:has-text("翻譯＋逐段分析")')
await page.waitForSelector('.job', { state: 'detached', timeout: 60000 })
console.log('analyses:', await page.locator('.para-card .analysis').count())
console.log('quote links:', await page.locator('.analysis .quote-link').count())
await shot('05-analyzed')

// 點引用 → 原文閃爍標示
const ql = page.locator('.analysis .quote-link').nth(2)
if (await ql.count()) {
  await ql.click()
  await page.waitForSelector('.flash', { timeout: 3000 })
  console.log('quote flash ok')
  await shot('06-quote-flash')
}

// 選字 → 浮動選單 → 畫線
const span = page.locator('.pdf-page[data-page="1"] .textLayer span', { hasText: /self-attention/ }).first()
await span.scrollIntoViewIfNeeded()
const box = await span.boundingBox()
await page.mouse.move(box.x + 2, box.y + box.height / 2)
await page.mouse.down()
await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 8 })
await page.mouse.up()
console.log('span text:', await span.textContent(), '| selection:', await page.evaluate(() => window.getSelection()?.toString()))
await page.waitForSelector('.sel-menu', { timeout: 3000 })
await shot('07-selection-menu')
await page.click('.sel-menu button:has-text("翻譯")')
await page.waitForSelector('.sel-result .rich', { timeout: 10000 })
await page.waitForTimeout(1500)
await shot('08-selection-translate')
await page.click('.sel-menu .sw-green')
await page.waitForSelector('.hl-layer .hl-green')
console.log('highlight drawn')
await shot('09-highlight')

// 畫線筆記分頁
await page.click('.tab:has-text("筆記")')
await page.waitForSelector('.hl-item')
await shot('10-notes')

// 導讀
await page.click('.tab:has-text("導讀")')
await page.click('button:has-text("產生導讀")')
await page.waitForSelector('.summary-panel .rich h2', { timeout: 10000 })
await page.waitForTimeout(1500)
await shot('11-summary')

// 問答
await page.click('.tab:has-text("問答")')
await page.click('.suggest .chip >> nth=0')
await page.waitForSelector('.msg-assistant .rich', { timeout: 10000 })
await page.waitForTimeout(1500)
await shot('12-chat')

// 縮放
await page.click('.viewer-toolbar button[title^="放大"]')
await page.waitForTimeout(600)
await shot('13-zoom')

// TXT
await page.click('button:has-text("文件庫")')
await page.click('.doc-card:has-text("sample")>> nth=1').catch(() => page.click('.doc-card:has-text("sample") >> nth=0'))
await page.waitForSelector('.text-article', { timeout: 10000 })
await page.click('.tab:has-text("翻譯・分析")')
await shot('14-txt')

// 設定
await page.click('.topbar .icon-btn[title="設定"]')
await page.waitForSelector('.modal')
await shot('15-settings')

// 深色模式
await page.click('.modal .seg button:has-text("深色")')
await page.click('.modal .icon-btn')
await page.click('button:has-text("文件庫")')
await page.click('.doc-card:has-text("sample-paper")')
await page.waitForSelector('.para-card .trans', { timeout: 20000 })
await shot('16-dark')

console.log('console errors:', errors.length ? errors : 'none')
await app.close()
