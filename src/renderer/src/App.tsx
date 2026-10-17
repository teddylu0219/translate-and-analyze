import { useEffect, useState } from 'react'
import type { DocMeta } from '../../shared/types'
import { AppProvider, useApp } from './lib/appContext'
import { Library } from './components/Library'
import { Reader } from './components/Reader'
import { SettingsDialog, Toasts, UpdateBanner, UsageLimitModal, WelcomeModal } from './components/Dialogs'

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}

function Shell() {
  const { auth, settings, settingsOpen, openSettings, toast } = useApp()
  const [doc, setDoc] = useState<DocMeta | null>(null)
  const [dragging, setDragging] = useState(false)
  const [libKey, setLibKey] = useState(0)

  // 整個視窗都可以拖放檔案
  useEffect(() => {
    let depth = 0
    const enter = (e: DragEvent): void => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      depth++
      setDragging(true)
    }
    const leave = (): void => {
      depth = Math.max(0, depth - 1)
      if (!depth) setDragging(false)
    }
    const over = (e: DragEvent): void => e.preventDefault()
    const drop = async (e: DragEvent): Promise<void> => {
      e.preventDefault()
      depth = 0
      setDragging(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      const paths = files.map((f) => window.api.pathForFile(f)).filter(Boolean)
      if (!paths.length) return
      try {
        const added = await window.api.importDocs(paths)
        if (!added.length) toast('只支援 PDF、TXT、Markdown 檔案', 'error')
        else if (added.length === 1) setDoc(added[0])
        else {
          setDoc(null)
          setLibKey((k) => k + 1)
          toast(`已加入 ${added.length} 份文件`)
        }
      } catch (err) {
        toast((err as Error)?.message ?? '加入檔案失敗', 'error')
      }
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [toast])

  if (!settings) return null

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => setDoc(null)}>
          <span className="logo">譯</span> Translate and Analyze
        </button>
        <span className="spacer" />
        <button className="account-chip" onClick={() => openSettings()}>
          {settings.provider === 'apikey' ? (
            auth?.apiKeySet ? (
              'OpenAI API key'
            ) : (
              <span className="warn-text">未設定 API key</span>
            )
          ) : auth?.signedIn ? (
            <>
              <span className="dot-ok" />
              {auth.email ?? 'ChatGPT'}
            </>
          ) : (
            <span className="warn-text">未登入 ChatGPT</span>
          )}
        </button>
        <button className="icon-btn" title="設定" onClick={() => openSettings()}>
          ⚙
        </button>
      </header>
      <UpdateBanner />
      <main className="content">
        {doc ? <Reader key={doc.id} doc={doc} onBack={() => setDoc(null)} /> : <Library onOpen={setDoc} refreshKey={libKey} />}
      </main>
      {dragging && <div className="drop-overlay">放開以開啟檔案</div>}
      {settingsOpen && <SettingsDialog />}
      <WelcomeModal />
      <UsageLimitModal />
      <Toasts />
    </div>
  )
}
