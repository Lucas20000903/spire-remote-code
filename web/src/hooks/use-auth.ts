import { useState, useEffect } from 'react'
import { checkAuthStatus } from '@/lib/api'

type AuthState = 'loading' | 'setup' | 'login' | 'authenticated'

export function useAuth() {
  const [state, setState] = useState<AuthState>('loading')

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (token) {
      setState('authenticated')
      return
    }
    checkAuthStatus().then(({ initialized }) => {
      setState(initialized ? 'login' : 'setup')
    }).catch(() => setState('login'))
  }, [])

  const onAuthenticated = () => setState('authenticated')
  const logout = () => { localStorage.removeItem('token'); setState('login') }

  return { state, onAuthenticated, logout }
}
