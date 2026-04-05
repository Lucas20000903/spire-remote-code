import { useState } from 'react'
import { ChevronRight, Check, Loader2, FileText, Pencil, Terminal, Search, FolderOpen } from 'lucide-react'
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

function toolBadgeColor(name: string) {
  switch (name) {
    case 'Edit': return 'bg-amber-500/10 text-amber-400'
    case 'Bash': return 'bg-violet-500/10 text-violet-400'
    case 'Read': return 'bg-blue-500/10 text-blue-400'
    case 'Write': return 'bg-emerald-500/10 text-emerald-400'
    case 'Grep': return 'bg-cyan-500/10 text-cyan-400'
    case 'Glob': return 'bg-pink-500/10 text-pink-400'
    default: return 'bg-muted/30 text-muted-foreground'
  }
}

function ToolBadgeIcon({ name }: { name: string }) {
  const cls = 'h-3 w-3'
  switch (name) {
    case 'Read': case 'Write': return <FileText className={cls} />
    case 'Edit': return <Pencil className={cls} />
    case 'Bash': return <Terminal className={cls} />
    case 'Grep': return <Search className={cls} />
    case 'Glob': return <FolderOpen className={cls} />
    default: return <FileText className={cls} />
  }
}

export function ToolUseGroup({ tools, toolResultMap, isHistorical }: ToolUseGroupProps) {
  const [open, setOpen] = useState(false)

  const allComplete = isHistorical || tools.every((t) => toolResultMap?.has(t.id))

  return (
    <div className="rounded-lg border border-border/50 bg-muted/10 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/20 cursor-pointer"
      >
        <ChevronRight className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <span className="text-muted-foreground">{tools.length} tool calls</span>
        <div className="flex items-center gap-1">
          {tools.map((t) => (
            <span key={t.id} className={cn('rounded px-1.5 py-0.5 font-mono text-[10px]', toolBadgeColor(t.name))}>
              <ToolBadgeIcon name={t.name} />
            </span>
          ))}
        </div>
        <span className="ml-auto shrink-0">
          {allComplete
            ? <Check className="h-3.5 w-3.5 text-emerald-500" />
            : <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
          }
        </span>
      </button>
      {open && (
        <div className="border-t border-border/30 p-2 space-y-1.5">
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
                isHistorical={isHistorical}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
