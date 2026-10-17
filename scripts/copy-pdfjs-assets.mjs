// 把 pdf.js 需要的字型、CMap（中日韓文字）與 wasm 解碼器複製到 renderer 的 public 資料夾
import { cpSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pdfjsDir = dirname(require.resolve('pdfjs-dist/package.json'))
const out = join(import.meta.dirname, '..', 'src', 'renderer', 'public', 'pdfjs')

mkdirSync(out, { recursive: true })
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  cpSync(join(pdfjsDir, dir), join(out, dir), { recursive: true })
}
console.log('pdf.js assets copied')
