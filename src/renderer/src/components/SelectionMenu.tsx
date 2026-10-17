import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Copy, Languages, Lightbulb, MessageSquareText, StickyNote } from 'lucide-react'
import type { HighlightColor } from '../../../shared/types'
import { runAI, type AiRun } from '../lib/ai'
import { selectionTranslateRequest } from '../lib/prompts'
import { useApp } from '../lib/appContext'
import { RichText } from './RichText'
import type { SelectionInfo } from './viewer'

export const COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'pink']
export const COLOR_NAMES: Record<HighlightColor, string> = { yellow: '黃', green: '綠', blue: '藍', pink: '粉紅' }

interface Props {
  sel: SelectionInfo
  canHighlight: boolean
  onClose: () => void
  onHighlight: (color: HighlightColor, withNote?: boolean) => void
  onExplain: () => void
  onAsk: () => void
}

export function SelectionMenu({ sel, canHighlight, onClose, onHighlight, onExplain, onAsk }: Props) {
  const { settings, aiReady, reportAiError, openSettings, toast } = useApp()
  const box = useRef<HTMLDivElement>(null)
  const [translation, setTranslation] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const run = useRef<AiRun | null>(null)
  const [pos, setPos] = useState({ left: sel.anchor.x, top: sel.anchor.bottom + 8 })

  useEffect(() => () => run.current?.cancel(), [])

  // 放在選取範圍下方；空間不夠時改放上方，並避免超出視窗
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    let top = sel.anchor.bottom + 8
    if (top + h > window.innerHeight - 8) top = Math.max(8, sel.anchor.top - h - 8)
    const left = Math.min(Math.max(8, sel.anchor.x - w / 2), window.innerWidth - w - 8)
    setPos({ left, top })
  }, [sel, translation])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    const onDown = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  const translate = async (): Promise<void> => {
    if (!aiReady) {
      openSettings()
      return
    }
    if (!settings) return
    setBusy(true)
    setTranslation('')
    run.current = runAI(selectionTranslateRequest(sel.text, settings.targetLang, settings.customInstructions), setTranslation)
    try {
      setTranslation(await run.current.done)
    } catch (e) {
      reportAiError(e)
      setTranslation(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sel-menu" ref={box} style={pos} onMouseUp={(e) => e.stopPropagation()}>
      <div className="sel-actions">
        <button onClick={translate} disabled={busy} title="翻譯選取的文字">
          <Languages size={15} />
          翻譯
        </button>
        <button onClick={onExplain} title="請 AI 解釋這段（在問答分頁）">
          <Lightbulb size={15} />
          解釋
        </button>
        <button onClick={onAsk} title="針對這段提問">
          <MessageSquareText size={15} />
          提問
        </button>
        <span className="sep" />
        {COLORS.map((c) => (
          <button
            key={c}
            className={`swatch sw-${c}`}
            title={canHighlight ? `${COLOR_NAMES[c]}色畫線` : '畫線只能在同一段落內'}
            disabled={!canHighlight}
            onClick={() => onHighlight(c)}
          />
        ))}
        <button disabled={!canHighlight} onClick={() => onHighlight('yellow', true)} title="畫線並寫筆記">
          <StickyNote size={15} />
        </button>
        <span className="sep" />
        <button
          title="複製"
          onClick={() => {
            void navigator.clipboard.writeText(sel.text)
            toast('已複製')
            onClose()
          }}
        >
          <Copy size={15} />
        </button>
      </div>
      {translation !== null && (
        <div className="sel-result">
          {translation ? (
            <RichText text={translation} />
          ) : (
            <div className="skeleton-block">
              <span className="skeleton" />
              <span className="skeleton short" />
            </div>
          )}
          {!busy && translation && (
            <div className="sel-result-actions">
              <button
                className="link-btn"
                onClick={() => {
                  void navigator.clipboard.writeText(translation)
                  toast('已複製譯文')
                }}
              >
                複製譯文
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
