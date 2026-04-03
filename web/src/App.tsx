import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/use-auth'
import { WsProvider } from '@/hooks/use-websocket'
import { SessionsProvider } from '@/hooks/use-sessions'
import { SetupForm } from '@/components/auth/setup-form'
import { LoginForm } from '@/components/auth/login-form'
import { AppLayout } from '@/components/layout/app-layout'
import { ChatView } from '@/components/chat/chat-view'
import { ChatIntro } from '@/components/chat/chat-intro'
// TerminalPage는 이제 ChatView 내부에서 viewMode로 전환

function AuthenticatedApp() {
  return (
    <WsProvider>
      <SessionsProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/chat/intro" element={<ChatIntro />} />
          <Route path="/chat/:bridgeId" element={<ChatView />} />
          <Route path="*" element={<Navigate to="/chat/intro" replace />} />
        </Route>
      </Routes>
      </SessionsProvider>
    </WsProvider>
  )
}

function App() {
  const { state, onAuthenticated } = useAuth()

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

  return <AuthenticatedApp />
}

export default App
