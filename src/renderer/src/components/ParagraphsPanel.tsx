import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Languages, Search, Sparkles, Square, Wand2, X } from 'lucide-react'
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
  /** 等待中的段落 → 是否包含分析 */
  pending: Map<string, boolean>
  job: JobState | null
  activeId: string | null
  searchSignal: number
  onHover: (id: string | null) => void
  canResolve: (q: string) => boolean
  onRunAll: (analyze: boolean) => void
  onRunOne: (id: string, analyze: boolean) => void
  onStop: () => void
  onJump: (id: string) => void
  onQuote: (q: string, hintId?: string) => void
  onClear: () => void
}

type Show = { orig: boolean; trans: boolean; ana: boolean; minor: boolean }
const SHOW_KEY = 'ta.paraShow'
const DEFAULT_SHOW: Show = { orig: true, trans: true, ana: true, minor: false }

export function ParagraphsPanel(props: Props) {
  const { paras, results, live, pending, job, activeId, searchSignal } = props
  const [show, setShow] = useState<Show>(() => {
    try {
      return { ...DEFAULT_SHOW, ...JSON.parse(localStorage.getItem(SHOW_KEY) ?? '{}') }
    } catch {
      return DEFAULT_SHOW
    }
  })
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try {
      localStorage.setItem(SHOW_KEY, JSON.stringify(show))
    } catch {
      /* 無法存偏好就算了 */
    }
  }, [show])

  useEffect(() => {
    if (searchSignal) {
      searchRef.current?.focus()
      searchRef.current?.select()
    }
  }, [searchSignal])

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

  const toggle = (k: keyof Show): void => setShow((s) => ({ ...s, [k]: !s[k] }))

  return (
    <div className="para-panel">
      <div className="panel-tools">
        {job ? (
          <div className="job">
            <span className="job-text">
              <Sparkles size={14} className="spin-soft" />
              {job.analyze ? '翻譯與分析中' : '翻譯中'}
              <span className="muted">
                {job.done}/{job.total} 段
              </span>
            </span>
            <div className="progress">
              <div style={{ width: `${job.total ? Math.max(3, (job.done / job.total) * 100) : 0}%` }} />
            </div>
            <button className="btn small" onClick={props.onStop}>
              <Square size={11} fill="currentColor" />
              停止
            </button>
          </div>
        ) : (
          <div className="run-row">
            <button className="btn primary" onClick={() => props.onRunAll(false)} title="翻譯所有尚未翻譯的段落">
              <Languages size={15} />
              全文翻譯
            </button>
            <button className="btn" onClick={() => props.onRunAll(true)} title="翻譯並逐段分析，分析會引用原文">
              <Wand2 size={15} />
              翻譯＋逐段分析
            </button>
            <span className="spacer" />
            <span className="stat" title="已翻譯／已分析的段落數">
              譯 {translated}/{main.length}・析 {analyzed}/{bodyCount}
            </span>
          </div>
        )}
        <div className="filter-row">
          <div className="search-box">
            <Search size={14} />
            <input
              ref={searchRef}
              placeholder="搜尋原文、譯文、分析（Ctrl+F）"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            />
            {query && (
              <button className="icon-btn tiny" onClick={() => setQuery('')} title="清除">
                <X size={13} />
              </button>
            )}
          </div>
          <div className="seg mini">
            <button className={show.orig ? 'on' : ''} onClick={() => toggle('orig')}>
              原文
            </button>
            <button className={show.trans ? 'on' : ''} onClick={() => toggle('trans')}>
              譯文
            </button>
            <button className={show.ana ? 'on' : ''} onClick={() => toggle('ana')}>
              分析
            </button>
            <button className={show.minor ? 'on' : ''} onClick={() => toggle('minor')} title="圖表說明、短行、參考文獻">
              其他
            </button>
          </div>
        </div>
      </div>
      <div className="para-list" ref={listRef} onMouseLeave={() => props.onHover(null)}>
        {!paras.length && <div className="empty">這份文件沒有可選取的文字。如果是掃描檔，需要先用 OCR 軟體轉成文字 PDF。</div>}
        {paras.length > 0 && !visible.length && <div className="empty">沒有符合「{query}」的段落</div>}
        {visible.map((p) => (
          <ParaCard
            key={p.id}
            p={p}
            r={live[p.id] ?? results[p.id]}
            pending={pending.has(p.id)}
            pendingAna={pending.get(p.id) === true}
            active={activeId === p.id}
            show={show}
            canResolve={props.canResolve}
            onRunOne={props.onRunOne}
            onJump={props.onJump}
            onQuote={props.onQuote}
            onHover={props.onHover}
          />
        ))}
        {translated > 0 && !job && !query && (
          <div className="list-foot">
            <button className="link-btn muted-link" onClick={props.onClear}>
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
  pendingAna,
  active,
  show,
  canResolve,
  onRunOne,
  onJump,
  onQuote,
  onHover
}: {
  p: Para
  r?: ParaResult
  pending: boolean
  pendingAna: boolean
  active: boolean
  show: { orig: boolean; trans: boolean; ana: boolean }
  canResolve: (q: string) => boolean
  onRunOne: (id: string, analyze: boolean) => void
  onJump: (id: string) => void
  onQuote: (q: string, hintId?: string) => void
  onHover: (id: string | null) => void
}) {
  const [expanded, setExpanded] = useState(false)
  // 段落自己的分析不需要再標自己的編號
  const analysis = useMemo(
    () => r?.analysis?.replace(new RegExp(`\\s*\\[${p.id}\\](?!\\()`, 'g'), '').replace(/^(\s*[-*]\s*)[:：]\s*/gm, '$1'),
    [r?.analysis, p.id]
  )

  if (p.kind === 'heading') {
    return (
      <div className={`para-heading ${active ? 'active' : ''}`} data-card={p.id} onClick={() => onJump(p.id)} onMouseEnter={() => onHover(p.id)}>
        <span className="h-orig">{p.text.trim()}</span>
        {show.trans && (r?.translation ? <span className="h-trans">{r.translation}</span> : pending && <span className="skeleton short" />)}
      </div>
    )
  }

  const waitingTrans = pending && !r?.translation
  const waitingAna = pendingAna && !analysis

  return (
    <div className={`para-card ${active ? 'active' : ''} ${pending ? 'pending' : ''} kind-${p.kind}`} data-card={p.id} onMouseEnter={() => onHover(p.id)}>
      <div className="card-head">
        <button className="cite" onClick={() => onJump(p.id)} title="在原文中顯示這段">
          {p.id}
        </button>
        {p.page > 0 && <span className="page-tag">第 {p.page} 頁</span>}
        <span className="spacer" />
        {!pending && (
          <div className="card-actions">
            <button className="icon-btn tiny" onClick={() => onRunOne(p.id, false)} title={r?.translation ? '重新翻譯這段' : '翻譯這段'}>
              <Languages size={14} />
            </button>
            <button className="icon-btn tiny" onClick={() => onRunOne(p.id, true)} title={analysis ? '重新分析這段' : '翻譯並分析這段'}>
              <Sparkles size={14} />
            </button>
          </div>
        )}
      </div>
      {show.orig && (
        <div className={`orig ${expanded ? 'expanded' : ''}`} onClick={() => setExpanded((v) => !v)} title={expanded ? '點一下收合' : '點一下展開全文'}>
          {p.text.trim()}
        </div>
      )}
      {show.trans &&
        (r?.translation ? (
          <div className="trans">{r.translation}</div>
        ) : waitingTrans ? (
          <div className="skeleton-block">
            <span className="skeleton" />
            <span className="skeleton" />
            <span className="skeleton short" />
          </div>
        ) : (
          !show.orig && <div className="muted small">尚未翻譯</div>
        ))}
      {show.ana && analysis && (
        <div className="analysis">
          <div className="analysis-label">
            <Sparkles size={12} />
            AI 分析
          </div>
          <RichText text={analysis} canResolve={canResolve} onCite={onJump} onQuote={(q) => onQuote(q, p.id)} />
        </div>
      )}
      {show.ana && waitingAna && (
        <div className="analysis">
          <div className="analysis-label">
            <Sparkles size={12} className="spin-soft" />
            分析中…
          </div>
        </div>
      )}
    </div>
  )
})
