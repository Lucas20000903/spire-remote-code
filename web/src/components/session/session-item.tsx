import type { SessionInfo } from '@/lib/types'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

function extractProjectName(cwd: string): string {
  const parts = cwd.split('/')
  return parts[parts.length - 1] || cwd
}

interface SessionItemProps {
  session: SessionInfo
  onClick?: () => void
}

export function SessionItem({ session, onClick }: SessionItemProps) {
  return (
    <Card
      className="cursor-pointer transition-colors hover:bg-accent"
      onClick={onClick}
    >
      <CardHeader className="p-4">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
          </span>
          <CardTitle className="text-base">
            {extractProjectName(session.cwd)}
          </CardTitle>
        </div>
        <CardDescription className="truncate text-xs">
          {session.cwd}
        </CardDescription>
      </CardHeader>
    </Card>
  )
}
