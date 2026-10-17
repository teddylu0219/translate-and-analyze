import { memo, useMemo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'

interface Props {
  text: string
  /** 能對回原文的引用才做成可點擊連結 */
  canResolve?: (quote: string) => boolean
  onCite?: (paraId: string) => void
  onQuote?: (quote: string) => void
}

const escapeLabel = (s: string): string => s.replace(/([[\]\\])/g, '\\$1')

/** 把 [p12] 與「原文」轉成 markdown 連結，交給下面的 a 元件處理 */
function linkify(text: string, canResolve?: (q: string) => boolean): string {
  let out = text.replace(/\[(p\d+(?:\s*[,，、]\s*p\d+)*)\](?!\()/g, (_m, ids: string) =>
    ids
      .split(/\s*[,，、]\s*/)
      .map((id) => `[${id}](cite:${id})`)
      .join(' ')
  )
  if (canResolve) {
    out = out.replace(/「([^「」\n]{4,400})」/g, (m, q: string) => (canResolve(q) ? `[「${escapeLabel(q)}」](quote:${encodeURIComponent(q)})` : m))
  }
  return out
}

export const RichText = memo(function RichText({ text, canResolve, onCite, onQuote }: Props) {
  const md = useMemo(() => linkify(text, canResolve), [text, canResolve])
  return (
    <div className="rich">
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={(u) => u}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith('cite:')) {
              const id = href.slice(5)
              return (
                <button className="cite" title="跳到這一段" onClick={() => onCite?.(id)}>
                  {id}
                </button>
              )
            }
            if (href?.startsWith('quote:')) {
              const q = decodeURIComponent(href.slice(6))
              return (
                <span className="quote-link" title="在原文中標示" role="button" onClick={() => onQuote?.(q)}>
                  {children}
                </span>
              )
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            )
          }
        }}
      >
        {md}
      </Markdown>
    </div>
  )
})
