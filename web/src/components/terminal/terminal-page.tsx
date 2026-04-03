import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { TerminalView } from './terminal-view'

export function TerminalPage() {
  const { sessionName } = useParams<{ sessionName: string }>()
  const navigate = useNavigate()

  if (!sessionName) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Session not specified</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <button
          onClick={() => navigate(-1)}
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-zinc-800"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="font-mono text-sm text-zinc-400">{sessionName}</span>
      </div>
      <div className="flex-1">
        <TerminalView session={sessionName} />
      </div>
    </div>
  )
}
