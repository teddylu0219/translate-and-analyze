export type Provider = 'chatgpt' | 'apikey'
export type Reasoning = 'default' | 'low' | 'medium' | 'high'
export type Theme = 'system' | 'light' | 'dark'

export interface Settings {
  provider: Provider
  model: string
  targetLang: string
  reasoning: Reasoning
  customInstructions: string
  theme: Theme
  panelFontSize: number
  welcomeShown: boolean
}

export interface AuthStatus {
  signedIn: boolean
  email?: string
  planUsage: boolean
  apiKeySet: boolean
  /** 登出時無法確認遠端已撤銷授權 */
  revokeUnconfirmed?: boolean
}

export interface DocMeta {
  id: string
  title: string
  fileName: string
  type: 'pdf' | 'txt'
  size: number
  addedAt: number
  openedAt: number
}

/** 位置以頁面寬高的比例表示（0–1），和縮放無關。TXT 文件 page 為 0。 */
export interface Rect {
  page: number
  x: number
  y: number
  w: number
  h: number
}

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink'

export interface Highlight {
  id: string
  text: string
  color: HighlightColor
  note: string
  createdAt: number
  /** PDF：選取範圍的矩形 */
  rects: Rect[]
  /** TXT：段落與字元位移 */
  paraId?: string
  start?: number
  end?: number
}

export interface ParaResult {
  translation?: string
  analysis?: string
}

export interface ChatMsg {
  role: 'user' | 'assistant'
  text: string
  quote?: string
  error?: boolean
}

export interface DocData {
  highlights: Highlight[]
  /** 依目標語言分開快取：paras[lang][paraId] */
  paras: Record<string, Record<string, ParaResult>>
  summaries: Record<string, string>
  chat: ChatMsg[]
  lastPage?: number
}

export interface AiMessage {
  role: 'user' | 'assistant'
  text: string
}

export interface AiRequest {
  instructions: string
  messages: AiMessage[]
}

export interface AiError {
  code: string
  message: string
}

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'none' }
  | { state: 'downloading'; percent: number; version?: string }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }
