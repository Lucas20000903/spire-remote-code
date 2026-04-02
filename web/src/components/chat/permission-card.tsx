import { useState } from 'react'
import { Shield, Check, X } from 'lucide-react'

interface PermissionCardProps {
  requestId: string
  toolName: string
  description: string
  inputPreview: string
  onRespond: (requestId: string, behavior: 'allow' | 'deny') => void
}

export function PermissionCard({ requestId, toolName, description, inputPreview, onRespond }: PermissionCardProps) {
  const [responded, setResponded] = useState<'allow' | 'deny' | null>(null)

  const handle = (behavior: 'allow' | 'deny') => {
    setResponded(behavior)
    onRespond(requestId, behavior)
  }

  if (responded) {
    return (
      <div className="mx-3 my-2 rounded-lg border border-border/50 bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Shield className="h-3.5 w-3.5" />
          <span className="font-medium">{toolName}</span>
          <span>—</span>
          <span className={responded === 'allow' ? 'text-green-500' : 'text-red-400'}>
            {responded === 'allow' ? 'Allowed' : 'Denied'}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-3 my-2 rounded-xl border border-border bg-background shadow-sm">
      <div className="flex items-center gap-2 border-b border-border/50 px-4 py-2.5">
        <Shield className="h-4 w-4 text-amber-500" />
        <span className="text-sm font-medium">Permission Request</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{toolName}</span>
      </div>
      <div className="px-4 py-3">
        <p className="text-sm">{description}</p>
        {inputPreview && (
          <pre className="mt-2 max-h-24 overflow-auto rounded-lg bg-muted/50 p-2.5 text-xs text-muted-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {inputPreview}
          </pre>
        )}
      </div>
      <div className="flex gap-2 border-t border-border/50 px-4 py-2.5">
        <button
          onClick={() => handle('allow')}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white active:bg-green-700"
        >
          <Check className="h-3.5 w-3.5" />
          Allow
        </button>
        <button
          onClick={() => handle('deny')}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-muted px-3 py-2 text-sm font-medium text-foreground active:bg-muted/80"
        >
          <X className="h-3.5 w-3.5" />
          Deny
        </button>
      </div>
    </div>
  )
}
