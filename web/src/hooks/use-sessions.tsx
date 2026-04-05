import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWebSocket } from './use-websocket'
import type { SessionInfo, SessionStatus, HookSessionStatus, WsServerMessage } from '@/lib/types'
import { extractChannelContent, isSystemMessage, deriveSessionStatus } from '@/lib/types'
import { showNotification } from '@/lib/notifications'
import { useSettings } from './use-settings'

interface SessionsContextValue {
  active: SessionInfo[]
  recent: SessionInfo[]
  createSession: (cwd: string) => void
  closeSession: (bridgeId: string, tmuxSession?: string) => void
  findByBridgeId: (bridgeId: string) => SessionInfo | undefined
  completedCount: number
  markSeen: (bridgeId: string) => void
}

/** Hook 서버 상태 → UI 세션 상태 변환 */
function hookToSessionStatus(hook: HookSessionStatus): SessionStatus {
  switch (hook) {
    case 'in-progress':
    case 'tool-running':
      return hook as SessionStatus
    case 'idle':
      return 'completed'
    case 'error':
      return 'error'
    case 'active':
      return 'idle'
    case 'disconnected':
      return 'idle'
    default:
      return 'idle'
  }
}

const SessionsContext = createContext<SessionsContextValue | null>(null)

export function SessionsProvider({ children }: { children: ReactNode }) {
  const { send, onMessage, status } = useWebSocket()
  const navigate = useNavigate()
  const { settings } = useSettings()
  const [active, setActive] = useState<SessionInfo[]>([])
  const [recent, setRecent] = useState<SessionInfo[]>([])
  const seenRef = useRef<Set<string>>(new Set())
  const prevStatusRef = useRef<Map<string, SessionStatus>>(new Map())
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  useEffect(() => {
    if (status !== 'connected') return

    send({ type: 'list_sessions' })

    // 탭 활성화 시 세션 목록 갱신
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        send({ type: 'list_sessions' })
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    return onMessage((msg: WsServerMessage) => {
      if (msg.type === 'sessions') {
        setActive((prev) => {
          const prevMap = new Map(prev.map((s) => [s.bridge_id, s]))
          const merged = msg.active.map((s) => {
            const existing = prevMap.get(s.bridge_id)
            let status = (s.status || existing?.status || 'idle') as SessionStatus
            if (status === 'completed' && seenRef.current.has(s.bridge_id)) {
              status = 'idle'
            }
            return { ...s, status }
          })

          // pending 세션 생성 후 목록에 나타나면 자동 이동
          if (pendingCwdRef.current) {
            const newSession = merged.find((s) =>
              s.cwd === pendingCwdRef.current && !prevMap.has(s.bridge_id)
            )
            if (newSession) {
              pendingCwdRef.current = null
              navigate(`/chat/${newSession.bridge_id}`)
            }
          }

          return merged
        })
        setRecent(msg.recent)
      } else if (msg.type === 'session_registered') {
        // 서버에서 정확한 목록 다시 받기
        send({ type: 'list_sessions' })
      } else if (msg.type === 'session_unregistered') {
        // Bridge 끊김 → has_bridge false + 재요청으로 tmux 기반 목록 갱신
        setActive((prev) => prev.map((s) =>
          s.bridge_id === msg.bridge_id
            ? { ...s, has_bridge: false }
            : s
        ))
        send({ type: 'list_sessions' })
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

        // 상태 기록 + 새 활동 시 seen 리셋
        if (newStatus && bid) {
          prevStatusRef.current.set(bid, newStatus)
          if (newStatus === 'in-progress') seenRef.current.delete(bid)
        }
      } else if (msg.type === 'hook_status') {
        // Hook 기반 상태: session_id로 세션 찾아서 업데이트
        const hookStatus = hookToSessionStatus(msg.status)
        const sid = msg.session_id

        // SessionStart: 새 세션이 시작됐을 수 있음 → 목록 갱신
        if ((msg as any).event === 'SessionStart') {
          send({ type: 'list_sessions' })
        }

        setActive((prev) => {
          const target = prev.find((s) => s.id === sid)
          if (!target) return prev

          const bid = target.bridge_id
          const prevStatus = prevStatusRef.current.get(bid)

          // completed 전환 감지 → 알림
          if (hookStatus === 'completed' && prevStatus && prevStatus !== 'completed' && settingsRef.current.notificationsEnabled) {
            const project = target.cwd.split('/').pop() || 'Session'
            showNotification(`${project} - Task completed`, target.lastUserMessage || undefined)
          }

          if (hookStatus) {
            prevStatusRef.current.set(bid, hookStatus)
            if (hookStatus === 'in-progress' || hookStatus === 'tool-running') seenRef.current.delete(bid)
          }

          return prev.map((s) =>
            s.id === sid ? { ...s, status: hookStatus } : s
          )
        })
      }
    })

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [status, send, onMessage, navigate])

  const pendingCwdRef = useRef<string | null>(null)

  const createSession = useCallback(
    (cwd: string) => {
      pendingCwdRef.current = cwd
      send({ type: 'create_session', cwd })
    },
    [send],
  )

  const closeSession = useCallback(
    (bridgeId: string, tmuxSession?: string) => {
      const tmux = tmuxSession || active.find((s) => s.bridge_id === bridgeId)?.tmux_session
      if (!tmux) return
      // Optimistic: 즉시 목록에서 제거
      setActive((prev) => prev.filter((s) => s.bridge_id !== bridgeId))
      send({ type: 'close_session', tmux_session: tmux } as any)
    },
    [active, send],
  )

  const findByBridgeId = useCallback(
    (bridgeId: string) => active.find((s) => s.bridge_id === bridgeId),
    [active],
  )

  // completed 세션을 idle로 전환 (세션 진입 시 호출)
  const markSeen = useCallback((bridgeId: string) => {
    seenRef.current.add(bridgeId)
    setActive((prev) => {
      const session = prev.find((s) => s.bridge_id === bridgeId)
      // 서버에 seen 알림 (session_id가 있으면)
      if (session?.id && session.status === 'completed') {
        send({ type: 'mark_seen', session_id: session.id } as any)
      }
      return prev.map((s) =>
        s.bridge_id === bridgeId && s.status === 'completed'
          ? { ...s, status: 'idle' as SessionStatus }
          : s
      )
    })
  }, [send])

  const completedCount = active.filter((s) => s.status === 'completed').length

  return (
    <SessionsContext.Provider value={{ active, recent, createSession, closeSession, findByBridgeId, completedCount, markSeen }}>
      {children}
    </SessionsContext.Provider>
  )
}

export function useSessions() {
  const ctx = useContext(SessionsContext)
  if (!ctx) throw new Error('useSessions must be used within SessionsProvider')
  return ctx
}
