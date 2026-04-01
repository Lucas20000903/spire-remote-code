import { useState } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { WsProvider } from '@/hooks/use-websocket'
import { SetupForm } from '@/components/auth/setup-form'
import { LoginForm } from '@/components/auth/login-form'
import { ConnectionBanner } from '@/components/layout/connection-banner'
import { SessionList } from '@/components/session/session-list'
import { ChatView } from '@/components/chat/chat-view'
import { Button } from '@/components/ui/button'
import { PermissionDialog } from '@/components/permission/permission-dialog'

function AuthenticatedApp({ logout }: { logout: () => void }) {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)

  return (
    <WsProvider>
      <div className="flex h-screen flex-col">
        <ConnectionBanner />
        {selectedSessionId ? (
          <main className="flex-1 overflow-hidden">
            <ChatView
              sessionId={selectedSessionId}
              onBack={() => setSelectedSessionId(null)}
            />
          </main>
        ) : (
          <>
            <header className="flex items-center justify-between border-b px-4 py-2">
              <h1 className="text-lg font-semibold">Spire</h1>
              <Button variant="ghost" size="sm" onClick={logout}>
                Sign Out
              </Button>
            </header>
            <main className="flex-1 overflow-auto">
              <SessionList
                onSelectSession={(id) => setSelectedSessionId(id)}
              />
            </main>
          </>
        )}
      </div>
      <PermissionDialog />
    </WsProvider>
  )
}

function App() {
  const { state, onAuthenticated, logout } = useAuth()

  if (state === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }

  if (state === 'setup') {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <SetupForm onAuthenticated={onAuthenticated} />
      </div>
    )
  }

  if (state === 'login') {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <LoginForm onAuthenticated={onAuthenticated} />
      </div>
    )
  }

  return <AuthenticatedApp logout={logout} />
}

export default App
