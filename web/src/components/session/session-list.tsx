import { useNavigate } from 'react-router-dom'
import { useSessions } from '@/hooks/use-sessions'
import { SessionItem } from './session-item'
import { NewSession } from './new-session'

export function SessionList() {
  const { active, recent, createSession } = useSessions()
  const navigate = useNavigate()

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
                onClick={() => navigate(`/chat/${s.bridge_id}`)}
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
                onClick={() => navigate(`/chat/${s.bridge_id}`)}
              />
            ))}
          </div>
        </div>
      )}

      <NewSession onSelect={createSession} />
    </div>
  )
}
