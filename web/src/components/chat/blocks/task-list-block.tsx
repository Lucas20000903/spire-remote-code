import { useState, useMemo } from 'react'
import { ChevronRight, CheckCircle2, Circle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TaskItem } from '@/lib/types'

interface TaskListBlockProps {
  tasks: TaskItem[]
}

function StatusIcon({ status }: { status: TaskItem['status'] }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
    case 'in_progress':
      return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-400" />
    default:
      return <Circle className="h-4 w-4 shrink-0 text-zinc-500" />
  }
}

export function TaskListBlock({ tasks }: TaskListBlockProps) {
  const [open, setOpen] = useState(false)

  const { completed, total } = useMemo(() => {
    const completed = tasks.filter((t) => t.status === 'completed').length
    return { completed, total: tasks.length }
  }, [tasks])

  if (total === 0) return null

  const progressPercent = Math.round((completed / total) * 100)

  return (
    <div className="rounded-lg border border-border/50 bg-muted/80 overflow-hidden">
      {/* 헤더 (토글) */}
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/30 cursor-pointer"
      >
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200',
            open && 'rotate-90',
          )}
        />
        <span className="text-xs font-medium text-foreground">
          {completed}/{total} tasks completed
        </span>
        {/* 진행률 바 */}
        <div className="ml-auto flex items-center gap-2">
          <div className="h-1.5 w-16 rounded-full bg-zinc-700/50 overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-300',
                progressPercent === 100 ? 'bg-emerald-500' : 'bg-blue-400',
              )}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {progressPercent}%
          </span>
        </div>
      </button>

      {/* 체크리스트 */}
      {open && (
        <div className="border-t border-border/30 px-3 py-1.5">
          <ul className="space-y-0.5">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-start gap-2 py-1">
                <StatusIcon status={task.status} />
                <span
                  className={cn(
                    'text-sm leading-5',
                    task.status === 'completed'
                      ? 'text-muted-foreground line-through decoration-muted-foreground/40'
                      : 'text-foreground',
                  )}
                >
                  {task.subject}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
