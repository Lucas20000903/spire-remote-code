import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useWebSocket } from '@/hooks/use-websocket'
import { useSessions } from '@/hooks/use-sessions'
import { useLayout } from '@/components/layout/app-layout'
import type { TranscriptEntry } from '@/lib/types'
import { isConversationEntry, isSystemMessage } from '@/lib/types'
import { MessageList } from './message-list'
import { ChatInput } from './chat-input'
import { PermissionCard } from './permission-card'

interface PendingPermission {
  requestId: string
  toolName: string
  description: string
  inputPreview: string
}

const PAGE_SIZE = 50

export function ChatView() {
  const { bridgeId } = useParams<{ bridgeId: string }>()
  const { send, onMessage, status } = useWebSocket()
  const { findByBridgeId, markSeen } = useSessions()
  const { setTitle } = useLayout()
  const session = findByBridgeId(bridgeId || '')

  const [messages, setMessages] = useState<TranscriptEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const initialLoadDone = useRef(false)
  const [permissions, setPermissions] = useState<PendingPermission[]>([])


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
    if (bridgeId) markSeen(bridgeId)
  }, [bridgeId, markSeen])

  // session.id가 설정되면 history 로드 (auto-match 완료 후)
  const actualSessionId = session?.id
  useEffect(() => {
    if (!actualSessionId) return

    setHasMore(true)
    setLoading(true)
    initialLoadDone.current = true
    send({ type: 'load_history', session_id: actualSessionId, limit: PAGE_SIZE, cwd: session?.cwd } as any)
  }, [actualSessionId])

  // Handle incoming WS messages
  useEffect(() => {
    const unsub = onMessage((msg) => {
      // 항상 최신 session 정보로 매칭
      const currentSession = findByBridgeIdRef.current(bridgeIdRef.current || '')
      const sid = currentSession?.id || currentSession?.cwd || ''
      const msgSid = (msg as any).session_id

      // session_id OR cwd 어느 것이든 매칭
      const isMatch = msgSid === sid || msgSid === currentSession?.id || msgSid === currentSession?.cwd || msgSid === ''

      if (msg.type === 'error') {
        setLoading(false)
        setHasMore(false)
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
    if (!inputRef.current) return
    const list = inputRef.current.parentElement?.querySelector<HTMLElement>('[data-message-list]')
    if (!list) return
    const ro = new ResizeObserver(([entry]) => {
      const prevPadding = parseFloat(list.style.paddingBottom) || 0
      const newPadding = entry.contentRect.height + 8
      const diff = newPadding - prevPadding
      list.style.paddingBottom = `${newPadding}px`
      // paddingBottom이 커지면 스크롤 위치를 보정 (현재 위치 유지)
      if (diff > 0) {
        list.scrollTop += diff
      }
    })
    ro.observe(inputRef.current)
    return () => ro.disconnect()
  }, [session])

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

  const isPending = bridgeId?.startsWith('pending-')

  if (isPending) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        <p className="text-sm text-muted-foreground">Starting session...</p>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Session not found</p>
      </div>
    )
  }

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
      <div ref={inputRef} className="absolute bottom-0 left-0 right-0 z-10">
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
        <ChatInput
          disabled={status !== 'connected'}
          onSend={handleSend}
        />
      </div>
    </div>
  )
}
