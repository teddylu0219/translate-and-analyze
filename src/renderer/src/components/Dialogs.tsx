import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Sparkles, X } from 'lucide-react'
import type { ModelInfo, Settings, UpdateStatus } from '../../../shared/types'
import { useApp } from '../lib/appContext'
import { MANAGE_USAGE_URL } from '../lib/ai'
import { LANGS } from '../lib/prompts'

function Modal({ children, onClose, wide }: { children: React.ReactNode; onClose?: () => void; wide?: boolean }) {
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`}>{children}</div>
    </div>
  )
}

export function SettingsDialog() {
  const { settings, updateSettings, auth, setAuth, openSettings, toast } = useApp()
  const [signingIn, setSigningIn] = useState(false)
  const [models, setModels] = useState<ModelInfo[] | null>(null)
  const [modelErr, setModelErr] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [version, setVersion] = useState('')
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' })

  useEffect(() => {
    window.api.getVersion().then(setVersion)
    window.api.updateStatus().then(setUpdate)
    return window.api.onUpdateStatus(setUpdate)
  }, [])

  const providerReady = settings?.provider === 'chatgpt' ? auth?.signedIn && auth.planUsage : auth?.apiKeySet

  const loadModels = async (): Promise<void> => {
    setModelErr(null)
    try {
      setModels(await window.api.listModels())
    } catch (e) {
      setModels(null)
      setModelErr((e as Error)?.message ?? String(e))
    }
  }

  useEffect(() => {
    if (providerReady) void loadModels()
    else setModels(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerReady, settings?.provider])

  if (!settings || !auth) return null

  const signIn = async (): Promise<void> => {
    setSigningIn(true)
    try {
      const status = await window.api.signIn()
      setAuth(status)
      if (status.signedIn && !status.planUsage) toast('已登入，但沒有授權使用 ChatGPT 方案額度。請登出後重新登入並允許使用方案。', 'error')
      else toast('已連接 ChatGPT')
    } catch (e) {
      const err = e as { code?: string; message?: string }
      if (err?.code !== 'cancelled') toast(err?.message ?? String(e), 'error')
    } finally {
      setSigningIn(false)
    }
  }

  const signOut = async (): Promise<void> => {
    const status = await window.api.signOut()
    setAuth(status)
    if (status.revokeUnconfirmed) toast('已在本機登出，但無法確認遠端授權已撤銷。可以到 ChatGPT 設定中中斷此 app 的連線。', 'error')
    else toast('已登出')
  }

  const set = (patch: Partial<Settings>): void => void updateSettings(patch)

  return (
    <Modal onClose={() => !signingIn && openSettings(false)} wide>
      <div className="modal-head">
        <h2>設定</h2>
        <button className="icon-btn" onClick={() => openSettings(false)} disabled={signingIn} title="關閉">
          <X size={18} />
        </button>
      </div>

      <section className="set-section">
        <h3>AI 帳號</h3>
        <div className="seg">
          <button className={settings.provider === 'chatgpt' ? 'on' : ''} onClick={() => set({ provider: 'chatgpt', model: '' })}>
            ChatGPT 方案（建議）
          </button>
          <button className={settings.provider === 'apikey' ? 'on' : ''} onClick={() => set({ provider: 'apikey', model: '' })}>
            OpenAI API key
          </button>
        </div>

        {settings.provider === 'chatgpt' ? (
          auth.signedIn ? (
            <div className="account-row">
              <div>
                <div>
                  已登入：<strong>{auth.email ?? 'ChatGPT 帳號'}</strong>
                </div>
                <div className={`small ${auth.planUsage ? 'ok' : 'warn-text'}`}>{auth.planUsage ? '✓ 使用你的 ChatGPT 方案額度' : '⚠ 沒有授權使用方案額度，請登出後重新登入'}</div>
              </div>
              <span className="spacer" />
              <button className="btn" onClick={() => window.api.openExternal(MANAGE_USAGE_URL)}>
                管理用量
              </button>
              <button className="btn" onClick={signOut}>
                登出
              </button>
            </div>
          ) : signingIn ? (
            <div className="account-row">
              <div>
                <strong>已在瀏覽器開啟 ChatGPT 登入頁…</strong>
                <div className="muted small">請在瀏覽器登入並按「允許」，完成後會自動回到這裡。</div>
              </div>
              <span className="spacer" />
              <button className="btn" onClick={() => window.api.cancelSignIn()}>
                取消
              </button>
            </div>
          ) : (
            <div className="account-row">
              <div className="muted small">需要 ChatGPT Plus 或 Pro 方案。登入後，翻譯與分析會使用你的方案額度，可以在 ChatGPT 設定中查看與限制用量。</div>
              <span className="spacer" />
              <button className="btn chatgpt" onClick={signIn}>
                Continue with ChatGPT
              </button>
            </div>
          )
        ) : (
          <div className="account-row">
            {auth.apiKeySet ? (
              <>
                <div className="ok small">✓ 已設定 API key（加密存在這台電腦）</div>
                <span className="spacer" />
                <button className="btn" onClick={async () => setAuth(await window.api.setApiKey(''))}>
                  移除
                </button>
              </>
            ) : (
              <>
                <input className="grow" type="password" placeholder="sk-..." value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                <button
                  className="btn primary"
                  disabled={!apiKey.trim()}
                  onClick={async () => {
                    setAuth(await window.api.setApiKey(apiKey))
                    setApiKey('')
                  }}
                >
                  儲存
                </button>
              </>
            )}
          </div>
        )}
      </section>

      <section className="set-section">
        <h3>翻譯與分析</h3>
        <div className="form-grid">
          <label>目標語言</label>
          <select value={settings.targetLang} onChange={(e) => set({ targetLang: e.target.value })}>
            {[...new Set([settings.targetLang, ...LANGS])].map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>

          <label>模型</label>
          <div className="row">
            <select value={settings.model} onChange={(e) => set({ model: e.target.value })} disabled={!models}>
              <option value="">自動（{models?.[0]?.name ?? '清單第一個'}）</option>
              {models?.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <button className="btn small" onClick={loadModels} disabled={!providerReady}>
              重新整理
            </button>
          </div>
          {modelErr && <div className="span2 warn-text small">{modelErr}</div>}

          <label>思考強度</label>
          <select value={settings.reasoning} onChange={(e) => set({ reasoning: e.target.value as Settings['reasoning'] })}>
            <option value="low">低（快，適合翻譯）</option>
            <option value="medium">中</option>
            <option value="high">高（慢，分析較深入）</option>
            <option value="default">模型預設</option>
          </select>

          <label>額外指示</label>
          <textarea
            rows={3}
            placeholder="例如：我是資工系學生；術語請附英文；分析時多解釋數學推導。"
            defaultValue={settings.customInstructions}
            onBlur={(e) => set({ customInstructions: e.target.value })}
          />
        </div>
      </section>

      <section className="set-section">
        <h3>外觀</h3>
        <div className="form-grid">
          <label>主題</label>
          <div className="seg small">
            {(['system', 'light', 'dark'] as const).map((t) => (
              <button key={t} className={settings.theme === t ? 'on' : ''} onClick={() => set({ theme: t })}>
                {t === 'system' ? '跟隨系統' : t === 'light' ? '淺色' : '深色'}
              </button>
            ))}
          </div>
          <label>側欄字體大小</label>
          <div className="row">
            <input type="range" min={12} max={20} value={settings.panelFontSize} onChange={(e) => set({ panelFontSize: Number(e.target.value) })} />
            <span>{settings.panelFontSize}px</span>
          </div>
        </div>
      </section>

      <section className="set-section">
        <h3>關於</h3>
        <div className="account-row">
          <div>
            <div>Translate and Analyze v{version}</div>
            <div className="muted small">{updateText(update)}</div>
          </div>
          <span className="spacer" />
          {update.state === 'downloaded' ? (
            <button className="btn primary" onClick={() => window.api.installUpdate()}>
              重新啟動並更新
            </button>
          ) : (
            <button className="btn" onClick={() => window.api.checkUpdate()} disabled={update.state === 'checking' || update.state === 'downloading'}>
              檢查更新
            </button>
          )}
        </div>
      </section>
    </Modal>
  )
}

function updateText(s: UpdateStatus): string {
  switch (s.state) {
    case 'checking':
      return '正在檢查更新…'
    case 'none':
      return '已是最新版本'
    case 'downloading':
      return `正在下載新版本${s.version ? ` v${s.version}` : ''}… ${s.percent}%`
    case 'downloaded':
      return `新版本 v${s.version} 已下載完成`
    case 'error':
      return `檢查更新失敗：${s.message.slice(0, 120)}`
    default:
      return '會自動檢查並下載更新'
  }
}

export function WelcomeModal() {
  const { auth, settings, updateSettings } = useApp()
  if (!settings || !auth?.planUsage || settings.welcomeShown) return null
  return (
    <Modal>
      <h2>You're using your ChatGPT plan</h2>
      <p>
        這個 app 的 AI 請求（翻譯、分析、導讀、問答）會使用你的 ChatGPT 方案額度，不會另外收費。
        <br />
        你可以在 ChatGPT 設定中查看用量，或為這個 app 設定上限。
      </p>
      <div className="modal-actions">
        <button className="btn" onClick={() => window.api.openExternal(MANAGE_USAGE_URL)}>
          管理用量
        </button>
        <button className="btn primary" onClick={() => void updateSettings({ welcomeShown: true })}>
          Got it
        </button>
      </div>
    </Modal>
  )
}

export function UsageLimitModal() {
  const { usageLimitOpen, setUsageLimitOpen } = useApp()
  if (!usageLimitOpen) return null
  return (
    <Modal onClose={() => setUsageLimitOpen(false)}>
      <h2>已達 ChatGPT 方案的使用上限</h2>
      <p>你的 ChatGPT 方案額度（或為這個 app 設定的上限）已經用完，暫時無法繼續。可以到 ChatGPT 設定查看用量與重置時間。</p>
      <div className="modal-actions">
        <button className="btn" onClick={() => setUsageLimitOpen(false)}>
          關閉
        </button>
        <button
          className="btn primary"
          onClick={() => {
            void window.api.openExternal(MANAGE_USAGE_URL)
            setUsageLimitOpen(false)
          }}
        >
          Manage usage
        </button>
      </div>
    </Modal>
  )
}

export function UpdateBanner() {
  const [s, setS] = useState<UpdateStatus>({ state: 'idle' })
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    window.api.updateStatus().then(setS)
    return window.api.onUpdateStatus(setS)
  }, [])
  if (s.state !== 'downloaded' || hidden) return null
  return (
    <div className="update-banner">
      <Sparkles size={15} />
      新版本 v{s.version} 已準備好。
      <button className="btn primary small" onClick={() => window.api.installUpdate()}>
        立即重新啟動更新
      </button>
      <button className="link-btn" onClick={() => setHidden(true)}>
        稍後（關閉 app 時自動更新）
      </button>
    </div>
  )
}

export function Toasts() {
  const { toasts } = useApp()
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === 'error' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  )
}
