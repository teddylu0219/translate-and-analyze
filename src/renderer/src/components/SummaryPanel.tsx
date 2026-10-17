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
      <div className="panel-tools">
        <div className="run-row">
          {busy ? (
            <button className="btn small" onClick={onStop}>
              停止
            </button>
          ) : (
            <button className="btn primary" onClick={onGenerate}>
              {text ? '重新產生導讀' : '產生全文導讀'}
            </button>
          )}
          {text && !busy && (
            <button className="btn" onClick={() => void navigator.clipboard.writeText(text)}>
              複製
            </button>
          )}
        </div>
      </div>
      <div className="scroll-body">
        {shown ? (
          <RichText text={shown} canResolve={canResolve} onCite={onCite} onQuote={onQuote} />
        ) : busy ? (
          <div className="empty">閱讀全文中…</div>
        ) : (
          <div className="empty">
            一鍵產生結構化導讀：一句話總結、研究問題、方法、結果、貢獻、限制，以及建議的閱讀順序。
            <br />
            每個重點都會標出段落編號，點一下就能跳到原文。
          </div>
        )}
      </div>
    </div>
  )
}
