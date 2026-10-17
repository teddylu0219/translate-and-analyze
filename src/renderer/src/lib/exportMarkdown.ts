import type { Highlight, ParaResult } from '../../../shared/types'
import type { Para } from './paragraphs'
import { COLOR_NAMES } from '../components/SelectionMenu'

export function buildMarkdown(opts: {
  title: string
  paras: Para[]
  results: Record<string, ParaResult>
  summary?: string
  highlights: Highlight[]
}): string {
  const { title, paras, results, summary, highlights } = opts
  const out: string[] = [`# ${title}`, '', `> 匯出時間：${new Date().toLocaleString('zh-TW')}`, '']

  if (summary) out.push('## 導讀', '', summary, '')

  if (highlights.length) {
    out.push('## 畫線與筆記', '')
    const sorted = [...highlights].sort((a, b) => (a.rects[0]?.page ?? 0) - (b.rects[0]?.page ?? 0) || (a.rects[0]?.y ?? 0) - (b.rects[0]?.y ?? 0))
    for (const h of sorted) {
      const where = h.rects[0] ? `第 ${h.rects[0].page} 頁` : h.paraId ?? ''
      out.push(`- **[${COLOR_NAMES[h.color]}]** ${h.text}${where ? `（${where}）` : ''}`)
      if (h.note) out.push(`  - 筆記：${h.note.replace(/\n/g, '\n    ')}`)
    }
    out.push('')
  }

  const done = paras.filter((p) => results[p.id]?.translation || results[p.id]?.analysis)
  if (done.length) {
    out.push('## 逐段翻譯與分析', '')
    for (const p of paras) {
      const r = results[p.id]
      if (p.kind === 'heading') {
        out.push(`### ${p.text.trim()}${r?.translation ? `｜${r.translation}` : ''}`, '')
        continue
      }
      if (!r?.translation && !r?.analysis) continue
      out.push(`**[${p.id}]${p.page ? ` 第 ${p.page} 頁` : ''}**`, '')
      out.push(`> ${p.text.trim()}`, '')
      if (r.translation) out.push(r.translation, '')
      if (r.analysis) out.push('**分析**', '', r.analysis, '')
    }
  }
  return out.join('\n')
}
