// 只在開發測試時使用（環境變數 TA_MOCK_AI=1），模擬模型串流輸出，不會打到 OpenAI
import type { AiRequest } from '../shared/types'

export async function mockStream(req: AiRequest, signal: AbortSignal, onDelta: (d: string) => void): Promise<string> {
  const last = req.messages[req.messages.length - 1]?.text ?? ''
  let out: string
  const blocks = last
    .split(/^@@/m)
    .slice(1)
    .map((b) => [b.slice(0, b.indexOf('\n')).trim(), b.slice(b.indexOf('\n') + 1)])
  if (blocks.length) {
    const withAnalysis = req.instructions.includes('%%')
    out = blocks
      .map(([id, text]) => {
        const words = text.trim().split(/\s+/).slice(0, 6).join(' ')
        return `@@${id}\n（模擬譯文）${text.trim().slice(0, 80)}…\n` + (withAnalysis ? `%%\n- 重點：這段在說明「${words}」的內容 [${id}]\n` : '')
      })
      .join('')
  } else {
    out = `## 模擬回應\n\n這是測試用的回答，引用 [p1] 與 [p2]。\n\n- 第一點\n- 第二點`
  }
  let sent = ''
  for (const piece of out.match(/[\s\S]{1,12}/g) ?? []) {
    if (signal.aborted) throw new Error('aborted')
    await new Promise((r) => setTimeout(r, 15))
    sent += piece
    onDelta(piece)
  }
  return sent
}
