import { app, safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import { join, dirname } from 'node:path'
import type { Settings } from '../shared/types'

export const dataDir = (...p: string[]): string => join(app.getPath('userData'), ...p)

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** 先寫暫存檔再改名，避免寫到一半當機留下壞檔 */
export async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(value), 'utf8')
  await fs.rename(tmp, file)
}

/** 用 Windows DPAPI（safeStorage）加密存放 token、API key */
export async function readSecret<T>(name: string): Promise<T | null> {
  try {
    const buf = await fs.readFile(dataDir(`${name}.bin`))
    return JSON.parse(safeStorage.decryptString(buf)) as T
  } catch {
    return null
  }
}

export async function writeSecret(name: string, value: unknown): Promise<void> {
  const file = dataDir(`${name}.bin`)
  await fs.mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, safeStorage.encryptString(JSON.stringify(value)), { mode: 0o600 })
  await fs.rename(tmp, file)
}

export async function deleteSecret(name: string): Promise<void> {
  await fs.rm(dataDir(`${name}.bin`), { force: true })
}

const defaultSettings: Settings = {
  provider: 'chatgpt',
  model: '',
  targetLang: '繁體中文（台灣）',
  reasoning: 'low',
  customInstructions: '',
  theme: 'system',
  panelFontSize: 15,
  welcomeShown: false
}

let settingsCache: Settings | null = null

export async function getSettings(): Promise<Settings> {
  if (!settingsCache) {
    settingsCache = { ...defaultSettings, ...(await readJson(dataDir('settings.json'), {})) }
  }
  return settingsCache
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  settingsCache = { ...(await getSettings()), ...patch }
  await writeJson(dataDir('settings.json'), settingsCache)
  return settingsCache
}
