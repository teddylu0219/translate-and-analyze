import type { AiMessage, AiRequest, ChatMsg } from '../../../shared/types'
import type { Para } from './paragraphs'

const base = (lang: string, custom: string): string =>
  [
    `你是嚴謹的學術閱讀助理，幫使用者讀懂論文與文章。回答一律使用「${lang}」。`,
    '專有名詞第一次出現時保留原文，例如：注意力機制（attention）。數學式保留 LaTeX，用 $...$ 包起來。',
    custom.trim() ? `使用者的額外要求：${custom.trim()}` : ''
  ]
    .filter(Boolean)
    .join('\n')

const citeRules = [
  '引用規則（很重要）：',
  '- 引用原文時，必須逐字複製原文（保持原本的語言，不要翻譯），放在「」中，每段引用不超過 25 個英文單字。',
  '- 提到某段內容時，用方括號標出段落編號，例如 [p12]。段落編號只能使用文件中出現過的編號。'
].join('\n')

/** 把文件段落組成帶編號的全文，給摘要與問答使用 */
export function docContext(title: string, paras: Para[], limit = 360_000): string {
  let out = `文件標題：${title}\n\n`
  for (const p of paras) {
    if (p.kind === 'ref') continue
    const line = p.kind === 'heading' ? `[${p.id}] ## ${p.text.trim()}\n` : `[${p.id}] ${p.text.trim()}\n`
    if (out.length + line.length > limit) {
      out += '\n（文件過長，以下省略）\n'
      break
    }
    out += line
  }
  return out
}

/** 逐段翻譯（＋分析）。輸出格式：@@id / 譯文 / %% / 分析 */
export function paragraphsRequest(opts: {
  title: string
  paras: Para[]
  lang: string
  custom: string
  analyze: boolean
  prevText?: string
}): AiRequest {
  const format = opts.analyze
    ? [
        '對每個段落依序輸出，格式嚴格如下，不要輸出其他任何文字：',
        '@@段落編號',
        '完整、通順、忠實的譯文',
        '%%',
        '分析（2–4 個條列重點：這段在全文中的作用、核心主張或方法、關鍵術語、值得注意的假設或限制；每個重點盡量附上「原文引用」）',
        '',
        '標題類段落只輸出譯文，%% 後面留空。'
      ]
    : ['對每個段落依序輸出，格式嚴格如下，不要輸出其他任何文字：', '@@段落編號', '完整、通順、忠實的譯文']
  const instructions = [
    base(opts.lang, opts.custom),
    `任務：逐段翻譯${opts.analyze ? '並分析' : ''}下列段落。不要合併或省略段落，不要摘要譯文。`,
    ...format,
    opts.analyze ? citeRules : ''
  ]
    .filter(Boolean)
    .join('\n')
  const ctx = opts.prevText ? `（上文參考，不需翻譯）：${opts.prevText.slice(-600)}\n\n` : ''
  const body = opts.paras.map((p) => `@@${p.id}\n${p.text.trim()}`).join('\n\n')
  return { instructions, messages: [{ role: 'user', text: `文件：${opts.title}\n\n${ctx}${body}` }] }
}

export interface ParsedPara {
  id: string
  translation: string
  analysis?: string
}

/** 解析串流中的 @@id 區塊；最後一塊可能還沒寫完，一樣回傳讓畫面即時顯示 */
export function parseParagraphOutput(text: string): ParsedPara[] {
  const out: ParsedPara[] = []
  for (const block of text.split(/^@@/m).slice(1)) {
    const nl = block.indexOf('\n')
    const id = (nl < 0 ? block : block.slice(0, nl)).trim()
    if (!/^p\d+$/.test(id)) continue
    const rest = nl < 0 ? '' : block.slice(nl + 1)
    const sep = rest.search(/^%%\s*$/m)
    if (sep >= 0) {
      out.push({ id, translation: rest.slice(0, sep).trim(), analysis: rest.slice(sep).replace(/^%%\s*/, '').trim() })
    } else {
      out.push({ id, translation: rest.trim() })
    }
  }
  return out
}

export function selectionTranslateRequest(text: string, lang: string, custom: string): AiRequest {
  return {
    instructions: [
      base(lang, custom),
      '任務：翻譯使用者選取的文字。只輸出譯文。',
      '如果選取的是單字或短語：先給譯名，再用一兩句說明在學術語境中的意思。'
    ].join('\n'),
    messages: [{ role: 'user', text }]
  }
}

export function summaryRequest(title: string, paras: Para[], lang: string, custom: string): AiRequest {
  return {
    instructions: [
      base(lang, custom),
      '任務：為下列文件寫一份結構化導讀，使用 Markdown。依序包含這些小節（不適用的可略過）：',
      '## 一句話總結',
      '## 研究問題與動機',
      '## 方法',
      '## 主要結果',
      '## 貢獻與創新',
      '## 限制與疑問',
      '## 建議閱讀順序（列出最值得先讀的段落編號與原因）',
      citeRules,
      '每個小節的重點都要標出段落編號 [p..]，重要主張附上「原文引用」。'
    ].join('\n'),
    messages: [{ role: 'user', text: docContext(title, paras) }]
  }
}

export function chatRequest(title: string, paras: Para[], lang: string, custom: string, history: ChatMsg[]): AiRequest {
  const messages: AiMessage[] = []
  history
    .filter((m) => !m.error)
    .forEach((m, i) => {
      let text = m.text
      if (m.role === 'user' && m.quote) text = `針對這段原文：「${m.quote}」\n\n${m.text}`
      if (i === 0 && m.role === 'user') text = `${docContext(title, paras)}\n\n---\n\n${text}`
      messages.push({ role: m.role, text })
    })
  return {
    instructions: [
      base(lang, custom),
      '任務：根據使用者提供的文件回答問題，使用 Markdown。第一則訊息附有完整文件，每段前面有段落編號。',
      '只根據文件內容回答；文件沒有提到的，要明確說明，再補充你的一般知識並標示「（文件外補充）」。',
      citeRules
    ].join('\n'),
    messages
  }
}

export const LANGS = ['繁體中文（台灣）', '简体中文', 'English', '日本語', '한국어', 'Español', 'Français', 'Deutsch']
