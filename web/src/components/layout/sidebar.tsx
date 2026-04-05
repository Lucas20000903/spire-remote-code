import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { useSessions } from '@/hooks/use-sessions'
import { useWebSocket } from '@/hooks/use-websocket'
import { fetchFavorites } from '@/lib/api'
import { Plus, Star, Loader2, Settings, LogOut, Bot, TerminalSquare, X } from 'lucide-react'
import { SettingsDialog } from '@/components/settings/settings-dialog'
import type { SessionInfo, SessionStatus } from '@/lib/types'

function extractProjectName(cwd: string): string {
  const parts = cwd.split('/')
  return parts[parts.length - 1] || cwd
}

function groupByCwd(sessions: SessionInfo[]): Map<string, SessionInfo[]> {
  const map = new Map<string, SessionInfo[]>()
  for (const s of sessions) {
    const list = map.get(s.cwd) || []
    list.push(s)
    map.set(s.cwd, list)
  }
  return map
}

function StatusIndicator({ status }: { status?: SessionStatus }) {
  switch (status) {
    case 'completed':
      return (
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
        </span>
      )
    case 'in-progress':
      return <Loader2 className="h-3 w-3 shrink-0 animate-spin text-green-500" />
    case 'tool-running':
      return <Loader2 className="h-3 w-3 shrink-0 animate-spin text-blue-500" />
    case 'error':
      return <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-red-500" />
    case 'pending':
      return <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-muted-foreground/30" />
    default: // idle
      return <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-muted-foreground/30" />
  }
}

interface SidebarContentProps {
  onSelect?: () => void
}

export function SidebarContent({ onSelect }: SidebarContentProps) {
  const { active, createSession, closeSession } = useSessions()
  const { status } = useWebSocket()
  const logout = () => { localStorage.removeItem('token'); window.location.reload() }
  const navigate = useNavigate()
  const { bridgeId } = useParams<{ bridgeId: string }>()
  const grouped = useMemo(() => groupByCwd(active), [active])
  const [favorites, setFavorites] = useState<string[]>([])
  const [scrollShadow, setScrollShadow] = useState({ top: false, bottom: false })
  const scrollRef = useRef<HTMLDivElement>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // 페이지 focus 시 favorites refetch (폴링 대신)
  useEffect(() => {
    const load = () => fetchFavorites().then(setFavorites).catch(() => {})
    load()
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const updateScrollShadow = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setScrollShadow({
      top: el.scrollTop > 0,
      bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
    })
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    updateScrollShadow()
    el.addEventListener('scroll', updateScrollShadow, { passive: true })
    const ro = new ResizeObserver(updateScrollShadow)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', updateScrollShadow)
      ro.disconnect()
    }
  }, [updateScrollShadow])

  const handleSelect = (session: SessionInfo) => {
    navigate(`/chat/${session.bridge_id}`)
    onSelect?.()
  }

  const nonFavGroups = useMemo(() => {
    const favSet = new Set(favorites)
    return Array.from(grouped.entries()).filter(([cwd]) => !favSet.has(cwd))
  }, [favorites, grouped])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {status !== 'connected' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-sm rounded-[inherit]">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* New Session */}
      <div className="shrink-0 px-2 pt-2 pb-1">
        <button
          onClick={() => {
            navigate('/chat/intro')
            onSelect?.()
          }}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
          New Session
        </button>
      </div>

      {/* Scrollable content */}
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto px-2 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {scrollShadow.top && (
          <div className="pointer-events-none sticky top-0 z-[5] -mb-6 h-6" style={{ background: 'linear-gradient(to bottom, var(--color-background), transparent)' }} />
        )}

        {[
          ...favorites.map((cwd) => ({ cwd, sessions: grouped.get(cwd) || [], isFav: true })),
          ...nonFavGroups.map(([cwd, sessions]) => ({ cwd, sessions, isFav: false })),
        ].map((group, i) => (
          <motion.div
            key={group.cwd}
            className="mb-1"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: i * 0.05, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <div className="flex items-center justify-between px-2 pt-3 pb-1">
              <div className="flex items-center gap-1">
                {group.isFav && <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />}
                <span className="text-xs font-medium text-muted-foreground">
                  {extractProjectName(group.cwd)}
                </span>
              </div>
              <button
                onClick={() => createSession(group.cwd)}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            {group.isFav && group.sessions.length === 0 && (
              <p className="px-3 py-1.5 text-xs text-muted-foreground/60">No active sessions</p>
            )}
            {group.sessions.map((s) => {
              const selected = s.bridge_id === bridgeId
              const isPending = s.status === 'pending'
              return (
                <div
                  key={s.bridge_id}
                  className={`group/session relative flex items-center rounded-lg transition-colors ${
                    selected ? 'bg-muted/50 border border-border' : 'hover:bg-muted/30'
                  }`}
                >
                  <button
                    onClick={() => handleSelect(s)}
                    className="flex-1 min-w-0 px-3 py-2.5 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <StatusIndicator status={s.status} />
                      {s.command === 'claude' ? (
                        <Bot className="h-3 w-3 shrink-0 text-violet-400" />
                      ) : s.command ? (
                        <TerminalSquare className="h-3 w-3 shrink-0 text-zinc-500" />
                      ) : null}
                      <span className={`truncate text-sm ${isPending ? 'animate-pulse text-muted-foreground' : ''}`}>
                        {s.lastUserMessage || 'New Session'}
                      </span>
                    </div>
                  </button>
                  {s.tmux_session && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (!confirm('이 세션을 종료하시겠습니까?')) return
                        if (selected) {
                          navigate('/chat/intro')
                          onSelect?.()
                        }
                        closeSession(s.bridge_id)
                      }}
                      className="shrink-0 mr-2 rounded p-1 text-muted-foreground/0 group-hover/session:text-muted-foreground hover:!text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )
            })}
          </motion.div>
        ))}

        {scrollShadow.bottom && (
          <div className="pointer-events-none sticky bottom-0 z-[5] -mt-6 h-6" style={{ background: 'linear-gradient(to top, var(--color-background), transparent)' }} />
        )}
      </div>

      {/* Bottom: Settings + Logout */}
      <div className="shrink-0 border-t border-border/50 px-2 py-2 flex items-center gap-1">
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
        >
          <Settings className="h-4 w-4" />
          Settings
        </button>
        <button
          onClick={logout}
          className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
