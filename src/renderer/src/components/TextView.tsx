import { forwardRef, useImperativeHandle, useRef } from 'react'
import type { ViewerHandle, ViewerProps } from './viewer'

interface Segment {
  start: number
  end: number
  cls: string
}

/** 把段落文字依畫線與閃爍範圍切成片段 */
function segments(text: string, marks: Segment[]): { text: string; cls: string; start: number }[] {
  const cuts = new Set([0, text.length])
  for (const m of marks) {
    cuts.add(Math.max(0, Math.min(text.length, m.start)))
    cuts.add(Math.max(0, Math.min(text.length, m.end)))
  }
  const points = [...cuts].sort((a, b) => a - b)
  const out: { text: string; cls: string; start: number }[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    if (a === b) continue
    const cls = marks
      .filter((m) => m.start <= a && m.end >= b)
      .map((m) => m.cls)
      .join(' ')
    out.push({ text: text.slice(a, b), cls, start: a })
  }
  return out
}

/** 由 DOM 選取位置算出在段落文字中的位移 */
function offsetIn(paraEl: HTMLElement, node: Node, offset: number): number {
  let total = 0
  const walker = document.createTreeWalker(paraEl, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n === node) return total + offset
    total += n.textContent?.length ?? 0
  }
  if (node === paraEl) return offset === 0 ? 0 : total
  return total
}

export const TextView = forwardRef<ViewerHandle, ViewerProps>(function TextView(
  { paras, highlights, flashRange, onSelection, onPointClick },
  ref
) {
  const scroller = useRef<HTMLDivElement>(null)

  const scrollToId = (id: string): void => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-para="${id}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  useImperativeHandle(ref, () => ({
    scrollToRects: () => {},
    scrollToPara: (p) => scrollToId(p.id),
    scrollToPage: () => scroller.current?.scrollTo({ top: 0 })
  }))

  const handleMouseUp = (e: React.MouseEvent): void => {
    const sel = window.getSelection()
    const text = sel?.toString().replace(/\s+/g, ' ').trim() ?? ''
    if (!sel || sel.isCollapsed || !text) {
      const pe = (e.target as HTMLElement).closest<HTMLElement>('[data-para]')
      if (pe) {
        const hl = (e.target as HTMLElement).closest<HTMLElement>('[data-hl]')
        onPointClick?.({ page: 0, x: 0, y: 0, clientX: e.clientX, clientY: e.clientY, paraId: pe.dataset.para, offset: hl ? Number(hl.dataset.start) : undefined })
      }
      return
    }
    const range = sel.getRangeAt(0)
    const startEl = (range.startContainer.nodeType === 1 ? (range.startContainer as HTMLElement) : range.startContainer.parentElement)?.closest<HTMLElement>('[data-para]')
    const endEl = (range.endContainer.nodeType === 1 ? (range.endContainer as HTMLElement) : range.endContainer.parentElement)?.closest<HTMLElement>('[data-para]')
    const box = range.getBoundingClientRect()
    const anchor = { x: box.left + box.width / 2, top: box.top, bottom: box.bottom }
    if (startEl && startEl === endEl) {
      const start = offsetIn(startEl, range.startContainer, range.startOffset)
      const end = offsetIn(startEl, range.endContainer, range.endOffset)
      onSelection({ text, rects: [], anchor, paraId: startEl.dataset.para, start, end })
    } else {
      // 跨段落的選取：可以翻譯和提問，但畫線只支援單一段落
      onSelection({ text, rects: [], anchor })
    }
  }

  return (
    <div className="text-view" ref={scroller} onMouseUp={handleMouseUp}>
      <article className="text-article">
        {paras.map((p) => {
          const marks: Segment[] = highlights
            .filter((h) => h.paraId === p.id && h.start !== undefined && h.end !== undefined)
            .map((h) => ({ start: h.start!, end: h.end!, cls: `hl hl-${h.color}${h.note ? ' has-note' : ''}` }))
          if (flashRange?.paraId === p.id) marks.push({ start: flashRange.start, end: flashRange.end, cls: 'flash' })
          const Tag = p.kind === 'heading' ? 'h3' : 'p'
          return (
            <Tag key={p.id} data-para={p.id} className={`tv-${p.kind}`}>
              {segments(p.text, marks).map((s, i) =>
                s.cls ? (
                  <mark key={i} className={s.cls} data-hl="" data-start={s.start}>
                    {s.text}
                  </mark>
                ) : (
                  <span key={i}>{s.text}</span>
                )
              )}
            </Tag>
          )
        })}
      </article>
    </div>
  )
})
