import { useSessions } from '@/hooks/use-sessions'
import { SessionItem } from './session-item'
import { NewSession } from './new-session'

interface SessionListProps {
  onSelectSession?: (sessionId: string) => void
}

export function SessionList({ onSelectSession }: SessionListProps) {
  const { active, recent, createSession } = useSessions()

  return (
    <div className="mx-auto w-full max-w-md space-y-6 p-4">
      <div>
        <h2 className="mb-3 text-lg font-semibold">Active Sessions</h2>
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active sessions.
          </p>
        ) : (
          <div className="space-y-2">
            {active.map((s) => (
              <SessionItem
                key={s.bridge_id}
                session={s}
                onClick={() => s.id && onSelectSession?.(s.id)}
              />
            ))}
          </div>
        )}
      </div>

      {recent.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold text-muted-foreground">
            Recent Sessions
          </h2>
          <div className="space-y-2">
            {recent.map((s) => (
              <SessionItem
                key={s.bridge_id}
                session={s}
                onClick={() => s.id && onSelectSession?.(s.id)}
              />
            ))}
          </div>
        </div>
      )}

      <NewSession onSelect={createSession} />
    </div>
  )
}
