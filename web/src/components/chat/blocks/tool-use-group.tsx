import { useState } from 'react'
import { ChevronRight, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ToolResultMap } from '@/lib/types'
import { ToolUseBlock } from './tool-use-block'

interface ToolInfo {
  id: string
  name: string
  input: Record<string, unknown>
}

interface ToolUseGroupProps {
  tools: ToolInfo[]
  toolResultMap?: ToolResultMap
  isHistorical?: boolean
}

function groupSummary(tools: ToolInfo[], allComplete: boolean): string {
  if (!allComplete) {
    // 마지막 (= 현재 실행 중인) 도구의 설명
    const last = tools[tools.length - 1]
    return toolDescription(last.name, last.input)
  }
  return `${tools.length}개 도구 사용됨`
}

function toolDescription(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Read': return '파일 읽는 중...'
    case 'Write': return '파일 작성 중...'
    case 'Edit': return '파일 수정 중...'
    case 'Bash': {
      const desc = typeof input.description === 'string' ? input.description : ''
      return desc || '명령 실행 중...'
    }
    case 'Grep': return '검색 중...'
    case 'Glob': return '파일 검색 중...'
    default: return `${name} 실행 중...`
  }
}

export function ToolUseGroup({ tools, toolResultMap, isHistorical }: ToolUseGroupProps) {
  const [open, setOpen] = useState(false)

  // tool_result가 페이지 경계에서 누락될 수 있으므로, 뒤에 메시지가 있으면 완료 처리
  const allComplete = isHistorical || tools.every((t) => toolResultMap?.has(t.id))
  const summary = groupSummary(tools, allComplete)

  return (
    <div className="py-1">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        {!allComplete ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
        ) : (
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 shrink-0 transition-transform duration-200',
              open && 'rotate-90'
            )}
          />
        )}
        <span className="truncate">{summary}</span>
      </button>

      {open && (
        <div className="ml-5 mt-1 space-y-0.5">
          {tools.map((t) => {
            const result = toolResultMap?.get(t.id)
            return (
              <ToolUseBlock
                key={t.id}
                id={t.id}
                name={t.name}
                input={t.input}
                hasResult={!!result}
                result={result}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
