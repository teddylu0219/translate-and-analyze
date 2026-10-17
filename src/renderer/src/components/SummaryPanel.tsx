import { BookOpenText, Copy, RotateCw, Square } from 'lucide-react'
import { RichText } from './RichText'

interface Props {
  text: string | undefined
  live: string | null
  canResolve: (q: string) => boolean
  onGenerate: () => void
  onStop: () => void
  onCite: (id: string) => void
  onQuote: (q: string) => void
}

export function SummaryPanel({ text, live, canResolve, onGenerate, onStop, onCite, onQuote }: Props) {
  const busy = live !== null
  const shown = live ?? text
  return (
    <div className="summary-panel">
      {(text || busy) && (
        <div className="panel-tools">
          <div className="run-row">
            {busy ? (
              <button className="btn small" onClick={onStop}>
                <Square size={11} fill="currentColor" />
                停止
              </button>
            ) : (
              <button className="btn" onClick={onGenerate}>
                <RotateCw size={14} />
                重新產生
              </button>
            )}
            <span className="spacer" />
            {text && !busy && (
              <button className="btn ghost" onClick={() => void navigator.clipboard.writeText(text)}>
                <Copy size={14} />
                複製
              </button>
            )}
          </div>
        </div>
      )}
      <div className="scroll-body">
        {shown ? (
          <article className="summary-article">
            <RichText text={shown} canResolve={canResolve} onCite={onCite} onQuote={onQuote} />
          </article>
        ) : busy ? (
          <div className="skeleton-block roomy">
            <span className="skeleton short" />
            <span className="skeleton" />
            <span className="skeleton" />
            <span className="skeleton short" />
          </div>
        ) : (
          <div className="empty-hero">
            <div className="hero-icon">
              <BookOpenText size={26} />
            </div>
            <h3>全文導讀</h3>
            <p className="muted">一句話總結、研究問題、方法、結果、貢獻、限制，以及建議的閱讀順序。每個重點都附段落編號，點一下就跳到原文。</p>
            <button className="btn primary" onClick={onGenerate}>
              產生導讀
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
