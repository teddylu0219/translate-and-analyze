import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { ChatMsg, DocMeta, Highlight, HighlightColor, ParaResult, Rect } from '../../../shared/types'
import { useApp } from '../lib/appContext'
import { useDocData } from '../lib/useDocData'
import { decodeText, loadPdf } from '../lib/pdf'
import { buildQuoteIndex, extractPdfParagraphs, extractTextParagraphs, findQuote, rectsForRange, type Para } from '../lib/paragraphs'
import { runAI, type AiRun } from '../lib/ai'
import { chatRequest, paragraphsRequest, parseParagraphOutput, summaryRequest } from '../lib/prompts'
import { buildMarkdown } from '../lib/exportMarkdown'
import { PdfView } from './PdfView'
import { TextView } from './TextView'
import { mergeLineRects, pointInRect, type PointClick, type SelectionInfo, type ViewerHandle } from './viewer'
import { COLORS, COLOR_NAMES, SelectionMenu } from './SelectionMenu'
import { ParagraphsPanel, type JobState } from './ParagraphsPanel'
import { SummaryPanel } from './SummaryPanel'
import { ChatPanel } from './ChatPanel'
import { HighlightsPanel } from './HighlightsPanel'

type Tab = 'paras' | 'summary' | 'chat' | 'notes'
const TABS: { id: Tab; label: string }[] = [
  { id: 'paras', label: '逐段翻譯・分析' },
  { id: 'summary', label: '導讀' },
  { id: 'chat', label: '問答' },
  { id: 'notes', label: '畫線筆記' }
]

const lsGet = (k: string, d: string): string => {
  try {
    return localStorage.getItem(k) ?? d
  } catch {
    return d
  }
}
const lsSet = (k: string, v: string): void => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* 略過 */
  }
}

/** 把段落分批：每批字數與段數有上限，模型輸出比較穩定 */
function chunk(paras: Para[], analyze: boolean): Para[][] {
  const maxChars = analyze ? 1800 : 3200
  const maxCount = analyze ? 4 : 10
  const out: Para[][] = []
  let cur: Para[] = []
  let size = 0
  for (const p of paras) {
    if (cur.length && (size + p.text.length > maxChars || cur.length >= maxCount)) {
      out.push(cur)
      cur = []
      size = 0
    }
    cur.push(p)
    size += p.text.length
  }
  if (cur.length) out.push(cur)
  return out
}

const newId = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

export function Reader({ doc, onBack }: { doc: DocMeta; onBack: () => void }) {
  const { settings, aiReady, reportAiError, openSettings, toast } = useApp()
  const [data, update] = useDocData(doc.id)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [paras, setParas] = useState<Para[] | null>(null)
  const [loadState, setLoadState] = useState<{ error?: string; progress: number }>({ progress: 0 })
  const viewer = useRef<ViewerHandle>(null)

  const [tab, setTabState] = useState<Tab>(() => lsGet('ta.tab', 'paras') as Tab)
  const setTab = (t: Tab): void => {
    setTabState(t)
    lsSet('ta.tab', t)
  }
  const [panelW, setPanelW] = useState(() => Number(lsGet('ta.panelW', '480')) || 480)

  const [flash, setFlash] = useState<Rect[] | null>(null)
  const [flashRange, setFlashRange] = useState<{ paraId: string; start: number; end: number } | null>(null)
  const flashTimer = useRef<number | undefined>(undefined)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [sel, setSel] = useState<SelectionInfo | null>(null)
  const [hlPop, setHlPop] = useState<{ h: Highlight; x: number; y: number } | null>(null)
  const [editId, setEditId] = useState<string | null>(null)

  const [live, setLive] = useState<Record<string, ParaResult>>({})
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [job, setJob] = useState<JobState | null>(null)
  const stopJob = useRef<(() => void) | null>(null)
  const allRuns = useRef(new Set<AiRun>())

  const [liveSummary, setLiveSummary] = useState<string | null>(null)
  const summaryRun = useRef<AiRun | null>(null)
  const [liveChat, setLiveChat] = useState<string | null>(null)
  const chatRun = useRef<AiRun | null>(null)
  const [quote, setQuote] = useState<string | null>(null)
  const [focusSignal, setFocusSignal] = useState(0)

  const lang = settings?.targetLang ?? ''
  const results = useMemo(() => data?.paras[lang] ?? {}, [data, lang])
  const resultsRef = useRef(results)
  resultsRef.current = results

  // 載入檔案、抽出段落
  useEffect(() => {
    let alive = true
    let loaded: PDFDocumentProxy | null = null
    ;(async () => {
      try {
        const bytes = await window.api.readDoc(doc.id)
        void window.api.touchDoc(doc.id)
        if (doc.type === 'pdf') {
          loaded = await loadPdf(bytes)
          if (!alive) return
          setPdf(loaded)
          const ps = await extractPdfParagraphs(loaded, (progress) => alive && setLoadState({ progress }))
          if (alive) setParas(ps)
        } else {
          setParas(extractTextParagraphs(decodeText(bytes)))
        }
      } catch (e) {
        if (alive) setLoadState({ progress: 0, error: (e as Error)?.message ?? String(e) })
      }
    })()
    return () => {
      alive = false
      void loaded?.loadingTask.destroy()
    }
  }, [doc.id, doc.type])

  useEffect(() => {
    const runs = allRuns.current
    return () => runs.forEach((r) => r.cancel())
  }, [])

  const quoteIndex = useMemo(() => buildQuoteIndex(paras ?? []), [paras])
  const resolveCache = useMemo(() => new Map<string, boolean>(), [quoteIndex])
  const canResolve = useCallback(
    (q: string) => {
      let v = resolveCache.get(q)
      if (v === undefined) {
        v = !!findQuote(quoteIndex, q)
        resolveCache.set(q, v)
      }
      return v
    },
    [quoteIndex, resolveCache]
  )

  const doFlash = (rects: Rect[] | null, range: typeof flashRange = null): void => {
    window.clearTimeout(flashTimer.current)
    setFlash(rects)
    setFlashRange(range)
    flashTimer.current = window.setTimeout(() => {
      setFlash(null)
      setFlashRange(null)
    }, 2200)
  }

  const jumpToPara = useCallback(
    (id: string) => {
      const p = paras?.find((x) => x.id === id)
      if (!p) return
      setActiveId(id)
      viewer.current?.scrollToPara(p)
      if (doc.type === 'pdf') doFlash(mergeLineRects(p.pieces.map((pc) => pc.rect)))
      else doFlash(null, { paraId: p.id, start: 0, end: p.text.length })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paras, doc.type]
  )

  const jumpToQuote = useCallback(
    (q: string, hintId?: string) => {
      const found = findQuote(quoteIndex, q, hintId)
      if (!found) {
        toast('在原文中找不到這段引用')
        return
      }
      setActiveId(found.para.id)
      if (doc.type === 'pdf') {
        const rects = mergeLineRects(rectsForRange(found.para, found.start, found.end))
        viewer.current?.scrollToRects(rects)
        doFlash(rects)
      } else {
        viewer.current?.scrollToPara(found.para)
        doFlash(null, { paraId: found.para.id, start: found.start, end: found.end })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [quoteIndex, doc.type, toast]
  )

  const jumpToHighlight = (h: Highlight): void => {
    if (h.rects.length) {
      viewer.current?.scrollToRects(h.rects)
      doFlash(h.rects)
    } else if (h.paraId) {
      const p = paras?.find((x) => x.id === h.paraId)
      if (p) viewer.current?.scrollToPara(p)
      doFlash(null, { paraId: h.paraId, start: h.start ?? 0, end: h.end ?? 0 })
    }
  }

  // ---------- 逐段翻譯／分析 ----------

  const commit = (parsed: ReturnType<typeof parseParagraphOutput>, analyze: boolean): void => {
    if (!parsed.length) return
    update((d) => {
      const cur = { ...(d.paras[lang] ?? {}) }
      for (const p of parsed) {
        const prev = cur[p.id] ?? {}
        cur[p.id] = {
          translation: p.translation || prev.translation,
          analysis: analyze ? p.analysis || prev.analysis : prev.analysis
        }
      }
      return { ...d, paras: { ...d.paras, [lang]: cur } }
    })
  }

  const runParagraphs = async (targets: Para[], analyze: boolean, asJob: boolean): Promise<void> => {
    if (!settings || !paras) return
    if (!aiReady) {
      openSettings()
      return
    }
    const chunks = chunk(targets, analyze)
    let cancelled = false
    const runs = new Set<AiRun>()
    const ids = targets.map((p) => p.id)
    setPending((s) => new Set([...s, ...ids]))
    if (asJob) {
      setJob({ analyze, done: 0, total: targets.length })
      stopJob.current = () => {
        cancelled = true
        runs.forEach((r) => r.cancel())
      }
    }
    let next = 0
    const worker = async (): Promise<void> => {
      while (!cancelled && next < chunks.length) {
        const group = chunks[next++]
        const idx = paras.findIndex((p) => p.id === group[0].id)
        const prevText = idx > 0 ? paras[idx - 1].text : undefined
        const req = paragraphsRequest({ title: doc.title, paras: group, lang, custom: settings.customInstructions, analyze, prevText })
        const run = runAI(req, (full) => {
          const parsed = parseParagraphOutput(full)
          setLive((l) => {
            const n = { ...l }
            for (const p of parsed) {
              const prev = resultsRef.current[p.id] ?? {}
              n[p.id] = { translation: p.translation || prev.translation, analysis: analyze ? p.analysis : prev.analysis }
            }
            return n
          })
        })
        runs.add(run)
        allRuns.current.add(run)
        try {
          commit(parseParagraphOutput(await run.done), analyze)
        } catch (e) {
          if (!cancelled) {
            cancelled = true
            runs.forEach((r) => r.cancel())
            reportAiError(e)
          }
        } finally {
          runs.delete(run)
          allRuns.current.delete(run)
          const gid = new Set(group.map((p) => p.id))
          setLive((l) => Object.fromEntries(Object.entries(l).filter(([k]) => !gid.has(k))))
          setPending((s) => new Set([...s].filter((k) => !gid.has(k))))
          if (asJob) setJob((j) => (j ? { ...j, done: j.done + group.length } : j))
        }
      }
    }
    await Promise.all([worker(), worker()])
    // 被停止時，還沒開始的段落也要移出等待中
    setPending((s) => new Set([...s].filter((k) => !ids.includes(k))))
    if (asJob) {
      setJob(null)
      stopJob.current = null
      if (!cancelled) toast(analyze ? '全文翻譯與分析完成' : '全文翻譯完成')
    }
  }

  const runAll = (analyze: boolean): void => {
    if (!paras) return
    const targets = paras.filter((p) =>
      p.kind === 'heading' ? !results[p.id]?.translation : p.kind === 'body' && (analyze ? !results[p.id]?.analysis : !results[p.id]?.translation)
    )
    if (!targets.length) {
      toast('已經全部完成了')
      return
    }
    void runParagraphs(targets, analyze, true)
  }

  const runOne = (id: string, analyze: boolean): void => {
    const p = paras?.find((x) => x.id === id)
    if (p) void runParagraphs([p], analyze, false)
  }

  // ---------- 導讀 ----------

  const generateSummary = async (): Promise<void> => {
    if (!settings || !paras) return
    if (!aiReady) return openSettings()
    setLiveSummary('')
    const run = runAI(summaryRequest(doc.title, paras, lang, settings.customInstructions), setLiveSummary)
    summaryRun.current = run
    allRuns.current.add(run)
    try {
      const text = await run.done
      update((d) => ({ ...d, summaries: { ...d.summaries, [lang]: text } }))
    } catch (e) {
      reportAiError(e)
    } finally {
      allRuns.current.delete(run)
      setLiveSummary(null)
    }
  }

  // ---------- 問答 ----------

  const sendChat = async (text: string, withQuote: string | null = quote): Promise<void> => {
    if (!settings || !paras || !data) return
    if (!aiReady) return openSettings()
    const msg: ChatMsg = { role: 'user', text, ...(withQuote ? { quote: withQuote } : {}) }
    const history = [...data.chat, msg]
    update((d) => ({ ...d, chat: [...d.chat, msg] }))
    setQuote(null)
    setLiveChat('')
    const run = runAI(chatRequest(doc.title, paras, lang, settings.customInstructions, history), setLiveChat)
    chatRun.current = run
    allRuns.current.add(run)
    try {
      const answer = await run.done
      update((d) => ({ ...d, chat: [...d.chat, { role: 'assistant', text: answer }] }))
    } catch (e) {
      const err = e as { code?: string; message?: string }
      if (err?.code !== 'cancelled') {
        update((d) => ({ ...d, chat: [...d.chat, { role: 'assistant', text: err?.message ?? String(e), error: true }] }))
        reportAiError(e)
      }
    } finally {
      allRuns.current.delete(run)
      setLiveChat(null)
    }
  }

  // ---------- 畫線 ----------

  const addHighlight = (color: HighlightColor, withNote = false): void => {
    if (!sel) return
    const h: Highlight = {
      id: newId(),
      text: sel.text,
      color,
      note: '',
      createdAt: Date.now(),
      rects: sel.rects,
      ...(sel.paraId ? { paraId: sel.paraId, start: sel.start, end: sel.end } : {})
    }
    update((d) => ({ ...d, highlights: [...d.highlights, h] }))
    if (withNote) {
      setTab('notes')
      setEditId(h.id)
    }
    closeSelection()
  }

  const updateHighlight = (id: string, patch: Partial<Highlight>): void =>
    update((d) => ({ ...d, highlights: d.highlights.map((h) => (h.id === id ? { ...h, ...patch } : h)) }))
  const deleteHighlight = (id: string): void => update((d) => ({ ...d, highlights: d.highlights.filter((h) => h.id !== id) }))

  const closeSelection = useCallback(() => {
    setSel(null)
    window.getSelection()?.removeAllRanges()
  }, [])

  const onPointClick = (pc: PointClick): void => {
    if (!data || !paras) return
    if (doc.type === 'pdf') {
      const hit = [...data.highlights].reverse().find((h) => h.rects.some((r) => pointInRect(r, pc.page, pc.x, pc.y, 0)))
      if (hit) {
        setHlPop({ h: hit, x: pc.clientX, y: pc.clientY })
        return
      }
      const para = paras.find((p) => p.pieces.some((pc2) => pointInRect(pc2.rect, pc.page, pc.x, pc.y)))
      if (para) setActiveId(para.id)
    } else if (pc.paraId) {
      if (pc.offset !== undefined) {
        const hit = data.highlights.find((h) => h.paraId === pc.paraId && (h.start ?? 0) <= pc.offset! && (h.end ?? 0) > pc.offset!)
        if (hit) {
          setHlPop({ h: hit, x: pc.clientX, y: pc.clientY })
          return
        }
      }
      setActiveId(pc.paraId)
    }
  }

  const exportNotes = async (): Promise<void> => {
    if (!paras || !data) return
    const md = buildMarkdown({ title: doc.title, paras, results, summary: data.summaries[lang], highlights: data.highlights })
    try {
      const path = await window.api.exportMarkdown(doc.title, md)
      if (path) toast('已匯出筆記')
    } catch (e) {
      toast((e as Error)?.message ?? '匯出失敗', 'error')
    }
  }

  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startW = panelW
    let w = startW
    const move = (ev: MouseEvent): void => {
      w = Math.min(Math.max(340, startW - (ev.clientX - startX)), window.innerWidth - 420)
      setPanelW(w)
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('resizing')
      lsSet('ta.panelW', String(Math.round(w)))
    }
    document.body.classList.add('resizing')
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const ready = !!paras && !!data && (doc.type === 'txt' || !!pdf)

  return (
    <div className="reader-layout" style={{ gridTemplateColumns: `1fr 6px ${panelW}px` }}>
      <section className="reader-main">
        <div className="reader-head">
          <button className="btn ghost" onClick={onBack} title="回到文件庫">
            ← 文件庫
          </button>
          <div className="doc-title" title={doc.title}>
            {doc.title}
          </div>
          <span className="spacer" />
          {ready && (
            <button className="btn ghost" onClick={exportNotes} title="匯出導讀、畫線、筆記、譯文為 Markdown">
              匯出筆記
            </button>
          )}
        </div>
        {loadState.error ? (
          <div className="empty">
            無法開啟這份檔案：{loadState.error}
            <br />
            檔案可能損毀或有密碼保護。
          </div>
        ) : !ready ? (
          <div className="empty">
            正在分析文件結構… {Math.round(loadState.progress * 100)}%
          </div>
        ) : doc.type === 'pdf' ? (
          <PdfView
            ref={viewer}
            pdf={pdf!}
            paras={paras}
            highlights={data.highlights}
            flash={flash}
            onSelection={(s) => {
              setHlPop(null)
              setSel(s)
            }}
            onPointClick={onPointClick}
            initialPage={data.lastPage}
            onPageChange={(n) => update((d) => ({ ...d, lastPage: n }))}
          />
        ) : (
          <TextView
            ref={viewer}
            paras={paras}
            highlights={data.highlights}
            flash={null}
            flashRange={flashRange}
            onSelection={(s) => {
              setHlPop(null)
              setSel(s)
            }}
            onPointClick={onPointClick}
          />
        )}
      </section>
      <div className="resizer" onMouseDown={startResize} title="拖曳調整寬度" />
      <aside className="side-panel" style={{ fontSize: settings?.panelFontSize ?? 15 }}>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === 'notes' && data?.highlights.length ? <span className="badge">{data.highlights.length}</span> : null}
            </button>
          ))}
        </nav>
        {!aiReady && (
          <div className="banner warn">
            尚未連接 AI。
            <button className="link-btn" onClick={() => openSettings()}>
              {settings?.provider === 'apikey' ? '前往設定 API key' : '用 ChatGPT 登入'}
            </button>
          </div>
        )}
        {ready && tab === 'paras' && (
          <ParagraphsPanel
            paras={paras}
            results={results}
            live={live}
            pending={pending}
            job={job}
            activeId={activeId}
            canResolve={canResolve}
            onRunAll={runAll}
            onRunOne={runOne}
            onStop={() => stopJob.current?.()}
            onJump={jumpToPara}
            onQuote={jumpToQuote}
            onClear={() => {
              if (confirm('確定要清除這份文件（目前語言）的所有譯文與分析嗎？')) update((d) => ({ ...d, paras: { ...d.paras, [lang]: {} } }))
            }}
          />
        )}
        {ready && tab === 'summary' && (
          <SummaryPanel
            text={data.summaries[lang]}
            live={liveSummary}
            canResolve={canResolve}
            onGenerate={generateSummary}
            onStop={() => summaryRun.current?.cancel()}
            onCite={jumpToPara}
            onQuote={jumpToQuote}
          />
        )}
        {ready && tab === 'chat' && (
          <ChatPanel
            messages={data.chat}
            live={liveChat}
            quote={quote}
            setQuote={setQuote}
            focusSignal={focusSignal}
            canResolve={canResolve}
            onSend={(t) => void sendChat(t)}
            onStop={() => chatRun.current?.cancel()}
            onClear={() => update((d) => ({ ...d, chat: [] }))}
            onCite={jumpToPara}
            onQuote={jumpToQuote}
          />
        )}
        {ready && tab === 'notes' && (
          <HighlightsPanel highlights={data.highlights} editId={editId} onJump={jumpToHighlight} onUpdate={updateHighlight} onDelete={deleteHighlight} />
        )}
      </aside>

      {sel && (
        <SelectionMenu
          sel={sel}
          canHighlight={doc.type === 'pdf' ? sel.rects.length > 0 : !!sel.paraId}
          onClose={closeSelection}
          onHighlight={addHighlight}
          onExplain={() => {
            const text = sel.text
            closeSelection()
            setTab('chat')
            void sendChat('請解釋這段文字的意思，以及它在文中的作用。', text)
          }}
          onAsk={() => {
            setQuote(sel.text)
            closeSelection()
            setTab('chat')
            setFocusSignal((n) => n + 1)
          }}
        />
      )}
      {hlPop && (
        <HighlightPopover
          pop={hlPop}
          onClose={() => setHlPop(null)}
          onColor={(c) => {
            updateHighlight(hlPop.h.id, { color: c })
            setHlPop(null)
          }}
          onNote={() => {
            setTab('notes')
            setEditId(hlPop.h.id)
            setHlPop(null)
          }}
          onAsk={() => {
            setQuote(hlPop.h.text)
            setTab('chat')
            setFocusSignal((n) => n + 1)
            setHlPop(null)
          }}
          onDelete={() => {
            deleteHighlight(hlPop.h.id)
            setHlPop(null)
          }}
        />
      )}
    </div>
  )
}

function HighlightPopover({
  pop,
  onClose,
  onColor,
  onNote,
  onAsk,
  onDelete
}: {
  pop: { h: Highlight; x: number; y: number }
  onClose: () => void
  onColor: (c: HighlightColor) => void
  onNote: () => void
  onAsk: () => void
  onDelete: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const down = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])
  return (
    <div
      ref={ref}
      className="sel-menu"
      style={{ left: Math.min(pop.x - 140, window.innerWidth - 300), top: Math.min(pop.y + 12, window.innerHeight - 160) }}
      onMouseUp={(e) => e.stopPropagation()}
    >
      {pop.h.note && <div className="pop-note">{pop.h.note}</div>}
      <div className="sel-actions">
        {COLORS.map((c) => (
          <button key={c} className={`swatch sw-${c} ${pop.h.color === c ? 'on' : ''}`} title={COLOR_NAMES[c]} onClick={() => onColor(c)} />
        ))}
        <span className="sep" />
        <button onClick={onNote}>{pop.h.note ? '編輯筆記' : '加筆記'}</button>
        <button onClick={onAsk}>問 AI</button>
        <button className="danger" onClick={onDelete}>
          刪除
        </button>
      </div>
    </div>
  )
}
