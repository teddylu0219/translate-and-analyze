import type { AiError, AiRequest } from '../../../shared/types'

export interface AiRun {
  done: Promise<string>
  cancel: () => void
}

let seq = 0

/** 送出一次 AI 請求；onDelta 會收到累積的完整文字 */
export function runAI(req: AiRequest, onText?: (full: string) => void): AiRun {
  const id = `r${Date.now()}-${++seq}`
  let full = ''
  const done = new Promise<string>((resolve, reject) => {
    window.api.aiStart(id, req, {
      onDelta: (d) => {
        full += d
        onText?.(full)
      },
      onDone: (t) => resolve(t || full),
      onError: (e) => reject(e)
    })
  })
  return { done, cancel: () => window.api.aiCancel(id) }
}

export function isAiError(e: unknown): e is AiError {
  return !!e && typeof e === 'object' && 'code' in e && 'message' in e
}

export const USAGE_LIMIT = 'subscription_sharing_usage_limit_exceeded'
export const MANAGE_USAGE_URL = 'https://chatgpt.com/settings/usage'
