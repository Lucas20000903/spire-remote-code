import { useEffect, useRef, useCallback } from 'react'
import type { TranscriptEntry } from '@/lib/types'
import { MessageItem } from './message-item'
import { Loader2 } from 'lucide-react'

interface MessageListProps {
  messages: TranscriptEntry[]
  loading: boolean
  hasMore: boolean
  onLoadMore: () => void
}

export function MessageList({
  messages,
  loading,
  hasMore,
  onLoadMore,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const shouldAutoScroll = useRef(true)

  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return

    // Auto-scroll if user is near the bottom (within 100px)
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    shouldAutoScroll.current = distanceFromBottom < 100

    // Load more when scrolled to top
    if (el.scrollTop < 50 && hasMore && !loading) {
      onLoadMore()
    }
  }, [hasMore, loading, onLoadMore])

  // Scroll to bottom on new messages if auto-scroll is active
  useEffect(() => {
    if (shouldAutoScroll.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  // Initial scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView()
  }, [])

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-4 py-4"
    >
      {loading && (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
      {!hasMore && messages.length > 0 && (
        <div className="text-center text-xs text-muted-foreground py-2">
          Start of conversation
        </div>
      )}
      <div className="space-y-4">
        {messages.map((entry) => (
          <MessageItem key={entry.uuid} entry={entry} />
        ))}
      </div>
      <div ref={bottomRef} />
    </div>
  )
}
