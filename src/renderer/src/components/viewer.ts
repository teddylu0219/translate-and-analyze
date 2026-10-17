import type { Highlight, Rect } from '../../../shared/types'
import type { Para } from '../lib/paragraphs'

export interface SelectionInfo {
  text: string
  rects: Rect[]
  /** 選取範圍在螢幕上的位置，用來擺放浮動選單 */
  anchor: { x: number; top: number; bottom: number }
  /** TXT 文件才有 */
  paraId?: string
  start?: number
  end?: number
}

export interface PointClick {
  page: number
  x: number
  y: number
  clientX: number
  clientY: number
  /** TXT 文件：點到的段落 */
  paraId?: string
  offset?: number
}

export interface ViewerProps {
  paras: Para[]
  highlights: Highlight[]
  /** 暫時閃爍標示的位置（PDF）或 TXT 的段落範圍 */
  flash: Rect[] | null
  flashRange?: { paraId: string; start: number; end: number } | null
  onSelection: (sel: SelectionInfo) => void
  onPointClick?: (p: PointClick) => void
  initialPage?: number
  onPageChange?: (page: number) => void
}

export interface ViewerHandle {
  scrollToRects: (rects: Rect[]) => void
  scrollToPara: (p: Para) => void
  scrollToPage: (n: number) => void
}

/** 同一行相鄰的矩形合併，畫線看起來比較乾淨 */
export function mergeLineRects(rects: Rect[]): Rect[] {
  const sorted = [...rects].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)
  const out: Rect[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (
      last &&
      last.page === r.page &&
      Math.abs(last.y + last.h / 2 - (r.y + r.h / 2)) < Math.min(last.h, r.h) * 0.5 &&
      r.x <= last.x + last.w + 0.01
    ) {
      const x0 = Math.min(last.x, r.x)
      const x1 = Math.max(last.x + last.w, r.x + r.w)
      const y0 = Math.min(last.y, r.y)
      const y1 = Math.max(last.y + last.h, r.y + r.h)
      Object.assign(last, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
    } else {
      out.push({ ...r })
    }
  }
  return out
}

export function pointInRect(r: Rect, page: number, x: number, y: number, pad = 0.004): boolean {
  return r.page === page && x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad
}
