import { useEffect, useRef, useCallback, useMemo, type ReactNode } from 'react'
import type { TranscriptEntry, ContentBlock } from '@/lib/types'
import { buildToolResultMap, isToolResultOnlyEntry, isToolUseOnlyEntry } from '@/lib/types'
import { MessageItem } from './message-item'
import { ToolUseGroup } from './blocks/tool-use-group'
import { TypingIndicator } from './typing-indicator'
import { Loader2 } from 'lucide-react'

interface MessageListProps {
  messages: TranscriptEntry[]
  loading: boolean
  hasMore: boolean
  onLoadMore: () => void
  isWaiting?: boolean
}

type NodeKind = 'user' | 'assistant-text' | 'assistant-tool' | 'assistant-thinking'

/** 메시지의 시각적 유형 분류 */
function classifyEntry(e: TranscriptEntry): NodeKind {
  if (e.type === 'user') return 'user'
  if (!e.message || !Array.isArray(e.message.content)) return 'assistant-text'
  const content = e.message.content
  const hasText = content.some((b) => b.type === 'text')
  const hasToolUse = content.some((b) => b.type === 'tool_use')
  const hasThinkingOnly = content.every((b) => b.type === 'thinking')
  if (hasThinkingOnly) return 'assistant-thinking'
  if (hasToolUse && !hasText) return 'assistant-tool'
  return 'assistant-text'
}

/**
 * 메시지 간격 (mb 기반, Gestalt 근접성 원칙):
 * - user: 위 mt-2, 아래 mb-5 → 턴 경계를 아래 여백으로
 * - assistant-text: mb-3
 * - tool/thinking: mb-1 → 다음 assistant 응답과 가깝게
 * - tool 그룹: mb-1
 */
function spacingClass(kind: NodeKind, nextKind: NodeKind | null): string {
  switch (kind) {
    case 'user': return 'mt-2 mb-5'
    case 'assistant-text': return nextKind === 'user' ? 'mb-5' : 'mb-3'
    case 'assistant-tool': return 'mb-1'
    case 'assistant-thinking': return 'mb-1'
  }
}

/** 여러 메시지에서 tool_use 블록들을 추출 */
function extractTools(entries: TranscriptEntry[]): { id: string; name: string; input: Record<string, unknown> }[] {
  const tools: { id: string; name: string; input: Record<string, unknown> }[] = []
  for (const e of entries) {
    if (!e.message || !Array.isArray(e.message.content)) continue
    for (const b of e.message.content) {
      if (b.type === 'tool_use') {
        const t = b as Extract<ContentBlock, { type: 'tool_use' }>
        tools.push({ id: t.id, name: t.name, input: t.input as Record<string, unknown> })
      }
    }
  }
  return tools
}

export function MessageList({
  messages,
  loading,
  hasMore,
  onLoadMore,
  isWaiting,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const shouldAutoScroll = useRef(true)
  const toolResultMap = useMemo(() => buildToolResultMap(messages), [messages])

  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    shouldAutoScroll.current = distanceFromBottom < 100

    if (el.scrollTop < 50 && hasMore && !loading) {
      onLoadMore()
    }
  }, [hasMore, loading, onLoadMore])

  const isInitialLoad = useRef(true)

  useEffect(() => {
    if (messages.length === 0) return
    if (isInitialLoad.current) {
      isInitialLoad.current = false
      bottomRef.current?.scrollIntoView()
    } else if (shouldAutoScroll.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  // 필터 + 그룹화
  const filtered = useMemo(
    () => messages.filter((e) => !isToolResultOnlyEntry(e)),
    [messages],
  )

  const rendered = useMemo(() => {
    const nodes: ReactNode[] = []
    let i = 0
    while (i < filtered.length) {
      const entry = filtered[i]

      // 연속 tool_use 전용 assistant 메시지 그룹화
      if (isToolUseOnlyEntry(entry)) {
        const group: TranscriptEntry[] = []
        while (i < filtered.length && isToolUseOnlyEntry(filtered[i])) {
          group.push(filtered[i])
          i++
        }
        if (group.length >= 2) {
          const tools = extractTools(group)
          nodes.push(
            <div key={group[0].uuid} className={`group/entry flex items-start gap-1 ${spacingClass('assistant-tool', filtered[i] ? classifyEntry(filtered[i]) : null)}`}>
              <div className="max-w-full flex-1">
                <div className="space-y-1.5 text-sm text-foreground">
                  <ToolUseGroup tools={tools} toolResultMap={toolResultMap} isHistorical={i < filtered.length} />
                </div>
              </div>
              <input
                type="checkbox"
                onChange={(e) => {
                  if (e.target.checked) {
                    console.group(`🔧 ToolUseGroup (${tools.length} tools)`)
                    for (const t of tools) {
                      const res = toolResultMap?.get(t.id)
                      console.log(`${t.name}:${t.id}`, { input: t.input, hasResult: !!res, result: res })
                    }
                    console.groupEnd()
                  }
                }}
                className="opacity-0 group-hover/entry:opacity-100 transition-opacity cursor-pointer accent-foreground mt-1"
                title="콘솔에 그룹 원본 데이터 출력"
              />
            </div>
          )
          continue
        }
        // 1개면 일반 렌더링으로
        i -= group.length
      }

      // 일반 메시지
      const currKind = classifyEntry(entry)
      // 다음 메시지 유형 파악 (tool 그룹 건너뛰기 포함)
      let nextEntry = filtered[i + 1]
      if (nextEntry && isToolUseOnlyEntry(nextEntry)) {
        // tool 그룹 뒤의 실제 다음 메시지
        let j = i + 1
        while (j < filtered.length && isToolUseOnlyEntry(filtered[j])) j++
        nextEntry = filtered[j]
      }
      const nextKind = nextEntry ? classifyEntry(nextEntry) : null
      const spacing = spacingClass(currKind, nextKind)

      let nextTextTimestamp: string | undefined
      for (let j = i + 1; j < filtered.length; j++) {
        const m = filtered[j]
        if (m.type === 'assistant' && m.message) {
          const c = m.message.content
          if (Array.isArray(c) && c.some((b) => b.type === 'text')) {
            nextTextTimestamp = m.timestamp
            break
          }
        }
      }
      nodes.push(
        <div key={entry.uuid} className={spacing}>
          <MessageItem
            entry={entry}
            toolResultMap={toolResultMap}
            nextTimestamp={nextTextTimestamp}
            isHistorical={i < filtered.length - 1}
            prevEntry={i > 0 ? filtered[i - 1] : undefined}
          />
        </div>
      )
      i++
    }

    return nodes
  }, [filtered, toolResultMap])

  return (
    <div
      ref={containerRef}
      data-message-list
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-4 py-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div className="mx-auto max-w-4xl">
        {loading && (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {!hasMore && messages.length > 0 && (
          <div className="text-center text-xs text-muted-foreground pt-14 pb-4">
            Start of conversation
          </div>
        )}
        {rendered}
        <TypingIndicator isActive={!!isWaiting} />
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
