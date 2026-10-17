import { useEffect, useState } from 'react'
import type { DocMeta } from '../../../shared/types'
import { useApp } from '../lib/appContext'

const fmtSize = (n: number): string => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const fmtDate = (t: number): string => new Date(t).toLocaleDateString('zh-TW', { year: 'numeric', month: 'short', day: 'numeric' })

export function Library({ onOpen, refreshKey }: { onOpen: (d: DocMeta) => void; refreshKey: number }) {
  const { aiReady, openSettings, toast } = useApp()
  const [docs, setDocs] = useState<DocMeta[] | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const reload = async (): Promise<void> => setDocs(await window.api.listDocs())
  useEffect(() => {
    void reload()
  }, [refreshKey])

  const pick = async (): Promise<void> => {
    try {
      const added = await window.api.pickDocs()
      if (added.length === 1) onOpen(added[0])
      else void reload()
    } catch (e) {
      toast((e as Error)?.message ?? '無法開啟檔案', 'error')
    }
  }

  const shown = (docs ?? []).filter((d) => !query.trim() || d.title.toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <div className="library">
      <div className="lib-inner">
        {!aiReady && (
          <div className="signin-card">
            <div>
              <strong>先連接 ChatGPT</strong>
              <div className="muted">翻譯與分析會使用你的 ChatGPT 方案（Plus / Pro），不需要另外付費或 API key。</div>
            </div>
            <button className="btn chatgpt" onClick={() => openSettings()}>
              Continue with ChatGPT
            </button>
          </div>
        )}
        <div className="lib-head">
          <h1>我的文件</h1>
          <span className="spacer" />
          {docs && docs.length > 5 && <input className="search" placeholder="搜尋文件…" value={query} onChange={(e) => setQuery(e.target.value)} />}
          <button className="btn primary" onClick={pick}>
            ＋ 開啟 PDF / TXT
          </button>
        </div>
        {docs && !docs.length && (
          <button className="drop-hint" onClick={pick}>
            <div className="drop-icon">📄</div>
            <div className="drop-title">把 PDF 或 TXT 檔拖曳到這個視窗</div>
            <div className="muted">或點這裡選擇檔案</div>
          </button>
        )}
        <div className="doc-grid">
          {shown.map((d) => (
            <div key={d.id} className="doc-card" onClick={() => renaming !== d.id && onOpen(d)}>
              <div className={`doc-type t-${d.type}`}>{d.type.toUpperCase()}</div>
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
              <div className="muted small">
                {fmtDate(d.openedAt)}・{fmtSize(d.size)}
              </div>
              <div className="doc-actions" onClick={(e) => e.stopPropagation()}>
                <button className="link-btn" onClick={() => setRenaming(d.id)}>
                  重新命名
                </button>
                <button
                  className="link-btn danger"
                  onClick={async () => {
                    if (!confirm(`確定要從文件庫移除「${d.title}」？\n畫線、筆記與譯文也會一起刪除（原始檔案不受影響）。`)) return
                    await window.api.removeDoc(d.id)
                    void reload()
                  }}
                >
                  移除
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
