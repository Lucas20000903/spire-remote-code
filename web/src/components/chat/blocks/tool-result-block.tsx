import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

interface ToolResultBlockProps {
  toolUseId: string
  content?: unknown
  isError?: boolean
}

function formatContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (content == null) return ''
  return JSON.stringify(content, null, 2)
}

export function ToolResultBlock({
  toolUseId: _toolUseId,
  content,
  isError,
}: ToolResultBlockProps) {
  const [open, setOpen] = useState(false)
  const text = formatContent(content)
  const lines = text.split('\n')
  const preview = lines.slice(0, 3).join('\n')
  const hasMore = lines.length > 3

  return (
    <div
      className={cn(
        'rounded border p-2 text-xs',
        isError
          ? 'border-destructive/50 bg-destructive/10'
          : 'border-border/30 bg-muted/10'
      )}
    >
      {hasMore ? (
        <Collapsible open={open} onOpenChange={setOpen}>
          <div>
            <pre className="whitespace-pre-wrap break-all text-muted-foreground">
              {preview}
            </pre>
            <CollapsibleTrigger className="mt-1 flex items-center gap-1 text-xs text-muted-foreground/70 hover:text-foreground transition-colors">
              <ChevronRight
                className={cn(
                  'h-3 w-3 transition-transform',
                  open && 'rotate-90'
                )}
              />
              <span>{open ? 'Collapse' : `${lines.length - 3} more lines...`}</span>
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent>
            <pre className="mt-1 whitespace-pre-wrap break-all text-muted-foreground">
              {lines.slice(3).join('\n')}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      ) : (
        <pre className="whitespace-pre-wrap break-all text-muted-foreground">
          {text || '(no output)'}
        </pre>
      )}
    </div>
  )
}
