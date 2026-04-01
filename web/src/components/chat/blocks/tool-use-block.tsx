import { useState } from 'react'
import { ChevronRight, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SubagentBlock } from './subagent-block'

interface ToolUseBlockProps {
  id: string
  name: string
  input: Record<string, unknown>
  hasResult: boolean
  result?: { content?: unknown; is_error?: boolean; interrupted?: boolean }
  isHistorical?: boolean
}

/** 접힌 상태의 한 줄 요약 */
function collapsedSummary(name: string, input: Record<string, unknown>, hasResult: boolean, interrupted?: boolean): string {
  if (interrupted) {
    switch (name) {
      case 'Read': return '파일 읽기 중단됨'
      case 'Write': return '파일 작성 중단됨'
      case 'Edit': return '파일 수정 중단됨'
      case 'Bash': {
        const desc = typeof input.description === 'string' ? input.description : ''
        return desc ? `${desc} — 중단됨` : '명령 실행 중단됨'
      }
      case 'Grep': return '검색 중단됨'
      case 'Glob': return '파일 검색 중단됨'
      default: return `${name} 중단됨`
    }
  }
  if (!hasResult) {
    switch (name) {
      case 'Read': return '파일 읽는 중...'
      case 'Write': return '파일 작성 중...'
      case 'Edit': return '파일 수정 중...'
      case 'Bash': return '명령 실행 중...'
      case 'Grep': return '검색 중...'
      case 'Glob': return '파일 검색 중...'
      default: return `${name} 실행 중...`
    }
  }
  switch (name) {
    case 'Read': return '파일 읽음'
    case 'Write': return '파일 생성됨'
    case 'Edit': return '파일 수정됨'
    case 'Bash': {
      const desc = typeof input.description === 'string' ? input.description : ''
      return desc || '명령 실행됨'
    }
    case 'Grep': return '검색 완료'
    case 'Glob': return '파일 검색 완료'
    default: return `${name} 완료`
  }
}

/** 펼친 상태에서 보여줄 주요 입력값 */
function primaryInput(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit':
      return typeof input.file_path === 'string' ? input.file_path : ''
    case 'Bash':
      return typeof input.command === 'string' ? input.command : ''
    case 'Grep':
      return typeof input.pattern === 'string' ? input.pattern : ''
    case 'Glob':
      return typeof input.pattern === 'string' ? input.pattern : ''
    default:
      return ''
  }
}

/** 결과 요약 (숫자 강조 + 설명) */
function resultSummary(
  name: string,
  result?: { content?: unknown; is_error?: boolean },
): { num: string; label: string } | null {
  if (!result) return null
  if (result.is_error) return { num: '!', label: '에러 발생' }

  const text = typeof result.content === 'string'
    ? result.content
    : result.content != null
      ? JSON.stringify(result.content)
      : ''

  switch (name) {
    case 'Read': {
      const lines = text.split('\n').length
      return { num: String(lines), label: '줄 읽음' }
    }
    case 'Grep': {
      const matches = text.split('\n').filter(Boolean).length
      return { num: String(matches), label: '개 매치' }
    }
    case 'Glob': {
      const files = text.split('\n').filter(Boolean).length
      return { num: String(files), label: '개 파일' }
    }
    case 'Bash': {
      if (!text) return { num: '0', label: '출력 없음' }
      const lines = text.split('\n').length
      return { num: String(lines), label: '줄 출력' }
    }
    default:
      return null
  }
}

export function ToolUseBlock({
  id: _id,
  name,
  input,
  hasResult,
  result,
  isHistorical,
}: ToolUseBlockProps) {
  const [open, setOpen] = useState(false)

  if (name === 'Agent' || name === 'Task') {
    return <SubagentBlock name={name} input={input} hasResult={hasResult} />
  }

  const effectiveHasResult = hasResult || !!isHistorical
  const summary = collapsedSummary(name, input, effectiveHasResult, result?.interrupted)
  const inputText = primaryInput(name, input)
  const resSummary = result?.interrupted ? null : resultSummary(name, result)

  return (
    <div className="py-1">
      {/* 접힌 상태 토글 */}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        {!effectiveHasResult ? (
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

      {/* 펼친 상태 */}
      {open && (
        <div className="ml-5 mt-1.5 flex items-start gap-3 font-sans">
          <span className="shrink-0 text-xs font-medium text-foreground">{name}</span>
          <div className="min-w-0 flex-1 space-y-1">
            {inputText && (
              <div className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5">
                <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-all">
                  {inputText}
                </pre>
              </div>
            )}
            {resSummary && (
              <div className="text-xs">
                <span className="font-medium text-foreground">{resSummary.num}</span>
                <span className="text-muted-foreground ml-0.5">{resSummary.label}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
