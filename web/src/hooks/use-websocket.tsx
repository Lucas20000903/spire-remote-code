import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
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

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) return
    const client = new WsClient(token)
    clientRef.current = client
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

  const onMessage = useCallback(
    (handler: (msg: WsServerMessage) => void) => {
      return clientRef.current?.onMessage(handler) ?? (() => {})
    },
    [],
  )

  return (
    <WsContext.Provider value={{ status, send, onMessage }}>
      {children}
    </WsContext.Provider>
  )
}

export function useWebSocket() {
  const ctx = useContext(WsContext)
  if (!ctx) throw new Error('useWebSocket must be used within WsProvider')
  return ctx
}
