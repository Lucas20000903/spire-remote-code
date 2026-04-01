// WebSocket 메시지 타입
export type WsClientMessage =
  | { type: 'send_message'; session_id: string; content: string }
  | { type: 'permission_response'; session_id: string; request_id: string; behavior: 'allow' | 'deny' }
  | { type: 'list_sessions' }
  | { type: 'load_history'; session_id: string; limit: number; before?: string }
  | { type: 'create_session'; cwd: string }
  | { type: 'subscribe'; session_id: string }
  | { type: 'unsubscribe'; session_id: string }

export type WsServerMessage =
  | { type: 'sessions'; active: SessionInfo[]; recent: SessionInfo[] }
  | { type: 'stream_delta'; session_id: string; chat_id: string; content: string }
  | { type: 'stream_end'; session_id: string; chat_id: string }
  | { type: 'permission_request'; session_id: string; request_id: string; tool_name: string; description: string; input_preview: string }
  | { type: 'jsonl_update'; session_id: string; messages: TranscriptEntry[] }
  | { type: 'session_registered'; session: SessionInfo }
  | { type: 'session_unregistered'; session_id: string }
  | { type: 'session_created'; session_id: string; cwd: string }
  | { type: 'session_create_failed'; error: string }
  | { type: 'history'; session_id: string; messages: TranscriptEntry[] }
  | { type: 'error'; message: string }

export interface SessionInfo {
  id: string | null
  cwd: string
  port: number
  bridge_id: string
}

export interface TranscriptEntry {
  uuid: string
  parentUuid: string
  sessionId: string
  timestamp: string
  type: 'user' | 'assistant'
  message: { role: string; content: string | ContentBlock[] }
  isSidechain?: boolean
  cwd?: string
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content?: unknown; is_error?: boolean }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
