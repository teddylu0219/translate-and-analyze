import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { TextLayer, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist'
import type { Highlight, Rect } from '../../../shared/types'
import type { Para } from '../lib/paragraphs'
import { mergeLineRects, type ViewerHandle, type ViewerProps } from './viewer'

interface PageSize {
  w: number
  h: number
}

const MIN_SCALE = 0.5
const MAX_SCALE = 4

export const PdfView = forwardRef<ViewerHandle, ViewerProps & { pdf: PDFDocumentProxy }>(function PdfView(
  { pdf, paras, highlights, flash, onSelection, onPointClick, initialPage, onPageChange },
  ref
) {
  const scroller = useRef<HTMLDivElement>(null)
  const [sizes, setSizes] = useState<PageSize[]>([])
  const [scale, setScale] = useState(0)
  const [fit, setFit] = useState(true)
  const [page, setPage] = useState(1)
  const pageEls = useRef<(HTMLDivElement | null)[]>([])
  const restoreRef = useRef<{ page: number; offset: number } | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const out: PageSize[] = []
      for (let n = 1; n <= pdf.numPages; n++) {
        const vp = (await pdf.getPage(n)).getViewport({ scale: 1 })
        out.push({ w: vp.width, h: vp.height })
      }
      if (alive) setSizes(out)
    })()
    return () => {
      alive = false
    }
  }, [pdf])

  const fitWidth = useCallback(() => {
    const el = scroller.current
    if (!el || !sizes.length) return
    const maxW = Math.max(...sizes.map((s) => s.w))
    setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, (el.clientWidth - 48) / maxW)))
  }, [sizes])

  useEffect(() => {
    if (fit) fitWidth()
  }, [fit, fitWidth])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => fit && fitWidth())
    ro.observe(el)
    return () => ro.disconnect()
  }, [fit, fitWidth])

  // 第一次載入時跳到上次讀到的頁面
  const restored = useRef(false)
  useEffect(() => {
    if (!scale || restored.current || !sizes.length) return
    restored.current = true
    if (initialPage && initialPage > 1) {
      requestAnimationFrame(() => pageEls.current[initialPage - 1]?.scrollIntoView({ block: 'start' }))
    }
  }, [scale, sizes, initialPage])

  // 改變縮放時保持目前閱讀位置
  const zoom = (next: number): void => {
    const el = scroller.current
    const pe = pageEls.current[page - 1]
    if (el && pe) restoreRef.current = { page, offset: (el.scrollTop - pe.offsetTop) / pe.offsetHeight }
    setFit(false)
    setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(next * 100) / 100)))
  }
  useLayoutEffect(() => {
    const r = restoreRef.current
    const el = scroller.current
    if (!r || !el) return
    const pe = pageEls.current[r.page - 1]
    if (pe) el.scrollTop = pe.offsetTop + r.offset * pe.offsetHeight
    restoreRef.current = null
  }, [scale])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      zoom(scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  const onScroll = (): void => {
    const el = scroller.current
    if (!el) return
    const mid = el.scrollTop + el.clientHeight * 0.35
    let current = 1
    for (let i = 0; i < pageEls.current.length; i++) {
      const pe = pageEls.current[i]
      if (pe && pe.offsetTop <= mid) current = i + 1
    }
    if (current !== page) {
      setPage(current)
      onPageChange?.(current)
    }
  }

  const scrollToRects = useCallback((rects: Rect[]) => {
    const el = scroller.current
    if (!rects.length || !el) return
    const r = rects[0]
    const pe = pageEls.current[r.page - 1]
    if (!pe) return
    const top = pe.offsetTop + r.y * pe.offsetHeight - el.clientHeight * 0.3
    el.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      scrollToRects,
      scrollToPara: (p: Para) => scrollToRects(p.pieces.map((pc) => pc.rect)),
      scrollToPage: (n: number) => pageEls.current[n - 1]?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }),
    [scrollToRects]
  )

  /** 把畫面上的選取範圍轉成頁面比例座標 */
  const handleMouseUp = (e: React.MouseEvent): void => {
    const sel = window.getSelection()
    const text = sel?.toString().replace(/\s+/g, ' ').trim() ?? ''
    if (!sel || sel.isCollapsed || !text) {
      // 單純點擊：找出點到的段落或畫線
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-page]')
      if (!target) return
      const box = target.getBoundingClientRect()
      onPointClick?.({
        page: Number(target.dataset.page),
        x: (e.clientX - box.left) / box.width,
        y: (e.clientY - box.top) / box.height,
        clientX: e.clientX,
        clientY: e.clientY
      })
      return
    }
    const range = sel.getRangeAt(0)
    const rects: Rect[] = []
    for (const cr of Array.from(range.getClientRects())) {
      if (cr.width < 1 || cr.height < 1) continue
      const cx = cr.left + cr.width / 2
      const cy = cr.top + cr.height / 2
      const pe = pageEls.current.find((p) => {
        if (!p) return false
        const b = p.getBoundingClientRect()
        return cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom
      })
      if (!pe) continue
      const b = pe.getBoundingClientRect()
      rects.push({
        page: Number(pe.dataset.page),
        x: (cr.left - b.left) / b.width,
        y: (cr.top - b.top) / b.height,
        w: cr.width / b.width,
        h: cr.height / b.height
      })
    }
    if (!rects.length) return
    const anchor = range.getBoundingClientRect()
    onSelection({ text, rects: mergeLineRects(rects), anchor: { x: anchor.left + anchor.width / 2, top: anchor.top, bottom: anchor.bottom } })
  }

  return (
    <div className="pdf-view">
      <div className="viewer-toolbar">
        <button className="icon-btn" title="縮小（Ctrl + 滾輪）" onClick={() => zoom(scale / 1.15)}>
          −
        </button>
        <span className="zoom-label">{Math.round(scale * 100)}%</span>
        <button className="icon-btn" title="放大（Ctrl + 滾輪）" onClick={() => zoom(scale * 1.15)}>
          ＋
        </button>
        <button className={`chip ${fit ? 'active' : ''}`} onClick={() => setFit(true)}>
          符合寬度
        </button>
        <span className="spacer" />
        <span className="muted">
          {page} / {pdf.numPages} 頁
        </span>
      </div>
      <div className="pdf-scroller" ref={scroller} onScroll={onScroll} onMouseUp={handleMouseUp}>
        {scale > 0 &&
          sizes.map((s, i) => (
            <PdfPage
              key={i}
              pdf={pdf}
              n={i + 1}
              size={s}
              scale={scale}
              root={scroller}
              highlights={highlights.filter((h) => h.rects.some((r) => r.page === i + 1))}
              flash={flash?.filter((r) => r.page === i + 1) ?? []}
              setRef={(el) => (pageEls.current[i] = el)}
            />
          ))}
      </div>
    </div>
  )
})

function PdfPage({
  pdf,
  n,
  size,
  scale,
  root,
  highlights,
  flash,
  setRef
}: {
  pdf: PDFDocumentProxy
  n: number
  size: PageSize
  scale: number
  root: React.RefObject<HTMLDivElement | null>
  highlights: Highlight[]
  flash: Rect[]
  setRef: (el: HTMLDivElement | null) => void
}) {
  const el = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const node = el.current
    if (!node) return
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      root: root.current,
      rootMargin: '1200px 0px'
    })
    io.observe(node)
    return () => io.disconnect()
  }, [root])

  useEffect(() => {
    if (!visible) return
    let task: RenderTask | null = null
    let textLayer: TextLayer | null = null
    let cancelled = false
    ;(async () => {
      const page = await pdf.getPage(n)
      if (cancelled) return
      const viewport = page.getViewport({ scale })
      const canvas = canvasRef.current!
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      const ctx = canvas.getContext('2d')!
      task = page.render({ canvasContext: ctx, canvas, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined })
      try {
        await task.promise
      } catch {
        return
      }
      if (cancelled) return
      const container = textRef.current!
      container.replaceChildren()
      textLayer = new TextLayer({ textContentSource: page.streamTextContent(), container, viewport })
      await textLayer.render().catch(() => {})
      if (cancelled) return
      const end = document.createElement('div')
      end.className = 'endOfContent'
      container.append(end)
    })()
    return () => {
      cancelled = true
      task?.cancel()
      textLayer?.cancel()
    }
  }, [visible, pdf, n, scale])

  return (
    <div
      className="pdf-page"
      data-page={n}
      ref={(node) => {
        el.current = node
        setRef(node)
      }}
      style={
        {
          width: size.w * scale,
          height: size.h * scale,
          '--scale-factor': scale,
          '--total-scale-factor': scale,
          '--scale-round-x': '1px',
          '--scale-round-y': '1px'
        } as React.CSSProperties
      }
    >
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
      <div className="hl-layer">
        {highlights.flatMap((h) =>
          h.rects
            .filter((r) => r.page === n)
            .map((r, i) => <div key={`${h.id}-${i}`} className={`hl hl-${h.color} ${h.note ? 'has-note' : ''}`} style={rectStyle(r)} />)
        )}
        {flash.map((r, i) => (
          <div key={`f${i}`} className="flash" style={rectStyle(r)} />
        ))}
      </div>
      <div
        className="textLayer"
        ref={textRef}
        onMouseDown={() => textRef.current?.classList.add('selecting')}
        onMouseUp={() => textRef.current?.classList.remove('selecting')}
      />
    </div>
  )
}

const rectStyle = (r: Rect): React.CSSProperties => ({
  left: `${r.x * 100}%`,
  top: `${r.y * 100}%`,
  width: `${r.w * 100}%`,
  height: `${r.h * 100}%`
})
