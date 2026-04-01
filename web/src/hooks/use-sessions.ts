import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWebSocket } from './use-websocket'
import type { SessionInfo, WsServerMessage } from '@/lib/types'
import { extractChannelContent, isSystemMessage } from '@/lib/types'

export function useSessions() {
  const { send, onMessage, status } = useWebSocket()
  const navigate = useNavigate()
  const [active, setActive] = useState<SessionInfo[]>([])
  const [recent, setRecent] = useState<SessionInfo[]>([])
  // Track pending optimistic sessions to replace when real one arrives
  const pendingRef = useRef<Set<string>>(new Set()) // temp bridge_ids

  useEffect(() => {
    if (status !== 'connected') return

    send({ type: 'list_sessions' })

    return onMessage((msg: WsServerMessage) => {
      if (msg.type === 'sessions') {
        // Preserve pending (optimistic) sessions
        setActive((prev) => {
          const pendingSessions = prev.filter((s) => pendingRef.current.has(s.bridge_id))
          return [...msg.active, ...pendingSessions]
        })
        setRecent(msg.recent)
      } else if (msg.type === 'session_registered') {
        // Find a pending session with matching cwd to replace
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
              msg.session,
            ]
          }
          return [
            ...prev.filter((s) => s.bridge_id !== msg.session.bridge_id),
            msg.session,
          ]
        })
      } else if (msg.type === 'session_unregistered') {
        setActive((prev) => prev.filter((s) => s.bridge_id !== msg.bridge_id))
      } else if (msg.type === 'session_updated') {
        setActive((prev) => prev.map((s) => s.bridge_id === msg.bridge_id ? { ...s, id: msg.session_id } : s))
      } else if (msg.type === 'jsonl_update') {
        // 마지막 유저 메시지를 세션에 저장
        const userMsgs = msg.messages.filter((m) => m.type === 'user' && m.message)
        const lastUser = userMsgs[userMsgs.length - 1]
        if (lastUser?.message) {
          const c = lastUser.message.content
          let text = typeof c === 'string' ? c : ''
          if (typeof c === 'string') {
            const channel = extractChannelContent(c)
            if (channel) text = channel
            else if (isSystemMessage(c)) text = ''
          }
          if (text) {
            const bid = msg.bridge_id
            if (bid) {
              setActive((prev) => prev.map((s) => s.bridge_id === bid ? { ...s, lastUserMessage: text.slice(0, 60) } : s))
            }
          }
        }
      }
    })
  }, [status, send, onMessage, navigate])

  const createSession = useCallback(
    (cwd: string) => {
      // Optimistic: add temp session + navigate immediately
      const tempBridgeId = `pending-${Date.now()}`
      const tempSession: SessionInfo = {
        id: null,
        cwd,
        port: 0,
        bridge_id: tempBridgeId,
      }
      pendingRef.current.add(tempBridgeId)
      setActive((prev) => [...prev, tempSession])
      navigate(`/chat/${tempBridgeId}`)

      // Actually create the session
      send({ type: 'create_session', cwd })
    },
    [send, navigate],
  )

  const findByBridgeId = useCallback(
    (bridgeId: string) => active.find((s) => s.bridge_id === bridgeId),
    [active],
  )

  return { active, recent, createSession, findByBridgeId }
}
