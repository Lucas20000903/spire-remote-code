import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useWebSocket } from '@/hooks/use-websocket'
import { useSessions } from '@/hooks/use-sessions'
import { useLayout } from '@/components/layout/app-layout'
import type { TranscriptEntry } from '@/lib/types'
import { isConversationEntry, isSystemMessage, extractTasks } from '@/lib/types'
import { MessageList } from './message-list'
import { ChatInput } from './chat-input'
import { PermissionCard } from './permission-card'
import { TerminalView } from '@/components/terminal/terminal-view'
import { TaskListBlock } from './blocks/task-list-block'

interface PendingPermission {
  requestId: string
  toolName: string
  description: string
  inputPreview: string
}

const PAGE_SIZE = 100

export function ChatView() {
  const { bridgeId } = useParams<{ bridgeId: string }>()
  const { send, onMessage, status } = useWebSocket()
  const { findByBridgeId, markSeen } = useSessions()
  const { setTitle, viewMode, tmuxSession, isKeyboardOpen } = useLayout()
  const session = findByBridgeId(bridgeId || '')

  const [messages, setMessages] = useState<TranscriptEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const initialLoadDone = useRef(false)
  const [permissions, setPermissions] = useState<PendingPermission[]>([])
  const [serverTasks, setServerTasks] = useState<import('@/lib/types').TaskItem[]>([])


  const sessionId = session?.id || session?.cwd || ''
  // findByBridgeId를 ref에 저장해서 onMessage 핸들러에서 항상 최신 session 조회
  const findByBridgeIdRef = useRef(findByBridgeId)
  findByBridgeIdRef.current = findByBridgeId
  const bridgeIdRef = useRef(bridgeId)
  bridgeIdRef.current = bridgeId

  // Subscribe for history loading
  useEffect(() => {
    if (!sessionId) return
    send({ type: 'subscribe', session_id: sessionId })
    return () => {
      send({ type: 'unsubscribe', session_id: sessionId })
    }
  }, [sessionId, send])

  // bridgeId 바뀌면 messages 초기화 + completed 세션 확인 처리
  useEffect(() => {
    setMessages([])
    setHasMore(true)
    setLoading(false)
    initialLoadDone.current = false
    setPermissions([])
    setServerTasks([])
    if (bridgeId) markSeen(bridgeId)
  }, [bridgeId, markSeen])

  // 세션 방문 기록 전송
  useEffect(() => {
    if (!session) return
    send({
      type: 'visit_session',
      cwd: session.cwd,
      session_id: session.id || undefined,
      last_user_message: session.lastUserMessage || undefined,
    } as any)
  }, [session?.bridge_id])

  // session.id가 설정되면 history 로드 (auto-match 완료 후)
  const actualSessionId = session?.id
  useEffect(() => {
    if (!actualSessionId) return

    setHasMore(true)
    setLoading(true)
    initialLoadDone.current = true
    send({ type: 'load_history', session_id: actualSessionId, limit: PAGE_SIZE, cwd: session?.cwd } as any)
    send({ type: 'load_tasks', session_id: actualSessionId } as any)
  }, [actualSessionId])

  // Handle incoming WS messages
  useEffect(() => {
    const unsub = onMessage((msg) => {
      // 항상 최신 session 정보로 매칭
      const currentSession = findByBridgeIdRef.current(bridgeIdRef.current || '')
      const msgSid = (msg as any).session_id

      // session_id로만 엄격 매칭
      const isMatch = !!(msgSid && currentSession?.id && msgSid === currentSession.id)

      if (msg.type === 'error') {
        setLoading(false)
        setHasMore(false)
      }

      if ((msg as any).type === 'tasks' && isMatch) {
        setServerTasks((msg as any).tasks || [])
      }

      if (msg.type === 'history' && isMatch) {
        setLoading(false)
        if (msg.messages.length < PAGE_SIZE) {
          setHasMore(false)
        }
        setMessages((prev) => {
          const existing = new Set(prev.map((m) => m.uuid))
          const newMsgs = msg.messages.filter((m) => !existing.has(m.uuid) && isConversationEntry(m))
          return [...newMsgs, ...prev]
        })
      }

      if (msg.type === 'permission_request' && msg.bridge_id === bridgeIdRef.current) {
        setPermissions((prev) => [
          ...prev.filter((p) => p.requestId !== msg.request_id),
          {
            requestId: msg.request_id,
            toolName: msg.tool_name,
            description: msg.description,
            inputPreview: msg.input_preview,
          },
        ])
      }

      if (msg.type === 'jsonl_update' && (msg.bridge_id === bridgeIdRef.current || msgSid === currentSession?.id)) {
        setMessages((prev) => {
          // Remove optimistic entries that match incoming real entries
          const filtered = prev.filter((m) => !m.uuid.startsWith('optimistic-'))
          const existing = new Map(filtered.map((m) => [m.uuid, m]))
          for (const entry of msg.messages) {
            if (isConversationEntry(entry)) {
              existing.set(entry.uuid, entry)
            }
          }
          return Array.from(existing.values()).sort(
            (a, b) =>
              new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          )
        })
      }
    })
    return unsub
  }, [onMessage])

  const handleLoadMore = useCallback(() => {
    if (loading || !hasMore || messages.length === 0) return
    setLoading(true)
    const oldest = messages[0]
    send({
      type: 'load_history',
      session_id: sessionId,
      limit: PAGE_SIZE,
      before: oldest.uuid,
    })
  }, [loading, hasMore, messages, send, sessionId])

  const handlePermission = useCallback(
    (requestId: string, behavior: 'allow' | 'deny') => {
      if (!session) return
      send({ type: 'permission_response', bridge_id: session.bridge_id, request_id: requestId, behavior } as any)
    },
    [send, session]
  )

  const handleSend = useCallback(
    (content: string) => {
      if (!session) return
      send({ type: 'send_message', session_id: session.id || '', bridge_id: session.bridge_id, content } as any)

      // Optimistic: 유저 메시지를 즉시 화면에 추가
      const optimisticEntry: TranscriptEntry = {
        uuid: `optimistic-${Date.now()}`,
        parentUuid: '',
        sessionId: session.id || '',
        timestamp: new Date().toISOString(),
        type: 'user',
        message: { role: 'user', content, stop_reason: null },
      }
      setMessages((prev) => [...prev, optimisticEntry])

      requestAnimationFrame(() => {
        const list = inputRef.current?.parentElement?.querySelector<HTMLElement>('[data-message-list]')
        if (list) list.scrollTop = list.scrollHeight
      })
    },
    [send, session]
  )

  const inputRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (viewMode !== 'chat') return
    if (!inputRef.current) return
    const list = inputRef.current.parentElement?.querySelector<HTMLElement>('[data-message-list]')
    if (!list) return
    const ro = new ResizeObserver(([entry]) => {
      const prevPadding = parseFloat(list.style.paddingBottom) || 0
      const newPadding = entry.contentRect.height + 8
      const diff = newPadding - prevPadding
      list.style.paddingBottom = `${newPadding}px`
      if (diff > 0) {
        list.scrollTop += diff
      }
    })
    ro.observe(inputRef.current)
    return () => ro.disconnect()
  }, [session, viewMode])

  // Set header title with last user message as subtitle
  useEffect(() => {
    if (!session) {
      setTitle(null)
      return () => setTitle(null)
    }
    const project = session.cwd.split('/').pop() || session.cwd
    let subtitle: string | undefined
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.type !== 'user' || !m.message) continue
      const c = m.message.content
      let text = ''
      if (typeof c === 'string') {
        text = c
      } else if (Array.isArray(c)) {
        text = c
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map((b) => b.text)
          .join(' ')
      }
      if (text && !text.startsWith('<') && !text.startsWith('[Request interrupted')) {
        subtitle = text.slice(0, 80)
        break
      }
    }
    setTitle({ project, subtitle })
    return () => setTitle(null)
  }, [session, messages, setTitle])

  // 서버가 전체 JSONL에서 추출한 task 목록 우선, 실시간 업데이트는 메시지에서 보충
  const tasks = useMemo(() => {
    const fromMessages = extractTasks(messages)
    if (serverTasks.length === 0) return fromMessages
    // 서버 task를 기반으로 하되, 메시지에서 더 최신 status가 있으면 반영
    const msgMap = new Map(fromMessages.map((t) => [t.id, t]))
    return serverTasks.map((t) => {
      const updated = msgMap.get(t.id)
      return updated && updated.status !== 'open' ? updated : t
    })
  }, [serverTasks, messages])

  if (!session) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Session not found</p>
      </div>
    )
  }

  const hasBridge = session?.has_bridge === true
  const noBridgeClaude = !hasBridge && session?.command === 'claude'

  if (viewMode === 'terminal' && tmuxSession) {
    return (
      <div className="flex min-h-0 flex-1 flex-col pt-16 md:pt-20">
        <TerminalView session={tmuxSession} />
      </div>
    )
  }

  // Claude 실행 중 + MCP 미연결 + session_id도 없음 → 이력도 없고 입력도 불가
  if (noBridgeClaude && !session?.id) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4">
        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3 text-center text-sm">
          <p className="font-medium text-yellow-500">MCP 미연결</p>
          <p className="mt-1 text-muted-foreground">
            채널 서버가 연결되지 않아 채팅을 사용할 수 없습니다.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            터미널 버튼으로 셸을 확인하거나, Claude Code에서 MCP를 재연결하세요.
          </p>
        </div>
      </div>
    )
  }
  // session_id는 있지만 Bridge 없음 → 이력은 보이고 입력만 비활성 (ChatInput에서 처리)

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <MessageList
        messages={messages}
        loading={loading}
        hasMore={hasMore}
        onLoadMore={handleLoadMore}
        isWaiting={(() => {
          if (messages.length === 0) return false
          // 내부 시스템 메시지를 건너뛰고 마지막 실제 대화 메시지 찾기
          let last = null
          for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i]
            const c = m.message?.content
            if (typeof c === 'string' && isSystemMessage(c)) continue
            last = m
            break
          }
          if (!last) return false
          if (last.type === 'user') {
            const c = last.message?.content
            if (typeof c === 'string' && c.includes('[Request interrupted')) return false
            if (Array.isArray(c) && c.some((b) => b.type === 'text' && (b as any).text?.includes('[Request interrupted'))) return false
            return true
          }
          if (last.type === 'assistant' && last.message) {
            return last.message.stop_reason === 'tool_use'
          }
          return false
        })()}
      />
      <div ref={inputRef} className="absolute bottom-0 left-0 right-0 z-10" style={{ paddingBottom: isKeyboardOpen ? 0 : 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="mx-auto max-w-4xl">
          {tasks.length > 0 && (
            <div className="px-3 py-2">
              <TaskListBlock tasks={tasks} />
            </div>
          )}
          {permissions.map((p) => (
            <PermissionCard
              key={p.requestId}
              requestId={p.requestId}
              toolName={p.toolName}
              description={p.description}
              inputPreview={p.inputPreview}
              onRespond={handlePermission}
            />
          ))}
          {!hasBridge && session?.command === 'claude' && (
            <div className="px-3 py-2">
              <div className="rounded-lg border border-border/50 bg-muted/80 px-3 py-2 text-center text-xs text-yellow-500">
                MCP 미연결 — 메시지를 보내려면 Claude Code에서 채널을 재연결하세요
              </div>
            </div>
          )}
          <ChatInput
            disabled={status !== 'connected' || !hasBridge}
            onSend={handleSend}
          />
        </div>
      </div>
    </div>
  )
}
