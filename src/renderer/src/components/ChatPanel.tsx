import { useEffect, useRef, useState } from 'react'
import type { ChatMsg } from '../../../shared/types'
import { useApp } from '../lib/appContext'
import { MANAGE_USAGE_URL } from '../lib/ai'
import { RichText } from './RichText'

interface Props {
  messages: ChatMsg[]
  live: string | null
  quote: string | null
  setQuote: (q: string | null) => void
  focusSignal: number
  canResolve: (q: string) => boolean
  onSend: (text: string) => void
  onStop: () => void
  onClear: () => void
  onCite: (id: string) => void
  onQuote: (q: string) => void
}

const SUGGESTIONS = ['這篇的核心貢獻是什麼？', '方法的關鍵步驟是什麼？請一步步說明。', '實驗結果是否支持結論？有哪些限制？', '用給初學者的白話解釋這篇在做什麼。']

export function ChatPanel(props: Props) {
  const { messages, live, quote, setQuote, focusSignal } = props
  const { settings } = useApp()
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const busy = live !== null

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, live])

  useEffect(() => {
    if (focusSignal) inputRef.current?.focus()
  }, [focusSignal])

  const send = (text = input): void => {
    if (!text.trim() || busy) return
    props.onSend(text.trim())
    setInput('')
  }

  return (
    <div className="chat-panel">
      <div className="chat-list">
        {!messages.length && !busy && (
          <div className="empty">
            針對這份文件提問，AI 會引用原文並標出段落。
            <div className="suggest">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg msg-${m.role} ${m.error ? 'msg-error' : ''}`}>
            {m.quote && <blockquote className="msg-quote">{m.quote}</blockquote>}
            {m.role === 'assistant' ? (
              <RichText text={m.text} canResolve={props.canResolve} onCite={props.onCite} onQuote={props.onQuote} />
            ) : (
              <div className="msg-text">{m.text}</div>
            )}
          </div>
        ))}
        {busy && (
          <div className="msg msg-assistant">
            {live ? <RichText text={live} canResolve={props.canResolve} onCite={props.onCite} onQuote={props.onQuote} /> : <span className="muted spin">思考中…</span>}
          </div>
        )}
        <div ref={bottom} />
      </div>
      <div className="composer">
        {quote && (
          <div className="quote-chip">
            <span className="quote-text">「{quote}」</span>
            <button className="icon-btn" onClick={() => setQuote(null)} title="移除引用">
              ×
            </button>
          </div>
        )}
        <textarea
          ref={inputRef}
          rows={3}
          value={input}
          placeholder={quote ? '針對選取的文字提問…' : '輸入問題，Enter 送出，Shift+Enter 換行'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className="composer-row">
          {settings?.provider === 'chatgpt' ? (
            <span className="muted small">
              使用 ChatGPT 方案・
              <a href={MANAGE_USAGE_URL} target="_blank" rel="noreferrer">
                管理用量
              </a>
            </span>
          ) : (
            <span className="muted small">使用 OpenAI API key</span>
          )}
          <span className="spacer" />
          {messages.length > 0 && !busy && (
            <button className="link-btn" onClick={props.onClear}>
              清除對話
            </button>
          )}
          {busy ? (
            <button className="btn small" onClick={props.onStop}>
              停止
            </button>
          ) : (
            <button className="btn primary small" disabled={!input.trim()} onClick={() => send()}>
              送出
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
