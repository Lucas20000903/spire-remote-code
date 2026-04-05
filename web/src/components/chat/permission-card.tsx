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
      <div className="mx-3 my-2 rounded-lg border border-border/50 bg-muted/80 px-4 py-3">
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
    <div className="mx-3 my-2 rounded-lg border border-border/50 bg-muted/80 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        <Shield className="h-3.5 w-3.5 text-amber-500" />
        <span className="text-xs font-medium">Permission</span>
        <span className="rounded bg-muted/50 px-1.5 py-0.5 text-[11px] text-muted-foreground">{toolName}</span>
      </div>
      <div className="px-3 pb-2">
        <p className="text-xs text-foreground/90">{description}</p>
        {inputPreview && (
          <pre className="mt-1.5 max-h-20 overflow-auto rounded bg-background/50 p-2 text-[11px] text-muted-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {inputPreview}
          </pre>
        )}
      </div>
      <div className="flex gap-2 border-t border-border/30 px-3 py-2">
        <button
          onClick={() => handle('allow')}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white active:bg-green-700"
        >
          <Check className="h-3 w-3" />
          Allow
        </button>
        <button
          onClick={() => handle('deny')}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-muted/50 px-3 py-1.5 text-xs font-medium text-foreground active:bg-muted/80"
        >
          <X className="h-3 w-3" />
          Deny
        </button>
      </div>
    </div>
  )
}
