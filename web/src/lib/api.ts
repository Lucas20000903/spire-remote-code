const BASE = ''  // same origin

function getToken(): string | null {
  return localStorage.getItem('token')
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) h['Authorization'] = `Bearer ${token}`
  return h
}

export async function checkAuthStatus(): Promise<{ initialized: boolean }> {
  const res = await fetch(`${BASE}/api/auth/status`)
  return res.json()
}

export async function setup(username: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/setup`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ username, password }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error)
  localStorage.setItem('token', data.token)
  return data.token
}

export async function login(username: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ username, password }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error)
  localStorage.setItem('token', data.token)
  return data.token
}

export async function fetchProjects() {
  const res = await fetch(`${BASE}/api/projects`, { headers: headers() })
  return res.json()
}

export async function fetchFavorites(): Promise<string[]> {
  const res = await fetch(`${BASE}/api/favorites`, { headers: headers() })
  const data = await res.json()
  return data.favorites || []
}

export async function addFavorite(cwd: string) {
  await fetch(`${BASE}/api/favorites`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ cwd }),
  })
}

export async function removeFavorite(cwd: string) {
  await fetch(`${BASE}/api/favorites/${encodeURIComponent(cwd)}`, {
    method: 'DELETE', headers: headers(),
  })
}
