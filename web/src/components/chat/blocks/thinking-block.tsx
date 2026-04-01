import { Loader2 } from 'lucide-react'

interface ThinkingBlockProps {
  thinking: string
  durationMs?: number
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`
}

export function ThinkingBlock({ thinking: _thinking, durationMs }: ThinkingBlockProps) {
  const isComplete = durationMs != null

  return (
    <div className="py-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
      {isComplete ? (
        <>
          <span className="text-foreground font-medium">{formatDuration(durationMs)}</span>
          <span>동안 생각함</span>
        </>
      ) : (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
          <span>생각하는 중...</span>
        </>
      )}
    </div>
  )
}
