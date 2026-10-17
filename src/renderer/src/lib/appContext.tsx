import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { AiError, AuthStatus, Settings } from '../../../shared/types'

interface Toast {
  id: number
  text: string
  kind: 'info' | 'error'
}

interface AppState {
  settings: Settings | null
  updateSettings: (patch: Partial<Settings>) => Promise<void>
  auth: AuthStatus | null
  setAuth: (a: AuthStatus) => void
  refreshAuth: () => Promise<void>
  settingsOpen: boolean
  openSettings: (open?: boolean) => void
  /** 目前的 AI 設定是否可以使用 */
  aiReady: boolean
  toasts: Toast[]
  toast: (text: string, kind?: Toast['kind']) => void
  usageLimitOpen: boolean
  setUsageLimitOpen: (v: boolean) => void
  reportAiError: (e: AiError | unknown) => void
}

const Ctx = createContext<AppState | null>(null)

export function useApp(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp outside provider')
  return v
}

let toastSeq = 0

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [auth, setAuth] = useState<AuthStatus | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [usageLimitOpen, setUsageLimitOpen] = useState(false)

  const refreshAuth = useCallback(async () => {
    setAuth(await window.api.authStatus())
  }, [])

  useEffect(() => {
    window.api.getSettings().then(setSettings)
    void refreshAuth()
  }, [refreshAuth])

  useEffect(() => {
    if (settings) document.documentElement.dataset.theme = settings.theme
  }, [settings])

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings(await window.api.updateSettings(patch))
  }, [])

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = ++toastSeq
    setToasts((t) => [...t, { id, text, kind }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500)
  }, [])

  const reportAiError = useCallback(
    (e: AiError | unknown) => {
      const err = e as AiError
      if (err?.code === 'cancelled') return
      if (err?.code === 'subscription_sharing_usage_limit_exceeded') {
        setUsageLimitOpen(true)
        return
      }
      if (err?.code === 'need_signin' || err?.code === 'need_apikey' || err?.code === 'plan_not_enabled') {
        void refreshAuth()
        setSettingsOpen(true)
      }
      toast(err?.message ?? String(e), 'error')
    },
    [refreshAuth, toast]
  )

  const aiReady = !!settings && !!auth && (settings.provider === 'chatgpt' ? auth.signedIn && auth.planUsage : auth.apiKeySet)

  return (
    <Ctx.Provider
      value={{
        settings,
        updateSettings,
        auth,
        setAuth,
        refreshAuth,
        settingsOpen,
        openSettings: (open = true) => setSettingsOpen(open),
        aiReady,
        toasts,
        toast,
        usageLimitOpen,
        setUsageLimitOpen,
        reportAiError
      }}
    >
      {children}
    </Ctx.Provider>
  )
}
