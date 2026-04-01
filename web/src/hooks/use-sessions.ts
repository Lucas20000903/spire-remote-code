import { useEffect, useState, useCallback } from 'react'
import { useWebSocket } from './use-websocket'
import type { SessionInfo, WsServerMessage } from '@/lib/types'

export function useSessions() {
  const { send, onMessage, status } = useWebSocket()
  const [active, setActive] = useState<SessionInfo[]>([])
  const [recent, setRecent] = useState<SessionInfo[]>([])

  useEffect(() => {
    if (status === 'connected') {
      send({ type: 'list_sessions' })
    }
  }, [status, send])

  useEffect(() => {
    return onMessage((msg: WsServerMessage) => {
      if (msg.type === 'sessions') {
        setActive(msg.active)
        setRecent(msg.recent)
      } else if (msg.type === 'session_registered') {
        setActive((prev) => [
          ...prev.filter((s) => s.bridge_id !== msg.session.bridge_id),
          msg.session,
        ])
      } else if (msg.type === 'session_unregistered') {
        setActive((prev) => prev.filter((s) => s.id !== msg.session_id))
      }
    })
  }, [onMessage])

  const createSession = useCallback(
    (cwd: string) => {
      send({ type: 'create_session', cwd })
    },
    [send],
  )

  return { active, recent, createSession }
}
