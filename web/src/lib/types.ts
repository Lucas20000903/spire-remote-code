// WebSocket 메시지 타입
export type WsClientMessage =
  | { type: 'send_message'; session_id: string; content: string }
  | { type: 'list_sessions' }
  | { type: 'load_history'; session_id: string; limit: number; before?: string }
  | { type: 'create_session'; cwd: string }
  | { type: 'subscribe'; session_id: string }
  | { type: 'unsubscribe'; session_id: string }

export type WsServerMessage =
  | { type: 'sessions'; active: SessionInfo[]; recent: SessionInfo[] }
  | { type: 'stream_delta'; session_id: string; chat_id: string; content: string }
  | { type: 'stream_end'; session_id: string; chat_id: string }
  | { type: 'jsonl_update'; session_id: string; bridge_id?: string | null; messages: TranscriptEntry[] }
  | { type: 'session_registered'; session: SessionInfo }
  | { type: 'session_unregistered'; bridge_id: string }
  | { type: 'session_updated'; bridge_id: string; session_id: string }
  | { type: 'session_created'; session_id: string; cwd: string }
  | { type: 'session_create_failed'; error: string }
  | { type: 'history'; session_id: string; messages: TranscriptEntry[] }
  | { type: 'error'; message: string }

export type SessionStatus = 'idle' | 'in-progress' | 'completed' | 'pending'

export interface SessionInfo {
  id: string | null
  cwd: string
  port: number
  bridge_id: string
  lastUserMessage?: string
  status?: SessionStatus
}

/** jsonl_update 메시지 배열에서 세션 상태 추론 */
export function deriveSessionStatus(messages: TranscriptEntry[]): SessionStatus | null {
  // 뒤에서부터 실제 대화 메시지 찾기
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    const c = m.message?.content
    if (typeof c === 'string' && isSystemMessage(c)) continue

    if (m.type === 'assistant' && m.message) {
      if (m.message.stop_reason === 'end_turn') return 'completed'
      if (m.message.stop_reason === 'tool_use' || m.message.stop_reason === null) return 'in-progress'
    }
    if (m.type === 'user') {
      // tool_result만 있는 메시지는 건너뛰기
      if (Array.isArray(c) && c.every((b) => b.type === 'tool_result')) continue
      return 'in-progress'
    }
  }
  return null // 판단 불가 → 기존 상태 유지
}

export interface TranscriptEntry {
  uuid: string
  parentUuid: string
  sessionId: string
  timestamp: string
  type: string
  message?: { role: string; content: string | ContentBlock[]; stop_reason?: string | null } | null
  isSidechain?: boolean
  cwd?: string
  toolUseResult?: { interrupted?: boolean }
  sourceToolAssistantUUID?: string
}

const INTERNAL_PREFIXES = [
  '<system-reminder>',
  '<local-command-caveat>',
  'Caveat:', 'This session is being continued',
]

/** channel 태그에서 실제 메시지 추출 */
export function extractChannelContent(text: string): string | null {
  const match = text.match(/<channel[^>]*>\n?([\s\S]*?)\n?<\/channel>/)
  return match ? match[1].trim() : null
}

/** CLI 명령 메시지 파싱 */
export function extractCommandInfo(text: string): { name: string; stdout?: string } | null {
  const nameMatch = text.match(/<command-name>(.*?)<\/command-name>/)
  if (!nameMatch) return null
  const name = nameMatch[1]
  const stdoutMatch = text.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/)
  return { name, stdout: stdoutMatch?.[1]?.trim() }
}

/** local-command-stdout만 있는 메시지 */
export function extractStdout(text: string): string | null {
  const match = text.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/)
  return match && !text.includes('<command-name>') ? match[1].trim() : null
}

/** user/assistant 대화 엔트리만 필터 */
export function isConversationEntry(e: TranscriptEntry): boolean {
  return (e.type === 'user' || e.type === 'assistant') && !!e.message
}

/** tool_result를 tool_use_id로 매핑한 맵 */
export type ToolResultMap = Map<string, { content?: unknown; is_error?: boolean; interrupted?: boolean }>

/** 메시지 목록에서 tool_result를 추출하여 tool_use_id별 맵 생성 */
export function buildToolResultMap(entries: TranscriptEntry[]): ToolResultMap {
  const map: ToolResultMap = new Map()
  for (const e of entries) {
    if (!e.message || typeof e.message.content === 'string') continue
    for (const block of e.message.content) {
      if (block.type === 'tool_result') {
        map.set(block.tool_use_id, {
          content: block.content,
          is_error: block.is_error,
          interrupted: e.toolUseResult?.interrupted,
        })
      }
    }
  }
  return map
}

/** tool_result만 있는 user 엔트리인지 (병합 대상 → 별도 렌더링 불필요) */
export function isToolResultOnlyEntry(e: TranscriptEntry): boolean {
  if (e.type !== 'user' || !e.message) return false
  const { content } = e.message
  return Array.isArray(content) && content.length > 0 && content.every(b => b.type === 'tool_result')
}

/** text 블록 없이 tool_use만 있는 assistant 메시지인지 (thinking은 허용) */
export function isToolUseOnlyEntry(e: TranscriptEntry): boolean {
  if (e.type !== 'assistant' || !e.message) return false
  const { content } = e.message
  if (!Array.isArray(content)) return false
  const hasToolUse = content.some((b) => b.type === 'tool_use')
  const hasText = content.some((b) => b.type === 'text')
  return hasToolUse && !hasText
}

/** 완전히 숨길 내부 시스템 메시지 */
export function isInternalContent(text: string): boolean {
  return INTERNAL_PREFIXES.some(p => text.trimStart().startsWith(p))
}

/** isWaiting 판단 시 건너뛸 시스템/명령 메시지 */
export function isSystemMessage(text: string): boolean {
  const t = text.trimStart()
  return isInternalContent(t)
    || t.startsWith('<command-name>')
    || t.startsWith('<local-command-stdout>')
    || t.startsWith('<command-message>')
    || t.startsWith('<command-args>')
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content?: unknown; is_error?: boolean }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
