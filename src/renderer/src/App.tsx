import { useEffect, useState } from 'react'

export default function App() {
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.api.getVersion().then(setVersion)
  }, [])

  return (
    <div className="layout">
      <section className="reader">
        <div className="placeholder">把 PDF 或 TXT 拖進來（M2 實作）</div>
      </section>
      <aside className="panel">
        <header className="panel-header">
          <strong>Translate and Analyze</strong>
          <span className="muted">v{version}</span>
        </header>
        <div className="placeholder">翻譯與逐段分析（M3 實作）</div>
      </aside>
    </div>
  )
}
