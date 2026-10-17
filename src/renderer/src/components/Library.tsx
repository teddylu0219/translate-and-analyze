import { useEffect, useState } from 'react'
import { FileText, FileType2, MoreHorizontal, Pencil, Search, Trash2, Upload } from 'lucide-react'
import type { DocMeta } from '../../../shared/types'
import { useApp } from '../lib/appContext'
import { decodeText, loadPdf } from '../lib/pdf'
import logo from '../assets/logo.png'

const fmtSize = (n: number): string => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

function fmtDate(t: number): string {
  const days = Math.floor((Date.now() - t) / 86_400_000)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 7) return `${days} 天前`
  return new Date(t).toLocaleDateString('zh-TW', { year: 'numeric', month: 'short', day: 'numeric' })
}

/** 文字檔縮圖：把開頭幾行畫在白紙上 */
function textThumb(text: string): string {
  const W = 360
  const H = 468
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#3a3d45'
  ctx.font = "15px 'Segoe UI', 'Microsoft JhengHei', sans-serif"
  let y = 40
  for (const para of text.replace(/\r/g, '').split('\n')) {
    let line = ''
    for (const ch of para) {
      if (ctx.measureText(line + ch).width > W - 56) {
        ctx.fillText(line, 28, y)
        y += 24
        line = ''
        if (y > H - 20) return canvas.toDataURL('image/jpeg', 0.8)
      }
      line += ch
    }
    ctx.fillText(line, 28, y)
    y += para.trim() ? 32 : 12
    if (y > H - 20) break
  }
  return canvas.toDataURL('image/jpeg', 0.8)
}

/** 第一頁縮圖（只做一次，存在文件庫索引裡） */
async function makeThumb(d: DocMeta): Promise<string | null> {
  const bytes = await window.api.readDoc(d.id)
  if (d.type === 'txt') return textThumb(decodeText(bytes).slice(0, 2000))
  const pdf = await loadPdf(bytes)
  try {
    const page = await pdf.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: 360 / base.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(Math.min(viewport.height, viewport.width * 1.3))
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, canvas, viewport }).promise
    return canvas.toDataURL('image/jpeg', 0.78)
  } finally {
    void pdf.loadingTask.destroy()
  }
}

export function Library({ onOpen, refreshKey }: { onOpen: (d: DocMeta) => void; refreshKey: number }) {
  const { aiReady, openSettings, toast } = useApp()
  const [docs, setDocs] = useState<DocMeta[] | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const reload = async (): Promise<void> => setDocs(await window.api.listDocs())
  useEffect(() => {
    void reload()
  }, [refreshKey])

  // 背景補上縮圖
  useEffect(() => {
    if (!docs) return
    const missing = docs.filter((d) => !d.thumb)
    if (!missing.length) return
    let alive = true
    ;(async () => {
      for (const d of missing) {
        if (!alive) return
        try {
          const thumb = await makeThumb(d)
          if (!thumb || !alive) continue
          await window.api.setThumb(d.id, thumb)
          setDocs((list) => list?.map((x) => (x.id === d.id ? { ...x, thumb } : x)) ?? null)
        } catch {
          /* 縮圖失敗不影響使用 */
        }
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs?.length])

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menu])

  const pick = async (): Promise<void> => {
    try {
      const added = await window.api.pickDocs()
      if (added.length === 1) onOpen(added[0])
      else void reload()
    } catch (e) {
      toast((e as Error)?.message ?? '無法開啟檔案', 'error')
    }
  }

  const remove = async (d: DocMeta): Promise<void> => {
    if (!confirm(`確定要從文件庫移除「${d.title}」？\n畫線、筆記與譯文也會一起刪除（電腦上的原始檔案不受影響）。`)) return
    await window.api.removeDoc(d.id)
    void reload()
  }

  const shown = (docs ?? []).filter((d) => !query.trim() || d.title.toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <div className="library">
      <div className="lib-inner">
        {!aiReady && (
          <div className="signin-card">
            <img src={logo} alt="" className="signin-logo" />
            <div className="signin-text">
              <strong>連接你的 ChatGPT 方案</strong>
              <div className="muted">翻譯、分析、導讀與問答會使用你的 ChatGPT Plus / Pro 額度，不需要另外付費或 API key。</div>
            </div>
            <button className="btn chatgpt" onClick={() => openSettings()}>
              Continue with ChatGPT
            </button>
          </div>
        )}

        {docs && docs.length > 0 && (
          <div className="lib-head">
            <h1>我的文件</h1>
            <span className="count">{docs.length}</span>
            <span className="spacer" />
            {docs.length > 4 && (
              <div className="search-box">
                <Search size={14} />
                <input placeholder="搜尋文件" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
            )}
            <button className="btn primary" onClick={pick}>
              <Upload size={15} />
              開啟 PDF / TXT
            </button>
          </div>
        )}

        {docs && !docs.length && (
          <button className="drop-hint" onClick={pick}>
            <div className="drop-icon">
              <Upload size={30} />
            </div>
            <div className="drop-title">把 PDF 或 TXT 拖曳到這裡</div>
            <div className="muted">或點一下選擇檔案・支援論文、報告、純文字與 Markdown</div>
            <div className="feature-row">
              <span>選字翻譯</span>
              <span>全文逐段翻譯</span>
              <span>引用原文的分析</span>
              <span>畫線筆記</span>
              <span>導讀與問答</span>
            </div>
          </button>
        )}

        <div className="doc-grid">
          {shown.map((d) => (
            <div key={d.id} className="doc-card" onClick={() => renaming !== d.id && onOpen(d)}>
              <div className={`doc-thumb t-${d.type}`}>
                {d.thumb ? (
                  <img src={d.thumb} alt="" />
                ) : d.type === 'pdf' ? (
                  <FileType2 size={34} strokeWidth={1.4} />
                ) : (
                  <FileText size={34} strokeWidth={1.4} />
                )}
                <span className={`doc-type t-${d.type}`}>{d.type.toUpperCase()}</span>
              </div>
              <div className="doc-info">
                {renaming === d.id ? (
                  <input
                    className="rename"
                    autoFocus
                    defaultValue={d.title}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={async (e) => {
                      await window.api.renameDoc(d.id, e.target.value)
                      setRenaming(null)
                      void reload()
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                  />
                ) : (
                  <div className="doc-name" title={d.title}>
                    {d.title}
                  </div>
                )}
                <div className="doc-meta">
                  {fmtDate(d.openedAt)}・{fmtSize(d.size)}
                </div>
              </div>
              <button
                className="icon-btn tiny doc-more"
                title="更多"
                onClick={(e) => {
                  e.stopPropagation()
                  setMenu(menu === d.id ? null : d.id)
                }}
              >
                <MoreHorizontal size={16} />
              </button>
              {menu === d.id && (
                <div className="menu" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => {
                      setMenu(null)
                      setRenaming(d.id)
                    }}
                  >
                    <Pencil size={14} />
                    重新命名
                  </button>
                  <button
                    className="danger"
                    onClick={() => {
                      setMenu(null)
                      void remove(d)
                    }}
                  >
                    <Trash2 size={14} />
                    從文件庫移除
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
