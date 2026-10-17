import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { Rect } from '../../../shared/types'

export type ParaKind = 'heading' | 'body' | 'minor' | 'ref'

/** 一段文字中某個字元範圍對應的矩形，用來把引用原文對回 PDF 上的位置 */
export interface Piece {
  start: number
  end: number
  rect: Rect
}

export interface Para {
  id: string
  page: number
  kind: ParaKind
  text: string
  pieces: Piece[]
}

interface Item {
  str: string
  x: number
  top: number
  w: number
  h: number
  baseline: number
}

interface Line {
  items: Item[]
  x0: number
  x1: number
  top: number
  baseline: number
  h: number
  page: number
  pw: number
  ph: number
}

const headingRe =
  /^((\d+(\.\d+)*\.?|[IVX]+\.|[A-Z]\.)\s+[A-Z一-鿿][^.]*|(abstract|introduction|background|related work|methods?|methodology|experiments?|results?|discussion|conclusions?|references|bibliography|acknowledge?ments?|appendix|摘要|引言|結論|参考文献|參考文獻))$/i

const isCJK =(c: string): boolean => /[　-鿿가-힯＀-￯]/.test(c)
const terminal = /[.!?。！？:：;；)"”』」]$/

function joinText(a: string, b: string): string {
  if (!a) return b
  if (!b) return a
  const last = a[a.length - 1]
  const first = b[0]
  if (last === '-' && /[a-z]/.test(first) && /[a-zA-Z]-$/.test(a)) return a.slice(0, -1) + b
  if (last === ' ' || first === ' ' || isCJK(last) || isCJK(first)) return a + b
  return `${a} ${b}`
}

/** 從 PDF 的文字層抽出段落：先依位置組成行，再依行距、縮排、欄位切段 */
export async function extractPdfParagraphs(pdf: PDFDocumentProxy, onProgress?: (p: number) => void): Promise<Para[]> {
  const lines: Line[] = []
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n)
    const vp = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    let cur: Line | null = null
    for (const raw of content.items) {
      if (!('str' in raw)) continue
      const str = raw.str
      const tx = raw.transform
      const fontH = Math.hypot(tx[2], tx[3]) || raw.height
      if (!str.trim()) {
        if (cur && str) cur.items.push({ str: ' ', x: cur.x1, top: cur.top, w: 0, h: cur.h, baseline: cur.baseline })
        continue
      }
      const [vx, vy] = vp.convertToViewportPoint(tx[4], tx[5])
      const item: Item = { str, x: vx, baseline: vy, top: vy - fontH * 0.85, w: raw.width, h: fontH }
      const sameLine =
        cur && Math.abs(item.baseline - cur.baseline) < Math.max(item.h, cur.h) * 0.45 && item.x > cur.x0 - 2 && item.x - cur.x1 < cur.h * 4
      if (cur && sameLine) {
        const gap = item.x - cur.x1
        const prev = cur.items[cur.items.length - 1]
        if (gap > item.h * 0.18 && !prev.str.endsWith(' ') && !str.startsWith(' ')) {
          cur.items.push({ str: ' ', x: cur.x1, top: cur.top, w: 0, h: cur.h, baseline: cur.baseline })
        }
        cur.items.push(item)
        cur.x1 = Math.max(cur.x1, item.x + item.w)
        cur.h = Math.max(cur.h, item.h)
        cur.top = Math.min(cur.top, item.top)
      } else {
        cur = { items: [item], x0: item.x, x1: item.x + item.w, top: item.top, baseline: item.baseline, h: item.h, page: n, pw: vp.width, ph: vp.height }
        lines.push(cur)
      }
    }
    onProgress?.(n / pdf.numPages)
  }

  // 去掉頁首頁尾的頁碼與重複短行
  const pageNumRe = /^(\d{1,4}|[ivxlc]{1,6}|page \d+( of \d+)?|\d+ ?\/ ?\d+)$/i
  const repeated = new Map<string, number>()
  for (const l of lines) {
    const t = lineText(l).trim()
    const edge = l.top / l.ph < 0.07 || l.top / l.ph > 0.93
    if (edge && t.length < 90) repeated.set(t.replace(/\d+/g, '#'), (repeated.get(t.replace(/\d+/g, '#')) ?? 0) + 1)
  }
  const clean = lines.filter((l) => {
    const t = lineText(l).trim()
    if (!t) return false
    if (pageNumRe.test(t)) return false
    const edge = l.top / l.ph < 0.07 || l.top / l.ph > 0.93
    if (edge && (repeated.get(t.replace(/\d+/g, '#')) ?? 0) >= 3 && pdf.numPages >= 3) return false
    return true
  })

  // 內文的典型字高與行距
  const heights = clean.map((l) => l.h).sort((a, b) => a - b)
  const bodyH = heights[Math.floor(heights.length / 2)] || 10

  const groups: Line[][] = []
  let group: Line[] = []
  for (let i = 0; i < clean.length; i++) {
    const l = clean[i]
    const prev = group[group.length - 1]
    if (prev && !shouldBreak(prev, l, group, bodyH)) {
      group.push(l)
    } else {
      if (group.length) groups.push(group)
      group = [l]
    }
  }
  if (group.length) groups.push(group)

  // 組成段落，並分類
  let paras: Para[] = []
  let inRefs = false
  for (const g of groups) {
    const para = buildPara(g)
    const t = para.text.trim()
    if (!t) continue
    const avgH = g.reduce((s, l) => s + l.h, 0) / g.length
    const looksHeading =
      g.length <= 2 &&
      t.length < 120 &&
      !/[.,;:。，]$/.test(t) &&
      (avgH > bodyH * 1.12 ||
        /^(\d+(\.\d+)*\.?|[IVX]+\.|[A-Z]\.)\s+\S/.test(t) ||
        /^(abstract|introduction|background|related work|method(s|ology)?|experiments?|results?|discussion|conclusions?|references|bibliography|acknowledge?ments?|appendix|摘要|引言|結論|參考文獻)\b/i.test(t))
    if (looksHeading) {
      para.kind = 'heading'
      inRefs = /^(\d+\.?\s*)?(references|bibliography|參考文獻|参考文献)\b/i.test(t)
    } else if (inRefs) {
      para.kind = 'ref'
    } else if (t.length < 50 || avgH < bodyH * 0.8) {
      para.kind = 'minor'
    }
    paras.push(para)
  }

  // 跨欄、跨頁被切斷的段落接回去
  const merged: Para[] = []
  for (const p of paras) {
    const prev = merged[merged.length - 1]
    if (
      prev &&
      prev.kind === 'body' &&
      p.kind !== 'heading' &&
      !terminal.test(prev.text.trim()) &&
      /^[a-z(]/.test(p.text.trim()) &&
      p.text.length > 20
    ) {
      const offset = joinText(prev.text, p.text).length - p.text.length
      prev.text = joinText(prev.text, p.text)
      prev.pieces.push(...p.pieces.map((pc) => ({ ...pc, start: pc.start + offset, end: pc.end + offset })))
      continue
    }
    if (p.kind === 'minor' && p.text.length >= 50) p.kind = 'body'
    merged.push(p)
  }
  paras = merged
  paras.forEach((p, i) => (p.id = `p${i + 1}`))
  return paras
}

function lineText(l: Line): string {
  return l.items.map((i) => i.str).join('')
}

function shouldBreak(prev: Line, l: Line, group: Line[], bodyH: number): boolean {
  if (l.page !== prev.page) return true
  const gap = l.top - (prev.top + prev.h)
  const lineH = Math.max(prev.h, l.h)
  // 往上跳 → 換欄
  if (l.baseline < prev.baseline - lineH * 0.5) return true
  // 往旁邊跳太多 → 換欄或圖表
  if (Math.abs(l.x0 - prev.x0) > prev.pw * 0.22) return true
  // 行距過大
  if (gap > lineH * 0.75) return true
  // 字體大小不同 → 標題與內文交界
  if (Math.abs(l.h - prev.h) > Math.min(l.h, prev.h) * 0.08) return true
  const prevText = lineText(prev).trim()
  // 單獨一行的章節標題（例如「2 Method」「Abstract」）
  if (group.length === 1 && prevText.length < 80 && headingRe.test(prevText)) return true
  const groupRight = Math.max(...group.map((g) => g.x1))
  const groupLeft = Math.min(...group.map((g) => g.x0))
  const width = groupRight - groupLeft
  // 上一行提早結束且以句點結尾 → 段落結束
  if (group.length > 1 && terminal.test(prevText) && prev.x1 < groupRight - width * 0.12) return true
  // 首行縮排
  if (terminal.test(prevText) && l.x0 > groupLeft + bodyH * 0.8 && l.x0 - groupLeft < width * 0.2) return true
  return false
}

function buildPara(lines: Line[]): Para {
  let text = ''
  const pieces: Piece[] = []
  for (const l of lines) {
    for (const it of l.items) {
      const before = text.length
      const joined = text.length === 0 ? it.str : it === l.items[0] ? joinText(text, it.str) : text + it.str
      text = joined
      if (it.w > 0) {
        const start = text.length - it.str.length
        pieces.push({
          start: Math.max(before, start),
          end: text.length,
          rect: { page: l.page, x: it.x / l.pw, y: it.top / l.ph, w: it.w / l.pw, h: (it.h * 1.15) / l.ph }
        })
      }
    }
  }
  return { id: '', page: lines[0].page, kind: 'body', text, pieces }
}

/** 純文字：以空行分段；單獨一行且很短的視為標題 */
export function extractTextParagraphs(src: string): Para[] {
  const blocks = src.replace(/\r\n?/g, '\n').split(/\n\s*\n/)
  const paras: Para[] = []
  for (const b of blocks) {
    const t = b.trim()
    if (!t) continue
    const single = !t.includes('\n')
    const heading = single && (/^#{1,6}\s/.test(t) || (t.length < 80 && !/[.,;:。，；：]$/.test(t)))
    paras.push({
      id: `p${paras.length + 1}`,
      page: 0,
      kind: heading ? 'heading' : t.length < 30 ? 'minor' : 'body',
      text: heading ? t.replace(/^#{1,6}\s+/, '') : t,
      pieces: []
    })
  }
  return paras
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')

export interface QuoteIndex {
  entries: { para: Para; text: string; map: number[] }[]
}

/** 預先把所有段落正規化，引用比對時不用每次重算 */
export function buildQuoteIndex(paras: Para[]): QuoteIndex {
  return { entries: paras.map((para) => ({ para, ...normWithMap(para.text) })) }
}

/** 把模型引用的原文對回段落中的位置（忽略大小寫與空白差異；找不到完整的就用前半段） */
export function findQuote(index: QuoteIndex, quote: string, preferId?: string): { para: Para; start: number; end: number } | null {
  const q = norm(quote.trim().replace(/^[「『"“]|[」』"”]$/g, '').replace(/(\.\.\.|…)$/, ''))
  if (q.length < 4) return null
  const ordered = preferId
    ? [...index.entries.filter((e) => e.para.id === preferId), ...index.entries.filter((e) => e.para.id !== preferId)]
    : index.entries
  const attempts = [q]
  const parts = q.split(/\s*(?:\.\.\.|…)\s*/).filter((s) => s.length >= 8)
  if (parts.length > 1) attempts.push(parts[0])
  if (q.length >= 20) attempts.push(q.slice(0, Math.floor(q.length * 0.6)))
  for (const a of attempts) {
    for (const { para, text, map } of ordered) {
      const i = text.indexOf(a)
      if (i >= 0) return { para, start: map[i], end: map[Math.min(i + a.length, map.length - 1)] ?? para.text.length }
    }
  }
  return null
}

function normWithMap(s: string): { text: string; map: number[] } {
  let text = ''
  const map: number[] = []
  let lastSpace = false
  for (let i = 0; i < s.length; i++) {
    let c = s[i]
    if (/\s/.test(c)) {
      if (lastSpace) continue
      c = ' '
      lastSpace = true
    } else lastSpace = false
    const n = norm(c)
    text += n
    for (let k = 0; k < n.length; k++) map.push(i)
  }
  map.push(s.length)
  return { text, map }
}

/** 取得段落中某個字元範圍的矩形 */
export function rectsForRange(para: Para, start: number, end: number): Rect[] {
  return para.pieces.filter((pc) => pc.end > start && pc.start < end).map((pc) => {
    const len = pc.end - pc.start || 1
    const a = Math.max(0, (start - pc.start) / len)
    const b = Math.min(1, (end - pc.start) / len)
    return { ...pc.rect, x: pc.rect.x + pc.rect.w * a, w: pc.rect.w * (b - a) }
  })
}
