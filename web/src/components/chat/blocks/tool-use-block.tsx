import { Badge } from '@/components/ui/badge'
import { SubagentBlock } from './subagent-block'

interface ToolUseBlockProps {
  id: string
  name: string
  input: Record<string, unknown>
  hasResult: boolean
}

function summarizeInput(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Bash':
      return typeof input.command === 'string' ? input.command : ''
    case 'Edit':
    case 'Read':
    case 'Write':
      return typeof input.file_path === 'string' ? input.file_path : ''
    case 'Grep':
      return typeof input.pattern === 'string' ? input.pattern : ''
    case 'Glob':
      return typeof input.pattern === 'string' ? input.pattern : ''
    default: {
      const json = JSON.stringify(input)
      return json.length > 120 ? json.slice(0, 120) + '...' : json
    }
  }
}

export function ToolUseBlock({ id: _id, name, input, hasResult }: ToolUseBlockProps) {
  if (name === 'Agent' || name === 'Task') {
    return <SubagentBlock name={name} input={input} hasResult={hasResult} />
  }

  const summary = summarizeInput(name, input)

  return (
    <div className="rounded border border-border/50 bg-muted/20 p-2 space-y-1">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs font-mono">
          {name}
        </Badge>
      </div>
      {summary && (
        <pre className="text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all">
          {summary}
        </pre>
      )}
    </div>
  )
}
