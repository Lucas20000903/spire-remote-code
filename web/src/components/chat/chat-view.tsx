import { useEffect, useState, useCallback, useRef } from 'react'
import { useWebSocket } from '@/hooks/use-websocket'
import type { TranscriptEntry } from '@/lib/types'
import { MessageList } from './message-list'
import { ChatInput } from './chat-input'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'

interface ChatViewProps {
  sessionId: string
  onBack: () => void
}

const PAGE_SIZE = 50

export function ChatView({ sessionId, onBack }: ChatViewProps) {
  const { send, onMessage, status } = useWebSocket()
  const [messages, setMessages] = useState<TranscriptEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const initialLoadDone = useRef(false)

  // Subscribe on mount, unsubscribe on unmount
  useEffect(() => {
    send({ type: 'subscribe', session_id: sessionId })
    return () => {
      send({ type: 'unsubscribe', session_id: sessionId })
    }
  }, [sessionId, send])

  // Request initial history
  useEffect(() => {
    if (!initialLoadDone.current) {
      initialLoadDone.current = true
      setLoading(true)
      send({ type: 'load_history', session_id: sessionId, limit: PAGE_SIZE })
    }
  }, [sessionId, send])

  // Handle incoming WS messages
  useEffect(() => {
    const unsub = onMessage((msg) => {
      if (msg.type === 'history' && msg.session_id === sessionId) {
        setLoading(false)
        if (msg.messages.length < PAGE_SIZE) {
          setHasMore(false)
        }
        // Prepend older messages, deduplicate by uuid
        setMessages((prev) => {
          const existing = new Set(prev.map((m) => m.uuid))
          const newMsgs = msg.messages.filter((m) => !existing.has(m.uuid))
          return [...newMsgs, ...prev]
        })
      }

      if (msg.type === 'jsonl_update' && msg.session_id === sessionId) {
        setMessages((prev) => {
          const existing = new Map(prev.map((m) => [m.uuid, m]))
          // Update existing or append new
          for (const entry of msg.messages) {
            existing.set(entry.uuid, entry)
          }
          return Array.from(existing.values()).sort(
            (a, b) =>
              new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          )
        })
      }
    })
    return unsub
  }, [onMessage, sessionId])

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

  const handleSend = useCallback(
    (content: string) => {
      send({ type: 'send_message', session_id: sessionId, content })
    },
    [send, sessionId]
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium truncate">
          Session {sessionId.slice(0, 8)}...
        </span>
      </div>
      <MessageList
        messages={messages}
        loading={loading}
        hasMore={hasMore}
        onLoadMore={handleLoadMore}
      />
      <ChatInput
        disabled={status !== 'connected'}
        onSend={handleSend}
      />
    </div>
  )
}
