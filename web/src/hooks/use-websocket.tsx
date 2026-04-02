import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react'
import { WsClient } from '@/lib/ws-client'
import type { WsClientMessage, WsServerMessage } from '@/lib/types'

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

interface WsContextValue {
  status: ConnectionStatus
  send: (msg: WsClientMessage) => void
  onMessage: (handler: (msg: WsServerMessage) => void) => () => void
}

const WsContext = createContext<WsContextValue | null>(null)

export function WsProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const clientRef = useRef<WsClient | null>(null)
  // 핸들러를 client 생성 전에도 등록할 수 있도록 대기열 관리
  const pendingHandlers = useRef<Set<(msg: WsServerMessage) => void>>(new Set())

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) return
    const client = new WsClient(token)
    clientRef.current = client

    // 대기 중인 핸들러를 client에 등록
    for (const handler of pendingHandlers.current) {
      client.onMessage(handler)
    }
    pendingHandlers.current.clear()

    const unsub = client.onStatus(setStatus)
    client.connect()
    return () => {
      unsub()
      client.disconnect()
      clientRef.current = null
    }
  }, [])

  const send = useCallback((msg: WsClientMessage) => {
    clientRef.current?.send(msg)
  }, [])

  // 안정적인 onMessage — 함수 참조가 절대 변하지 않음
  const onMessage = useCallback(
    (handler: (msg: WsServerMessage) => void) => {
      if (clientRef.current) {
        return clientRef.current.onMessage(handler)
      }
      // client가 아직 없으면 대기열에 추가
      pendingHandlers.current.add(handler)
      return () => {
        pendingHandlers.current.delete(handler)
      }
    },
    [],
  )

  // Context value 안정화
  const value = useMemo(
    () => ({ status, send, onMessage }),
    [status, send, onMessage],
  )

  return (
    <WsContext.Provider value={value}>
      {children}
    </WsContext.Provider>
  )
}

export function useWebSocket() {
  const ctx = useContext(WsContext)
  if (!ctx) throw new Error('useWebSocket must be used within WsProvider')
  return ctx
}
