import { useAuth } from '@/hooks/use-auth'
import { WsProvider } from '@/hooks/use-websocket'
import { SetupForm } from '@/components/auth/setup-form'
import { LoginForm } from '@/components/auth/login-form'
import { ConnectionBanner } from '@/components/layout/connection-banner'
import { SessionList } from '@/components/session/session-list'
import { Button } from '@/components/ui/button'

function AuthenticatedApp({ logout }: { logout: () => void }) {
  return (
    <WsProvider>
      <div className="flex min-h-screen flex-col">
        <ConnectionBanner />
        <header className="flex items-center justify-between border-b px-4 py-2">
          <h1 className="text-lg font-semibold">Spire</h1>
          <Button variant="ghost" size="sm" onClick={logout}>
            Sign Out
          </Button>
        </header>
        <main className="flex-1">
          <SessionList
            onSelectSession={(id) => {
              // TODO: navigate to chat view (Task 11)
              console.log('select session', id)
            }}
          />
        </main>
      </div>
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
