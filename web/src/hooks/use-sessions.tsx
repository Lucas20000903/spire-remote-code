import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWebSocket } from './use-websocket'
import type { SessionInfo, SessionStatus, WsServerMessage } from '@/lib/types'
import { extractChannelContent, isSystemMessage, deriveSessionStatus } from '@/lib/types'
import { showNotification } from '@/lib/notifications'
import { useSettings } from './use-settings'

interface SessionsContextValue {
  active: SessionInfo[]
  recent: SessionInfo[]
  createSession: (cwd: string) => void
  findByBridgeId: (bridgeId: string) => SessionInfo | undefined
  completedCount: number
  markSeen: (bridgeId: string) => void
}

const SessionsContext = createContext<SessionsContextValue | null>(null)

export function SessionsProvider({ children }: { children: ReactNode }) {
  const { send, onMessage, status } = useWebSocket()
  const navigate = useNavigate()
  const { settings } = useSettings()
  const [active, setActive] = useState<SessionInfo[]>([])
  const [recent, setRecent] = useState<SessionInfo[]>([])
  const pendingRef = useRef<Set<string>>(new Set())
  const prevStatusRef = useRef<Map<string, SessionStatus>>(new Map())
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  useEffect(() => {
    if (status !== 'connected') return

    send({ type: 'list_sessions' })

    return onMessage((msg: WsServerMessage) => {
      if (msg.type === 'sessions') {
        setActive((prev) => {
          const pendingSessions = prev.filter((s) => pendingRef.current.has(s.bridge_id))
          // 기존 status 보존
          const prevMap = new Map(prev.map((s) => [s.bridge_id, s]))
          const merged = msg.active.map((s) => {
            const existing = prevMap.get(s.bridge_id)
            return { ...s, status: (existing?.status || s.status || 'idle') as SessionStatus }
          })
          return [...merged, ...pendingSessions]
        })
        setRecent(msg.recent)
      } else if (msg.type === 'session_registered') {
        setActive((prev) => {
          const pendingIdx = prev.findIndex(
            (s) => pendingRef.current.has(s.bridge_id) && s.cwd === msg.session.cwd
          )
          if (pendingIdx >= 0) {
            const tempId = prev[pendingIdx].bridge_id
            pendingRef.current.delete(tempId)
            navigate(`/chat/${msg.session.bridge_id}`, { replace: true })
            return [
              ...prev.filter((s) => s.bridge_id !== tempId && s.bridge_id !== msg.session.bridge_id),
              { ...msg.session, status: 'idle' as SessionStatus },
            ]
          }
          return [
            ...prev.filter((s) => s.bridge_id !== msg.session.bridge_id),
            { ...msg.session, status: 'idle' as SessionStatus },
          ]
        })
      } else if (msg.type === 'session_unregistered') {
        setActive((prev) => prev.filter((s) => s.bridge_id !== msg.bridge_id))
      } else if (msg.type === 'session_updated') {
        setActive((prev) => prev.map((s) => s.bridge_id === msg.bridge_id ? { ...s, id: msg.session_id } : s))
      } else if (msg.type === 'jsonl_update') {
        const bid = msg.bridge_id
        if (!bid) return

        // 상태 추론
        const newStatus = deriveSessionStatus(msg.messages)

        // 마지막 유저 메시지 추출
        let lastUserText = ''
        const userMsgs = msg.messages.filter((m) => m.type === 'user' && m.message)
        const lastUser = userMsgs[userMsgs.length - 1]
        if (lastUser?.message) {
          const c = lastUser.message.content
          if (typeof c === 'string') {
            const channel = extractChannelContent(c)
            if (channel) lastUserText = channel
            else if (!isSystemMessage(c)) lastUserText = c
          }
        }

        setActive((prev) => {
          const found = prev.find((s) => s.bridge_id === bid)
          if (newStatus) console.log('[sessions] status update', { bid: bid.slice(0, 12), newStatus, found: !!found })
          return prev.map((s) => {
            if (s.bridge_id !== bid) return s
            const updates: Partial<SessionInfo> = {}
            if (newStatus) updates.status = newStatus
            if (lastUserText) updates.lastUserMessage = lastUserText.slice(0, 60)
            return { ...s, ...updates }
          })
        })

        // 완료 전환 감지 → 알림
        if (newStatus === 'completed' && settingsRef.current.notificationsEnabled) {
          const prevStatus = prevStatusRef.current.get(bid)
          if (prevStatus && prevStatus !== 'completed') {
            setActive((prev) => {
              const session = prev.find((s) => s.bridge_id === bid)
              const project = session?.cwd.split('/').pop() || 'Session'
              showNotification(`${project} - Task completed`, lastUserText || undefined)
              return prev
            })
          }
        }

        // 상태 기록
        if (newStatus && bid) {
          prevStatusRef.current.set(bid, newStatus)
        }
      }
    })
  }, [status, send, onMessage, navigate])

  const createSession = useCallback(
    (cwd: string) => {
      const tempBridgeId = `pending-${Date.now()}`
      const tempSession: SessionInfo = {
        id: null,
        cwd,
        port: 0,
        bridge_id: tempBridgeId,
        status: 'pending',
      }
      pendingRef.current.add(tempBridgeId)
      setActive((prev) => [...prev, tempSession])
      navigate(`/chat/${tempBridgeId}`)
      send({ type: 'create_session', cwd })
    },
    [send, navigate],
  )

  const findByBridgeId = useCallback(
    (bridgeId: string) => active.find((s) => s.bridge_id === bridgeId),
    [active],
  )

  // completed 세션을 idle로 전환 (세션 진입 시 호출)
  const markSeen = useCallback((bridgeId: string) => {
    setActive((prev) => prev.map((s) =>
      s.bridge_id === bridgeId && s.status === 'completed'
        ? { ...s, status: 'idle' as SessionStatus }
        : s
    ))
  }, [])

  const completedCount = active.filter((s) => s.status === 'completed').length

  return (
    <SessionsContext.Provider value={{ active, recent, createSession, findByBridgeId, completedCount, markSeen }}>
      {children}
    </SessionsContext.Provider>
  )
}

export function useSessions() {
  const ctx = useContext(SessionsContext)
  if (!ctx) throw new Error('useSessions must be used within SessionsProvider')
  return ctx
}
