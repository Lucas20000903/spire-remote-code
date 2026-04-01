import { useAuth } from '@/hooks/use-auth'
import { SetupForm } from '@/components/auth/setup-form'
import { LoginForm } from '@/components/auth/login-form'
import { Button } from '@/components/ui/button'

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

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      <h1 className="text-2xl font-bold">Authenticated!</h1>
      <p className="text-muted-foreground">You are signed in.</p>
      <Button variant="outline" onClick={logout}>
        Sign Out
      </Button>
    </div>
  )
}

export default App
