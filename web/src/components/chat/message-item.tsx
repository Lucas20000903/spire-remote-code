import type { TranscriptEntry, ContentBlock } from '@/lib/types'
import { TextBlock } from './blocks/text-block'
import { ThinkingBlock } from './blocks/thinking-block'
import { ToolUseBlock } from './blocks/tool-use-block'
import { ToolResultBlock } from './blocks/tool-result-block'
import { ImageBlock } from './blocks/image-block'

interface MessageItemProps {
  entry: TranscriptEntry
}

/** Collect tool_use IDs that have a matching tool_result in the same content array */
function collectResolvedToolUseIds(content: ContentBlock[]): Set<string> {
  const ids = new Set<string>()
  for (const block of content) {
    if (block.type === 'tool_result') {
      ids.add(block.tool_use_id)
    }
  }
  return ids
}

function renderBlock(
  block: ContentBlock,
  index: number,
  resolvedIds: Set<string>
) {
  switch (block.type) {
    case 'text':
      return <TextBlock key={index} text={block.text} />
    case 'thinking':
      return <ThinkingBlock key={index} thinking={block.thinking} />
    case 'tool_use':
      return (
        <ToolUseBlock
          key={index}
          id={block.id}
          name={block.name}
          input={block.input}
          hasResult={resolvedIds.has(block.id)}
        />
      )
    case 'tool_result':
      return (
        <ToolResultBlock
          key={index}
          toolUseId={block.tool_use_id}
          content={block.content}
          isError={block.is_error}
        />
      )
    case 'image':
      return <ImageBlock key={index} source={block.source} />
    default:
      return null
  }
}

function formatTime(timestamp: string): string {
  try {
    const d = new Date(timestamp)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export function MessageItem({ entry }: MessageItemProps) {
  const isUser = entry.type === 'user'
  const { content } = entry.message

  return (
    <div className={`flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium">{isUser ? 'You' : 'Claude'}</span>
        <span>{formatTime(entry.timestamp)}</span>
      </div>
      <div
        className={`max-w-[85%] space-y-2 rounded-lg px-3 py-2 ${
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted/50'
        }`}
      >
        {typeof content === 'string' ? (
          <TextBlock text={content} />
        ) : (
          (() => {
            const resolvedIds = collectResolvedToolUseIds(content)
            return content.map((block, i) => renderBlock(block, i, resolvedIds))
          })()
        )}
      </div>
    </div>
  )
}
