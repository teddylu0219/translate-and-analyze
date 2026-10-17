// Sign in with ChatGPT（開源／本機 app 流程）
// 參考：https://developers.openai.com/siwc/token-sharing-open-source
import { createServer, type Server } from 'node:http'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { shell } from 'electron'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { dataDir, readJson, writeJson, readSecret, writeSecret, deleteSecret } from './store'
import type { AuthStatus } from '../shared/types'

const ISSUER = 'https://auth.openai.com'
const AUTHORIZE_URL = `${ISSUER}/api/accounts/authorize`
const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`
const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`
const RESOURCE = 'https://api.openai.com/v1'
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
const PLAN_SCOPE = 'chatgpt.tokens.use.direct'
const AGENT_NAME = 'Translate and Analyze'
const PORTS = [1455, 1456, 1457, 1458, 1459]

const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`))

/** 註冊資訊：登出後仍保留，下次登入沿用同一個 client_id */
interface Registration {
  hostId: string
  clientId?: string
  email?: string
  sub?: string
  idToken?: string
}

interface Tokens {
  accessToken: string
  refreshToken: string
  idToken: string
  expiresAt: number
  scope: string
}

export class AuthError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
  }
}

const regFile = dataDir('registration.json')

async function getRegistration(): Promise<Registration> {
  const reg = await readJson<Registration | null>(regFile, null)
  // 主機 ID 必須是 urn:uuid: 格式，否則授權頁會回 invalid_authorize_request
  if (reg?.hostId?.startsWith('urn:uuid:')) return reg
  const fresh: Registration = { hostId: `urn:uuid:${randomUUID()}` }
  await writeJson(regFile, fresh)
  return fresh
}

const b64url = (buf: Buffer): string => buf.toString('base64url')

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
  } catch {
    return {}
  }
}

async function postForm(url: string, form: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(form).toString()
  })
}

async function readOAuthError(res: Response): Promise<{ code: string; message: string }> {
  const text = await res.text()
  try {
    const j = JSON.parse(text)
    const code = j.error?.code ?? j.error ?? j.code ?? `http_${res.status}`
    const message = j.error_description ?? j.error?.message ?? j.detail ?? text
    return { code: String(code), message: String(message) }
  } catch {
    return { code: `http_${res.status}`, message: text.slice(0, 300) }
  }
}

const callbackPage = (title: string, body: string): string => `<!doctype html><html lang="zh-Hant"><meta charset="utf-8">
<title>${title}</title><body style="font-family:'Segoe UI','Microsoft JhengHei',sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#f7f7f5;color:#1f1f1d">
<div style="text-align:center"><h2>${title}</h2><p>${body}</p></div></body></html>`

interface CallbackResult {
  params: URLSearchParams
  redirectUri: string
}

/** 在 127.0.0.1 開一個暫時的伺服器接 OAuth 回呼 */
async function listenForCallback(
  expectedState: string,
  signal: AbortSignal
): Promise<{ redirectUri: string; result: Promise<CallbackResult> }> {
  let server: Server | null = null
  let port = 0
  for (const p of PORTS) {
    try {
      server = await new Promise<Server>((resolve, reject) => {
        const s = createServer()
        s.once('error', reject)
        s.listen(p, '127.0.0.1', () => resolve(s))
      })
      port = p
      break
    } catch {
      server = null
    }
  }
  if (!server) throw new AuthError('port_in_use', '登入用的本機連接埠（1455–1459）都被占用，請關掉其他 Codex / ChatGPT 工具後再試。')

  const redirectUri = `http://127.0.0.1:${port}/auth/callback`
  const srv = server
  const result = new Promise<CallbackResult>((resolve, reject) => {
    const timer = setTimeout(() => finish(new AuthError('timeout', '登入逾時，請再試一次。')), 10 * 60_000)
    const finish = (err: Error | null, value?: CallbackResult): void => {
      clearTimeout(timer)
      srv.close()
      if (err) reject(err)
      else resolve(value!)
    }
    signal.addEventListener('abort', () => finish(new AuthError('cancelled', '已取消登入。')))
    srv.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', redirectUri)
      if (url.pathname !== '/auth/callback') {
        res.writeHead(404).end()
        return
      }
      const params = url.searchParams
      if (params.get('state') !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(callbackPage('登入失敗', '驗證資訊不符，請回到 app 重新登入。'))
        return
      }
      const error = params.get('error')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        error
          ? callbackPage('登入未完成', '已取消或拒絕授權。可以關閉此分頁，回到 Translate and Analyze。')
          : callbackPage('登入完成 ✓', '可以關閉此分頁，回到 Translate and Analyze。')
      )
      finish(null, { params, redirectUri })
    })
  })
  return { redirectUri, result }
}

let pendingSignIn: AbortController | null = null

export function cancelSignIn(): void {
  pendingSignIn?.abort()
}

export async function signIn(): Promise<AuthStatus> {
  pendingSignIn?.abort()
  const abort = new AbortController()
  pendingSignIn = abort
  try {
    return await doSignIn(abort.signal)
  } finally {
    if (pendingSignIn === abort) pendingSignIn = null
  }
}

async function doSignIn(signal: AbortSignal): Promise<AuthStatus> {
  const reg = await getRegistration()
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(24))
  const nonce = b64url(randomBytes(24))
  const { redirectUri, result } = await listenForCallback(state, signal)

  const q = new URLSearchParams({
    response_type: 'code',
    client_id: reg.clientId ?? 'dynamic_agent_client',
    redirect_uri: redirectUri,
    scope: SCOPES,
    resource: RESOURCE,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ext_agent_host_id: reg.hostId
  })
  if (!reg.clientId) {
    q.set('agent_name_hint', AGENT_NAME)
  } else {
    if (reg.idToken) q.set('id_token_hint', reg.idToken)
    if (reg.email) q.set('login_hint', reg.email)
  }
  await shell.openExternal(`${AUTHORIZE_URL}?${q}`)

  const { params } = await result
  const error = params.get('error')
  if (error === 'access_denied') throw new AuthError('access_denied', '你在瀏覽器中取消了授權。')
  if (error) throw new AuthError(error, params.get('error_description') ?? `登入失敗（${error}）`)

  const code = params.get('code')
  if (!code) throw new AuthError('no_code', '登入回應缺少授權碼，請再試一次。')
  const returnedClientId = params.get('client_id') ?? undefined
  let clientId = reg.clientId
  if (!clientId) {
    if (!returnedClientId || returnedClientId === 'dynamic_agent_client') {
      throw new AuthError('registration_incomplete', '註冊沒有完成（沒有取得 client ID），請再試一次。')
    }
    clientId = returnedClientId
  } else if (returnedClientId && returnedClientId !== clientId) {
    throw new AuthError('client_mismatch', '登入回應的 client ID 不符，請再試一次。')
  }

  const res = await postForm(TOKEN_URL, {
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    resource: RESOURCE
  })
  if (!res.ok) {
    const e = await readOAuthError(res)
    throw new AuthError(e.code, `取得登入憑證失敗：${e.message}`)
  }
  const tok = await res.json()

  const { payload } = await jwtVerify(tok.id_token, jwks, { issuer: ISSUER, audience: clientId })
  if (payload.nonce !== nonce) throw new AuthError('nonce_mismatch', '登入驗證失敗（nonce 不符），請再試一次。')
  if (reg.sub && payload.sub !== reg.sub && reg.clientId) {
    // 同一個註冊換了不同帳號：重新註冊
    await writeJson(regFile, { hostId: reg.hostId })
    throw new AuthError('account_changed', '偵測到不同的 ChatGPT 帳號，請再按一次登入。')
  }

  const tokens: Tokens = {
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    idToken: tok.id_token,
    expiresAt: Date.now() + (Number(tok.expires_in) || 3600) * 1000,
    scope: tok.scope ?? String(decodeJwtPayload(tok.access_token).scope ?? '')
  }
  await writeSecret('chatgpt', tokens)
  await writeJson(regFile, {
    hostId: reg.hostId,
    clientId,
    email: typeof payload.email === 'string' ? payload.email : reg.email,
    sub: payload.sub,
    idToken: tok.id_token
  } satisfies Registration)
  return getStatus()
}

let refreshing: Promise<Tokens> | null = null

async function refresh(tokens: Tokens): Promise<Tokens> {
  const reg = await getRegistration()
  if (!reg.clientId) throw new AuthError('need_signin', '請先用 ChatGPT 登入。')
  let res: Response
  try {
    res = await postForm(TOKEN_URL, {
      grant_type: 'refresh_token',
      client_id: reg.clientId,
      refresh_token: tokens.refreshToken,
      resource: RESOURCE
    })
  } catch {
    throw new AuthError('network', '無法連線到 OpenAI，請檢查網路。')
  }
  if (!res.ok) {
    const e = await readOAuthError(res)
    const terminal = [
      'invalid_grant',
      'invalid_refresh_token',
      'token_expired',
      'refresh_token_expired',
      'refresh_token_invalidated',
      'refresh_token_reused'
    ]
    if (terminal.includes(e.code)) {
      await deleteSecret('chatgpt')
      throw new AuthError('need_signin', 'ChatGPT 登入已過期，請重新登入。')
    }
    throw new AuthError(e.code, `更新登入狀態失敗：${e.message}`)
  }
  const tok = await res.json()
  const next: Tokens = {
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token ?? tokens.refreshToken,
    idToken: tok.id_token ?? tokens.idToken,
    expiresAt: Date.now() + (Number(tok.expires_in) || 3600) * 1000,
    scope: tok.scope ?? tokens.scope
  }
  await writeSecret('chatgpt', next)
  return next
}

/** 取得有效的 access token，快過期時自動更新（同時只會有一個更新請求） */
export async function getAccessToken(forceRefresh = false): Promise<string> {
  const tokens = await readSecret<Tokens>('chatgpt')
  if (!tokens) throw new AuthError('need_signin', '請先用 ChatGPT 登入。')
  if (!tokens.scope.split(' ').includes(PLAN_SCOPE)) {
    throw new AuthError('plan_not_enabled', '這次登入沒有授權使用 ChatGPT 方案額度。請登出後重新登入，並在授權頁允許使用方案。')
  }
  if (!forceRefresh && tokens.expiresAt - Date.now() > 5 * 60_000) return tokens.accessToken
  refreshing ??= refresh(tokens).finally(() => {
    refreshing = null
  })
  return (await refreshing).accessToken
}

export async function signOut(): Promise<AuthStatus> {
  const tokens = await readSecret<Tokens>('chatgpt')
  const reg = await getRegistration()
  let revoked = true
  if (tokens && reg.clientId) {
    try {
      const disc = await (await fetch(DISCOVERY_URL)).json()
      const endpoint: string = disc.revocation_endpoint ?? `${ISSUER}/api/accounts/oauth/revoke`
      const res = await postForm(endpoint, {
        token: tokens.refreshToken,
        token_type_hint: 'refresh_token',
        client_id: reg.clientId
      })
      revoked = res.ok
    } catch {
      revoked = false
    }
  }
  await deleteSecret('chatgpt')
  return { ...(await getStatus()), revokeUnconfirmed: !revoked }
}

export async function getStatus(): Promise<AuthStatus> {
  if (process.env.TA_MOCK_AI) return { signedIn: true, email: 'mock@example.com', planUsage: true, apiKeySet: false }
  const tokens = await readSecret<Tokens>('chatgpt')
  const reg = await readJson<Registration | null>(regFile, null)
  const apiKey = await readSecret<string>('apikey')
  return {
    signedIn: !!tokens,
    email: tokens ? reg?.email : undefined,
    planUsage: !!tokens && tokens.scope.split(' ').includes(PLAN_SCOPE),
    apiKeySet: !!apiKey
  }
}

export async function setApiKey(key: string): Promise<AuthStatus> {
  if (key.trim()) await writeSecret('apikey', key.trim())
  else await deleteSecret('apikey')
  return getStatus()
}

export async function getApiKey(): Promise<string> {
  const key = await readSecret<string>('apikey')
  if (!key) throw new AuthError('need_apikey', '尚未設定 OpenAI API key。')
  return key
}
