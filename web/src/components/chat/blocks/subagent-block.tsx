import { Badge } from '@/components/ui/badge'
import { Loader2 } from 'lucide-react'

interface SubagentBlockProps {
  name: string
  input: Record<string, unknown>
  hasResult: boolean
}

export function SubagentBlock({ name, input, hasResult }: SubagentBlockProps) {
  const description =
    typeof input.description === 'string' ? input.description : undefined
  const prompt =
    typeof input.prompt === 'string' ? input.prompt : undefined

  return (
    <div className="rounded border border-border/50 bg-muted/20 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Badge variant="secondary">{name}</Badge>
        {hasResult ? (
          <span className="text-green-400 text-sm" aria-label="completed">
            &#x2705;
          </span>
        ) : (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        )}
      </div>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
      {prompt && (
        <p className="text-xs text-muted-foreground/70 line-clamp-3">
          {prompt}
        </p>
      )}
    </div>
  )
}
