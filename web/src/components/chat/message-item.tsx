import { useCallback, type ReactNode } from 'react'
import type { TranscriptEntry, ContentBlock, ToolResultMap } from '@/lib/types'
import { isInternalContent, extractChannelContent, extractCommandInfo, extractStdout } from '@/lib/types'
import { debugSelection } from '@/lib/debug-selection'
import { TextBlock } from './blocks/text-block'
import { ThinkingBlock } from './blocks/thinking-block'
import { ToolUseBlock } from './blocks/tool-use-block'
import { ToolUseGroup } from './blocks/tool-use-group'
import { ImageBlock } from './blocks/image-block'

interface MessageItemProps {
  entry: TranscriptEntry
  toolResultMap?: ToolResultMap
  nextTimestamp?: string
  isHistorical?: boolean
  prevEntry?: TranscriptEntry
}

/** 연속 tool_use를 그룹화하여 렌더링 */
function renderBlocks(
  blocks: ContentBlock[],
  toolResultMap?: ToolResultMap,
  thinkingDurationMs?: number,
  isHistorical?: boolean,
): ReactNode[] {
  const result: ReactNode[] = []
  let i = 0

  while (i < blocks.length) {
    const block = blocks[i]

    if (block.type === 'tool_use') {
      // 연속된 tool_use 수집
      const group: { id: string; name: string; input: Record<string, unknown> }[] = []
      while (i < blocks.length && blocks[i].type === 'tool_use') {
        const t = blocks[i] as Extract<ContentBlock, { type: 'tool_use' }>
        group.push({ id: t.id, name: t.name, input: t.input })
        i++
      }
      if (group.length === 1) {
        const t = group[0]
        const res = toolResultMap?.get(t.id)
        result.push(
          <ToolUseBlock
            key={t.id}
            id={t.id}
            name={t.name}
            input={t.input}
            hasResult={!!res}
            result={res}
            isHistorical={isHistorical}
          />
        )
      } else {
        result.push(
          <ToolUseGroup
            key={group[0].id}
            tools={group}
            toolResultMap={toolResultMap}
            isHistorical={isHistorical}
          />
        )
      }
      continue
    }

    switch (block.type) {
      case 'text':
        result.push(<TextBlock key={i} text={block.text} />)
        break
      case 'thinking':
        result.push(<ThinkingBlock key={i} thinking={block.thinking} durationMs={thinkingDurationMs} />)
        break
      case 'image':
        result.push(<ImageBlock key={i} source={block.source} />)
        break
      case 'tool_result':
        break
    }
    i++
  }

  return result
}

/** 실제 사용자 입력인지 판별 */
function isActualUserMessage(entry: TranscriptEntry): boolean {
  if (entry.type !== 'user') return false
  if (!entry.message) return false
  const { content } = entry.message
  if (typeof content === 'string') return true
  if (Array.isArray(content)) {
    const hasOnlyToolResults = content.every((b) => b.type === 'tool_result')
    if (hasOnlyToolResults) return false
    return content.some((b) => b.type === 'text')
  }
  return true
}

/** thinking 블록만 있는 메시지인지 */
function isThinkingOnly(entry: TranscriptEntry): boolean {
  if (!entry.message) return false
  const { content } = entry.message
  if (!Array.isArray(content)) return false
  return content.every((b) => b.type === 'thinking')
}

/** [Request interrupted] 메시지인지 */
function isInterruptMessage(entry: TranscriptEntry): boolean {
  if (entry.type !== 'user' || !entry.message) return false
  const { content } = entry.message
  if (typeof content === 'string') return content.includes('[Request interrupted')
  if (Array.isArray(content)) {
    return content.some((b) => b.type === 'text' && (b as any).text?.includes('[Request interrupted'))
  }
  return false
}

/** 이전 assistant 메시지에서 중단된 작업 설명 추출 */
function interruptedDescription(prev?: TranscriptEntry): string {
  if (!prev?.message || !Array.isArray(prev.message.content)) return '작업 중단됨'
  const content = prev.message.content
  // 마지막 tool_use 찾기
  for (let i = content.length - 1; i >= 0; i--) {
    const b = content[i]
    if (b.type === 'tool_use') {
      const t = b as Extract<ContentBlock, { type: 'tool_use' }>
      const desc = typeof t.input?.description === 'string' ? t.input.description : ''
      return desc || `${t.name} 중단됨`
    }
  }
  // text가 있으면 응답 중단
  if (content.some((b) => b.type === 'text')) return '응답 중단됨'
  if (content.some((b) => b.type === 'thinking')) return '생각 중단됨'
  return '작업 중단됨'
}

export function MessageItem({ entry, toolResultMap, nextTimestamp, isHistorical, prevEntry }: MessageItemProps) {
  if (!entry.message) return null
  const { content } = entry.message

  if (typeof content === 'string' && isInternalContent(content)) return null

  // 특수 메시지 처리
  let displayContent = content
  if (typeof content === 'string') {
    // channel 메시지 → 실제 텍스트 추출
    const channelText = extractChannelContent(content)
    if (channelText !== null) {
      displayContent = channelText
    }

    // CLI 명령 메시지 → 컴팩트 블록
    const cmdInfo = extractCommandInfo(content)
    if (cmdInfo) {
      return (
        <div className="py-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <span className="font-mono text-foreground/70">{cmdInfo.name}</span>
          {cmdInfo.stdout && (
            <span className="truncate">→ {cmdInfo.stdout}</span>
          )}
        </div>
      )
    }

    // stdout만 있는 메시지 → 컴팩트 블록
    const stdout = extractStdout(content)
    if (stdout !== null) {
      return (
        <div className="py-1 text-[13px] text-muted-foreground">
          <span className="truncate">{stdout}</span>
        </div>
      )
    }
  }

  // 인터럽트 메시지 → 컴팩트 블록으로 표시
  if (isInterruptMessage(entry)) {
    const desc = interruptedDescription(prevEntry)
    return (
      <div className="py-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <span className="text-destructive">⊘</span>
        <span>{desc}</span>
      </div>
    )
  }

  const isUser = isActualUserMessage(entry)

  let thinkingDurationMs: number | undefined
  if (isThinkingOnly(entry) && nextTimestamp) {
    const start = new Date(entry.timestamp).getTime()
    const end = new Date(nextTimestamp).getTime()
    if (end > start) thinkingDurationMs = end - start
  }

  const handleDebugToggle = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    debugSelection.toggle(entry, e.target.checked)
  }, [entry])

  const blocks = typeof displayContent === 'string' ? (
    <TextBlock text={displayContent} />
  ) : (
    renderBlocks(displayContent, toolResultMap, thinkingDurationMs, isHistorical)
  )

  const checkbox = (
    <input
      type="checkbox"
      onChange={handleDebugToggle}
      className="opacity-0 group-hover/entry:opacity-100 transition-opacity cursor-pointer accent-foreground"
      title="콘솔에 원본 데이터 출력"
    />
  )

  if (isUser) {
    return (
      <div className="group/entry flex items-center justify-end gap-1">
        <div className="max-w-[85%] overflow-hidden rounded-2xl bg-secondary px-4 py-2.5 text-secondary-foreground break-words">
          <div className="space-y-2 text-sm">{blocks}</div>
        </div>
        {checkbox}
      </div>
    )
  }

  return (
    <div className="group/entry flex items-start gap-1">
      <div className="max-w-full flex-1">
        <div className="space-y-2 text-sm text-foreground">{blocks}</div>
      </div>
      {checkbox}
    </div>
  )
}
