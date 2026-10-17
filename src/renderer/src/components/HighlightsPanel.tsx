import { useEffect, useRef, useState } from 'react'
import type { Highlight, HighlightColor } from '../../../shared/types'
import { COLORS, COLOR_NAMES } from './SelectionMenu'

interface Props {
  highlights: Highlight[]
  editId: string | null
  onJump: (h: Highlight) => void
  onUpdate: (id: string, patch: Partial<Highlight>) => void
  onDelete: (id: string) => void
}

export function HighlightsPanel({ highlights, editId, onJump, onUpdate, onDelete }: Props) {
  const [filter, setFilter] = useState<HighlightColor | null>(null)
  const sorted = [...highlights]
    .filter((h) => !filter || h.color === filter)
    .sort((a, b) => {
      const ra = a.rects[0]
      const rb = b.rects[0]
      if (ra && rb) return ra.page - rb.page || ra.y - rb.y || ra.x - rb.x
      const pa = Number(a.paraId?.slice(1) ?? 0)
      const pb = Number(b.paraId?.slice(1) ?? 0)
      return pa - pb || (a.start ?? 0) - (b.start ?? 0)
    })

  return (
    <div className="hl-panel">
      <div className="panel-tools">
        <div className="filter-row">
          <button className={`chip ${!filter ? 'active' : ''}`} onClick={() => setFilter(null)}>
            全部 {highlights.length}
          </button>
          {COLORS.map((c) => (
            <button key={c} className={`chip ${filter === c ? 'active' : ''}`} onClick={() => setFilter(filter === c ? null : c)}>
              <span className={`dot sw-${c}`} />
              {COLOR_NAMES[c]} {highlights.filter((h) => h.color === c).length}
            </button>
          ))}
        </div>
      </div>
      <div className="scroll-body">
        {!sorted.length && <div className="empty">在原文選取文字後，按顏色按鈕就能畫線；按「筆記」可以加上註記。</div>}
        {sorted.map((h) => (
          <HighlightItem key={h.id} h={h} autoFocus={h.id === editId} onJump={onJump} onUpdate={onUpdate} onDelete={onDelete} />
        ))}
      </div>
    </div>
  )
}

function HighlightItem({
  h,
  autoFocus,
  onJump,
  onUpdate,
  onDelete
}: {
  h: Highlight
  autoFocus: boolean
  onJump: (h: Highlight) => void
  onUpdate: (id: string, patch: Partial<Highlight>) => void
  onDelete: (id: string) => void
}) {
  const [note, setNote] = useState(h.note)
  const [editing, setEditing] = useState(autoFocus)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (autoFocus) {
      setEditing(true)
      requestAnimationFrame(() => {
        ref.current?.focus()
        ref.current?.scrollIntoView({ block: 'center' })
      })
    }
  }, [autoFocus])

  const save = (): void => {
    if (note !== h.note) onUpdate(h.id, { note })
    setEditing(false)
  }

  return (
    <div className={`hl-item bar-${h.color}`}>
      <div className="hl-text" onClick={() => onJump(h)} title="跳到原文">
        {h.text}
      </div>
      {editing ? (
        <textarea
          ref={ref}
          className="note-input"
          rows={3}
          value={note}
          placeholder="寫下筆記…"
          onChange={(e) => setNote(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save()
          }}
        />
      ) : (
        h.note && (
          <div className="hl-note" onClick={() => setEditing(true)}>
            {h.note}
          </div>
        )
      )}
      <div className="hl-meta">
        {h.rects[0] && <span className="muted small">第 {h.rects[0].page} 頁</span>}
        <span className="spacer" />
        {COLORS.map((c) => (
          <button key={c} className={`swatch tiny sw-${c} ${h.color === c ? 'on' : ''}`} title={COLOR_NAMES[c]} onClick={() => onUpdate(h.id, { color: c })} />
        ))}
        {!editing && (
          <button className="link-btn" onClick={() => setEditing(true)}>
            {h.note ? '編輯筆記' : '加筆記'}
          </button>
        )}
        <button className="link-btn danger" onClick={() => onDelete(h.id)}>
          刪除
        </button>
      </div>
    </div>
  )
}
