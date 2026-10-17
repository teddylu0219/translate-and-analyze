import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ParaResult } from '../../../shared/types'
import type { Para } from '../lib/paragraphs'
import { RichText } from './RichText'

export interface JobState {
  analyze: boolean
  done: number
  total: number
}

interface Props {
  paras: Para[]
  results: Record<string, ParaResult>
  live: Record<string, ParaResult>
  pending: Set<string>
  job: JobState | null
  activeId: string | null
  canResolve: (q: string) => boolean
  onRunAll: (analyze: boolean) => void
  onRunOne: (id: string, analyze: boolean) => void
  onStop: () => void
  onJump: (id: string) => void
  onQuote: (q: string, hintId?: string) => void
  onClear: () => void
}

const SHOW_KEY = 'ta.paraShow'

export function ParagraphsPanel(props: Props) {
  const { paras, results, live, pending, job, activeId } = props
  const [show, setShow] = useState<{ orig: boolean; trans: boolean; ana: boolean; minor: boolean }>(() => {
    try {
      return { orig: true, trans: true, ana: true, minor: false, ...JSON.parse(localStorage.getItem(SHOW_KEY) ?? '{}') }
    } catch {
      return { orig: true, trans: true, ana: true, minor: false }
    }
  })
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      localStorage.setItem(SHOW_KEY, JSON.stringify(show))
    } catch {
      /* 無法存偏好就算了 */
    }
  }, [show])

  // 在原文點到的段落，自動捲到對應卡片
  useEffect(() => {
    if (!activeId) return
    listRef.current?.querySelector(`[data-card="${activeId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeId])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return paras.filter((p) => {
      if (!show.minor && (p.kind === 'minor' || p.kind === 'ref')) return false
      if (!q) return true
      const r = results[p.id]
      return p.text.toLowerCase().includes(q) || r?.translation?.toLowerCase().includes(q) || r?.analysis?.toLowerCase().includes(q)
    })
  }, [paras, show.minor, query, results])

  const main = paras.filter((p) => p.kind === 'body' || p.kind === 'heading')
  const translated = main.filter((p) => results[p.id]?.translation).length
  const analyzed = paras.filter((p) => p.kind === 'body' && results[p.id]?.analysis).length
  const bodyCount = paras.filter((p) => p.kind === 'body').length

  const toggle = (k: keyof typeof show): void => setShow((s) => ({ ...s, [k]: !s[k] }))

  return (
    <div className="para-panel">
      <div className="panel-tools">
        {job ? (
          <div className="job">
            <div className="job-text">
              {job.analyze ? '翻譯＋分析中' : '翻譯中'}… {job.done}/{job.total}
            </div>
            <div className="progress">
              <div style={{ width: `${job.total ? (job.done / job.total) * 100 : 0}%` }} />
            </div>
            <button className="btn small" onClick={props.onStop}>
              停止
            </button>
          </div>
        ) : (
          <div className="run-row">
            <button className="btn primary" onClick={() => props.onRunAll(false)}>
              全文翻譯
            </button>
            <button className="btn" onClick={() => props.onRunAll(true)}>
              翻譯＋逐段分析
            </button>
            <span className="muted small">
              已譯 {translated}/{main.length}・已析 {analyzed}/{bodyCount}
            </span>
          </div>
        )}
        <div className="filter-row">
          <input className="search" placeholder="搜尋原文、譯文、分析…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <label className="check">
            <input type="checkbox" checked={show.orig} onChange={() => toggle('orig')} />
            原文
          </label>
          <label className="check">
            <input type="checkbox" checked={show.trans} onChange={() => toggle('trans')} />
            譯文
          </label>
          <label className="check">
            <input type="checkbox" checked={show.ana} onChange={() => toggle('ana')} />
            分析
          </label>
          <label className="check" title="圖表說明、短行、參考文獻">
            <input type="checkbox" checked={show.minor} onChange={() => toggle('minor')} />
            其他
          </label>
        </div>
      </div>
      <div className="para-list" ref={listRef}>
        {!paras.length && <div className="empty">這份文件沒有可選取的文字。如果是掃描檔，需要先用 OCR 軟體轉成文字 PDF。</div>}
        {visible.map((p) => (
          <ParaCard
            key={p.id}
            p={p}
            r={live[p.id] ?? results[p.id]}
            pending={pending.has(p.id)}
            active={activeId === p.id}
            show={show}
            canResolve={props.canResolve}
            onRunOne={props.onRunOne}
            onJump={props.onJump}
            onQuote={props.onQuote}
          />
        ))}
        {translated > 0 && !job && (
          <div className="list-foot">
            <button className="link-btn" onClick={props.onClear}>
              清除這份文件的所有譯文與分析
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const ParaCard = memo(function ParaCard({
  p,
  r,
  pending,
  active,
  show,
  canResolve,
  onRunOne,
  onJump,
  onQuote
}: {
  p: Para
  r?: ParaResult
  pending: boolean
  active: boolean
  show: { orig: boolean; trans: boolean; ana: boolean }
  canResolve: (q: string) => boolean
  onRunOne: (id: string, analyze: boolean) => void
  onJump: (id: string) => void
  onQuote: (q: string, hintId?: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const pageLabel = p.page ? `第 ${p.page} 頁` : ''

  if (p.kind === 'heading') {
    return (
      <div className={`para-heading ${active ? 'active' : ''}`} data-card={p.id} onClick={() => onJump(p.id)}>
        <span className="h-orig">{p.text.trim()}</span>
        {r?.translation && show.trans && <span className="h-trans">{r.translation}</span>}
      </div>
    )
  }

  return (
    <div className={`para-card ${active ? 'active' : ''} kind-${p.kind}`} data-card={p.id}>
      <div className="card-head">
        <button className="cite" onClick={() => onJump(p.id)} title="在原文中顯示">
          {p.id}
        </button>
        <span className="muted small">{pageLabel}</span>
        <span className="spacer" />
        {pending ? (
          <span className="muted small spin">處理中…</span>
        ) : (
          <>
            <button className="link-btn" onClick={() => onRunOne(p.id, false)}>
              {r?.translation ? '重新翻譯' : '翻譯'}
            </button>
            <button className="link-btn" onClick={() => onRunOne(p.id, true)}>
              {r?.analysis ? '重新分析' : '分析'}
            </button>
          </>
        )}
      </div>
      {show.orig && (
        <div className={`orig ${expanded ? 'expanded' : ''}`} onClick={() => setExpanded((v) => !v)} title={expanded ? '收合' : '展開全文'}>
          {p.text.trim()}
        </div>
      )}
      {show.trans && r?.translation && <div className="trans">{r.translation}</div>}
      {show.ana && r?.analysis && (
        <div className="analysis">
          <RichText text={r.analysis} canResolve={canResolve} onCite={onJump} onQuote={(q) => onQuote(q, p.id)} />
        </div>
      )}
    </div>
  )
})
