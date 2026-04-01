import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { useSessions } from '@/hooks/use-sessions'
import { useWebSocket } from '@/hooks/use-websocket'
import { fetchFavorites } from '@/lib/api'
import { Plus, Star, Loader2 } from 'lucide-react'
import type { SessionInfo } from '@/lib/types'

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

interface SidebarContentProps {
  onSelect?: () => void
}

export function SidebarContent({ onSelect }: SidebarContentProps) {
  const { active, createSession } = useSessions()
  const { status } = useWebSocket()
  const navigate = useNavigate()
  const { bridgeId } = useParams<{ bridgeId: string }>()
  const grouped = groupByCwd(active)
  const [favorites, setFavorites] = useState<string[]>([])
  const [scrollShadow, setScrollShadow] = useState({ top: false, bottom: false })
  const scrollRef = useRef<HTMLDivElement>(null)

  // favorites를 주기적으로 refetch (인트로에서 즐겨찾기 변경 반영)
  useEffect(() => {
    fetchFavorites().then(setFavorites).catch(() => {})
    const interval = setInterval(() => {
      fetchFavorites().then(setFavorites).catch(() => {})
    }, 5000)
    return () => clearInterval(interval)
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

  // Favorite cwds (including those without active sessions)
  const favSet = new Set(favorites)
  const nonFavGroups = Array.from(grouped.entries()).filter(([cwd]) => !favSet.has(cwd))

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
        {/* Scroll shadow top */}
        {scrollShadow.top && (
          <div className="pointer-events-none sticky top-0 z-[5] -mb-6 h-6" style={{ background: 'linear-gradient(to bottom, var(--color-background), transparent)' }} />
        )}
      {/* All groups: favorites first, then non-favorites */}
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
            const isPending = s.bridge_id.startsWith('pending-')
            return (
              <button
                key={s.bridge_id}
                onClick={() => handleSelect(s)}
                className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors ${
                  selected ? 'bg-muted/50 border border-border' : 'hover:bg-muted/30'
                }`}
              >
                <div className="flex items-center gap-2">
                  {isPending ? (
                    <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
                  ) : (
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                    </span>
                  )}
                  <span className="truncate text-sm">
                    {s.lastUserMessage || (isPending ? 'New Session' : 'New Session')}
                  </span>
                </div>
              </button>
            )
          })}
        </motion.div>
      ))}
        {/* Scroll shadow bottom */}
        {scrollShadow.bottom && (
          <div className="pointer-events-none sticky bottom-0 z-[5] -mt-6 h-6" style={{ background: 'linear-gradient(to top, var(--color-background), transparent)' }} />
        )}
      </div>
    </div>
  )
}
