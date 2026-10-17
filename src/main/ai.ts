import type { WebContents } from 'electron'
import { AuthError, getAccessToken, getApiKey } from './auth'
import { getSettings } from './store'
import { mockStream } from './mock'
import type { AiError, AiRequest, ModelInfo } from '../shared/types'

const API = 'https://api.openai.com/v1'
const running = new Map<string, AbortController>()
/** 模型不支援 reasoning 參數時記下來，之後不再送 */
const noReasoning = new Set<string>()

const USAGE_URL = 'https://chatgpt.com/settings/usage'

function friendlyError(status: number, code: string, message: string): AiError {
  const map: Record<string, string> = {
    subscription_sharing_usage_limit_exceeded: '已達 ChatGPT 方案的使用上限（可能是本 app 的個別上限）。可以到 ChatGPT 設定 → Usage 查看或調整。',
    subscription_sharing_user_not_eligible: '這個 ChatGPT 帳號目前不能在第三方 app 使用方案額度（需要 Plus 或 Pro 等方案）。',
    subscription_sharing_usage_unavailable: 'ChatGPT 方案額度服務暫時無法使用，請稍後再試。',
    subscription_sharing_user_unavailable: 'ChatGPT 帳號資訊暫時無法取得，請稍後再試。',
    subscription_sharing_unsupported_capability: `目前的模型或設定不被支援（${message}）。請到設定換一個模型。`,
    subscription_sharing_invalid_user: 'ChatGPT 登入狀態無效，請登出後重新登入。',
    model_not_found: '找不到這個模型，請到設定重新選擇模型。',
    invalid_api_key: 'API key 無效，請到設定確認。',
    insufficient_quota: 'API 帳戶額度不足。',
    rate_limit_exceeded: '請求太頻繁，請稍等一下再試。'
  }
  if (map[code]) return { code, message: map[code] }
  if (status === 401) return { code: code || 'unauthorized', message: '授權失敗，請登出後重新登入。' }
  if (status === 403) return { code: code || 'forbidden', message: `沒有權限（${message || code}）。` }
  if (status === 429) return { code: code || 'rate_limited', message: '已達使用上限或請求太頻繁，請稍後再試。' }
  if (status >= 500) return { code: code || 'server_error', message: 'OpenAI 伺服器暫時有問題，請稍後再試。' }
  return { code: code || `http_${status}`, message: message || `請求失敗（HTTP ${status}）` }
}

async function parseHttpError(res: Response): Promise<{ code: string; message: string; param?: string }> {
  const text = await res.text().catch(() => '')
  try {
    const j = JSON.parse(text)
    return {
      code: String(j.error?.code ?? j.error?.type ?? ''),
      message: String(j.error?.message ?? j.detail ?? ''),
      param: j.error?.param ?? undefined
    }
  } catch {
    return { code: '', message: text.slice(0, 300) }
  }
}

async function authHeader(forceRefresh = false): Promise<string> {
  const { provider } = await getSettings()
  const token = provider === 'apikey' ? await getApiKey() : await getAccessToken(forceRefresh)
  return `Bearer ${token}`
}

/**
 * 列出可用模型。
 * ChatGPT 方案：回應是 `models` 陣列，只保留 visibility === "list"，保持伺服器順序；
 * 顯示 display_name，呼叫時用 slug 當 model。
 * 參考 https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
 * API key：一般的 `data` 陣列，用 id。
 */
let modelCache: { provider: string; at: number; models: ModelInfo[] } | null = null

/** 換帳號、登出、切換 provider 時清掉，下次重新查 */
export function clearModelCache(): void {
  modelCache = null
}

export async function listModels(force = false): Promise<ModelInfo[]> {
  const { provider } = await getSettings()
  if (!force && modelCache && modelCache.provider === provider && Date.now() - modelCache.at < 10 * 60_000) return modelCache.models
  const models = await fetchModels(provider)
  modelCache = { provider, at: Date.now(), models }
  return models
}

async function fetchModels(provider: string): Promise<ModelInfo[]> {
  if (process.env.TA_MOCK_AI) return [{ id: 'mock-model', name: 'Mock model' }]
  const res = await fetch(`${API}/models`, { headers: { Authorization: await authHeader() } })
  if (!res.ok) {
    const e = await parseHttpError(res)
    throw friendlyError(res.status, e.code, e.message)
  }
  const j = await res.json()
  if (provider === 'chatgpt') {
    const models: { slug?: string; display_name?: string; visibility?: string }[] = j.models ?? []
    return models
      .filter((m) => m.visibility === 'list' && m.slug)
      .map((m) => ({ id: m.slug!, name: m.display_name || m.slug! }))
  }
  const data: { id: string }[] = j.data ?? []
  return data
    .map((m) => m.id)
    .filter((id) => /^(gpt-|o\d|chatgpt-)/.test(id) && !/(audio|realtime|tts|transcribe|image|search|embedding)/.test(id))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((id) => ({ id, name: id }))
}

/** 設定裡沒選模型時，用清單中的第一個（ChatGPT 方案依伺服器排序） */
async function resolveModel(): Promise<string> {
  const s = await getSettings()
  const models = await listModels()
  if (s.model && models.some((m) => m.id === s.model)) return s.model
  if (!models.length) throw { code: 'no_models', message: '這個帳號沒有可用的模型。' } satisfies AiError
  return models[0].id
}

export function cancel(id: string): void {
  running.get(id)?.abort()
}

/** 呼叫 Responses API 串流，把文字片段送回畫面 */
export async function start(sender: WebContents, id: string, req: AiRequest): Promise<void> {
  const abort = new AbortController()
  running.set(id, abort)
  const send = (channel: string, payload: unknown): void => {
    if (!sender.isDestroyed()) sender.send(channel, id, payload)
  }
  try {
    if (process.env.TA_MOCK_AI) {
      const text = await mockStream(req, abort.signal, (d) => send('ai:delta', d))
      send('ai:done', text)
      return
    }
    const text = await streamOnce(req, abort.signal, (d) => send('ai:delta', d))
    send('ai:done', text)
  } catch (err) {
    if (abort.signal.aborted) {
      send('ai:error', { code: 'cancelled', message: '已停止' } satisfies AiError)
    } else if (err instanceof AuthError) {
      send('ai:error', { code: err.code, message: err.message } satisfies AiError)
    } else if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
      send('ai:error', err as AiError)
    } else {
      send('ai:error', { code: 'network', message: `連線失敗：${(err as Error)?.message ?? err}` } satisfies AiError)
    }
  } finally {
    running.delete(id)
  }
}

async function streamOnce(req: AiRequest, signal: AbortSignal, onDelta: (d: string) => void): Promise<string> {
  const s = await getSettings()
  const model = await resolveModel()
  const body: Record<string, unknown> = {
    model,
    instructions: req.instructions,
    input: req.messages.map((m) => ({
      role: m.role,
      content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.text }]
    })),
    store: false,
    stream: true
  }
  if (s.reasoning !== 'default' && !noReasoning.has(model)) body.reasoning = { effort: s.reasoning }

  let res: Response | null = null
  let lastStatus = 0
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(`${API}/responses`, {
      method: 'POST',
      headers: { Authorization: await authHeader(lastStatus === 401), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    })
    if (res.ok) break
    lastStatus = res.status
    const e = await parseHttpError(res)
    if (res.status === 400 && body.reasoning && (e.param?.includes('reasoning') || e.message.includes('reasoning'))) {
      noReasoning.add(model)
      delete body.reasoning
      continue
    }
    if (res.status === 401 && s.provider === 'chatgpt' && attempt === 0) continue
    if (res.status === 503 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
      continue
    }
    throw friendlyError(res.status, e.code, e.message)
  }
  if (!res?.ok || !res.body) throw { code: 'no_response', message: '沒有收到回應。' } satisfies AiError

  let full = ''
  let buffer = ''
  const decoder = new TextDecoder()
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      const data = chunk
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n')
      if (!data || data === '[DONE]') continue
      let ev: { type?: string; delta?: string; response?: { error?: { code?: string; message?: string } }; error?: { code?: string; message?: string }; message?: string; code?: string }
      try {
        ev = JSON.parse(data)
      } catch {
        continue
      }
      if (ev.type === 'response.output_text.delta' && ev.delta) {
        full += ev.delta
        onDelta(ev.delta)
      } else if (ev.type === 'response.failed' || ev.type === 'response.incomplete') {
        const e = ev.response?.error
        if (ev.type === 'response.incomplete' && full) return full
        throw friendlyError(0, e?.code ?? 'failed', e?.message ?? '模型回應失敗')
      } else if (ev.type === 'error') {
        const e = ev.error ?? ev
        throw friendlyError(0, e.code ?? 'error', e.message ?? '模型回應錯誤')
      } else if (ev.type === 'response.completed') {
        return full
      }
    }
  }
  // 沒收到 response.completed 就結束：連線中斷，不能當成成功
  throw { code: 'stream_interrupted', message: '連線中斷，回應沒有完成，請再試一次。' } satisfies AiError
}

export { USAGE_URL }
