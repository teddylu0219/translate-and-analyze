import { promises as fs } from 'node:fs'
import { basename, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { dataDir, readJson, writeJson } from './store'
import type { DocData, DocMeta } from '../shared/types'

const root = (...p: string[]): string => dataDir('library', ...p)
const indexFile = (): string => root('index.json')

export const SUPPORTED = ['.pdf', '.txt', '.md', '.markdown']

async function readIndex(): Promise<DocMeta[]> {
  return readJson<DocMeta[]>(indexFile(), [])
}

export async function list(): Promise<DocMeta[]> {
  return (await readIndex()).sort((a, b) => b.openedAt - a.openedAt)
}

export async function importFiles(paths: string[]): Promise<DocMeta[]> {
  const index = await readIndex()
  const added: DocMeta[] = []
  for (const p of paths) {
    const ext = extname(p).toLowerCase()
    if (!SUPPORTED.includes(ext)) continue
    const stat = await fs.stat(p)
    const name = basename(p)
    // 同名同大小視為同一份，直接回傳既有的
    const existing = index.find((d) => d.fileName === name && d.size === stat.size)
    if (existing) {
      existing.openedAt = Date.now()
      added.push(existing)
      continue
    }
    const id = randomUUID()
    const type = ext === '.pdf' ? 'pdf' : 'txt'
    await fs.mkdir(root(id), { recursive: true })
    await fs.copyFile(p, root(id, `source${type === 'pdf' ? '.pdf' : '.txt'}`))
    const meta: DocMeta = {
      id,
      title: basename(p, extname(p)),
      fileName: name,
      type,
      size: stat.size,
      addedAt: Date.now(),
      openedAt: Date.now()
    }
    index.push(meta)
    added.push(meta)
  }
  await writeJson(indexFile(), index)
  return added
}

export async function readSource(id: string): Promise<Uint8Array> {
  const meta = (await readIndex()).find((d) => d.id === id)
  if (!meta) throw new Error('找不到文件')
  return fs.readFile(root(id, meta.type === 'pdf' ? 'source.pdf' : 'source.txt'))
}

export async function touch(id: string): Promise<void> {
  const index = await readIndex()
  const meta = index.find((d) => d.id === id)
  if (meta) {
    meta.openedAt = Date.now()
    await writeJson(indexFile(), index)
  }
}

export async function rename(id: string, title: string): Promise<void> {
  const index = await readIndex()
  const meta = index.find((d) => d.id === id)
  if (meta && title.trim()) {
    meta.title = title.trim()
    await writeJson(indexFile(), index)
  }
}

/** 文件庫卡片用的第一頁縮圖（data URL，約 10–30KB） */
export async function setThumb(id: string, thumb: string): Promise<void> {
  if (!thumb.startsWith('data:image/') || thumb.length > 300_000) return
  const index = await readIndex()
  const meta = index.find((d) => d.id === id)
  if (meta) {
    meta.thumb = thumb
    await writeJson(indexFile(), index)
  }
}

export async function remove(id: string): Promise<void> {
  const index = (await readIndex()).filter((d) => d.id !== id)
  await writeJson(indexFile(), index)
  await fs.rm(root(id), { recursive: true, force: true })
}

const emptyData = (): DocData => ({ highlights: [], paras: {}, summaries: {}, chat: [] })

export async function getData(id: string): Promise<DocData> {
  return { ...emptyData(), ...(await readJson<Partial<DocData>>(root(id, 'data.json'), {})) }
}

export async function saveData(id: string, data: DocData): Promise<void> {
  await writeJson(root(id, 'data.json'), data)
}
