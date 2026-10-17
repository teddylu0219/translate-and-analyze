import { useCallback, useEffect, useRef, useState } from 'react'
import type { DocData } from '../../../shared/types'

/** 文件的畫線、翻譯快取、摘要、對話；變更後 800ms 自動存檔，離開時立即存 */
export function useDocData(docId: string): [DocData | null, (fn: (d: DocData) => DocData) => void] {
  const [data, setData] = useState<DocData | null>(null)
  const latest = useRef<DocData | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const dirty = useRef(false)

  useEffect(() => {
    let alive = true
    const flush = (): void => {
      if (dirty.current && latest.current) void window.api.saveDocData(docId, latest.current)
      dirty.current = false
    }
    window.addEventListener('beforeunload', flush)
    window.api.getDocData(docId).then((d) => {
      if (!alive) return
      latest.current = d
      setData(d)
    })
    return () => {
      alive = false
      window.removeEventListener('beforeunload', flush)
      window.clearTimeout(timer.current)
      flush()
    }
  }, [docId])

  const update = useCallback(
    (fn: (d: DocData) => DocData) => {
      if (!latest.current) return
      latest.current = fn(latest.current)
      setData(latest.current)
      dirty.current = true
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        dirty.current = false
        if (latest.current) void window.api.saveDocData(docId, latest.current)
      }, 800)
    },
    [docId]
  )

  return [data, update]
}
