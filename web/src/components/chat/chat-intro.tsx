import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { fetchProjects, fetchFavorites, addFavorite, removeFavorite } from '@/lib/api'
import { FolderOpen, Star, Search, Clock } from 'lucide-react'
import { useSessions } from '@/hooks/use-sessions'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'

interface Project {
  name: string
  path: string
}

function extractProjectName(cwd: string): string {
  const parts = cwd.split('/')
  return parts[parts.length - 1] || cwd
}

export function ChatIntro() {
  const [projects, setProjects] = useState<Project[]>([])
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  const { createSession, recent, active } = useSessions()
  const [scrollShadow, setScrollShadow] = useState({ top: false, bottom: false })
  const scrollRef = useRef<HTMLDivElement>(null)
  const [confirmProject, setConfirmProject] = useState<{ name: string; path: string } | null>(null)

  const updateScrollShadow = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setScrollShadow({
      top: el.scrollTop > 0,
      bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
    })
  }, [])

  useEffect(() => {
    Promise.all([fetchProjects(), fetchFavorites()])
      .then(([projData, favs]) => {
        setProjects(Array.isArray(projData) ? projData : projData.projects || [])
        setFavorites(new Set(favs))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
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

  const toggleFavorite = async (path: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (favorites.has(path)) {
      setFavorites((prev) => { const next = new Set(prev); next.delete(path); return next })
      await removeFavorite(path)
    } else {
      setFavorites((prev) => new Set(prev).add(path))
      await addFavorite(path)
    }
  }

  // Filter by query, then sort favorites first
  const filtered = projects
    .filter((p) =>
      !query || p.name.toLowerCase().includes(query.toLowerCase()) || p.path.toLowerCase().includes(query.toLowerCase())
    )
    .sort((a, b) => {
      const aFav = favorites.has(a.path) ? 0 : 1
      const bFav = favorites.has(b.path) ? 0 : 1
      return aFav - bFav
    })

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center px-6 pt-24">
      {/* Logo + Search */}
      <motion.div
        className="mb-8 shrink-0 text-center"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
      >
        <img src="/logo-light.svg" alt="Spire" className="mx-auto h-10 dark:hidden" />
        <img src="/logo-dark.svg" alt="Spire" className="mx-auto h-10 hidden dark:block" />
        <p className="mt-3 text-sm text-muted-foreground">Select a workspace to start</p>
      </motion.div>

      {/* Recent Sessions */}
      {recent.length > 0 && (
        <motion.div
          className="mb-6 w-full max-w-sm shrink-0"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.08, ease: [0.25, 0.1, 0.25, 1] }}
        >
          <p className="mb-2 px-1 text-xs font-medium text-muted-foreground">Recent</p>
          <div className="space-y-1.5">
            {recent.slice(0, 3).map((s) => (
              <button
                key={s.bridge_id || s.id}
                onClick={() => {
                  // active 세션 중 같은 cwd가 있으면 바로 이동
                  const match = active.find((a) => a.cwd === s.cwd)
                  if (match) {
                    navigate(`/chat/${match.bridge_id}`)
                  } else {
                    setConfirmProject({ name: extractProjectName(s.cwd), path: s.cwd })
                  }
                }}
                className="flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-muted/50"
              >
                <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{extractProjectName(s.cwd)}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {s.lastUserMessage || 'No messages'}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </motion.div>
      )}

      <motion.div
        className="mb-4 w-full max-w-sm shrink-0"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.1, ease: [0.25, 0.1, 0.25, 1] }}
      >
        <div className="flex items-center gap-2 rounded-xl border px-3 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search workspace..."
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </motion.div>

      {/* Project list */}
      <motion.div
        className="relative w-full max-w-sm min-h-0 flex-1"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
      >
        {scrollShadow.top && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-[5] h-6" style={{ background: 'linear-gradient(to bottom, var(--color-background), transparent)' }} />
        )}
        <div ref={scrollRef} className="h-full overflow-y-auto pb-12 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden space-y-2">
        {loading && (
          <p className="text-center text-sm text-muted-foreground">Loading...</p>
        )}
        {!loading && filtered.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">
            {query ? 'No results' : 'No projects found. Start a Claude Code session to begin.'}
          </p>
        )}
        {filtered.map((p) => (
          <button
            key={p.path}
            onClick={() => setConfirmProject({ name: p.name, path: p.path })}
            className="flex w-full items-center gap-3 rounded-xl border p-3.5 text-left transition-colors hover:bg-muted/50"
          >
            <FolderOpen className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{p.name}</div>
              <div className="truncate text-xs text-muted-foreground">{p.path}</div>
            </div>
            <div
              onClick={(e) => toggleFavorite(p.path, e)}
              className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <Star
                className={`h-4 w-4 ${favorites.has(p.path) ? 'fill-yellow-400 text-yellow-400' : ''}`}
              />
            </div>
          </button>
        ))}
        </div>
        {scrollShadow.bottom && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-6" style={{ background: 'linear-gradient(to top, var(--color-background), transparent)' }} />
        )}
      </motion.div>

      {/* Create Session Confirmation */}
      <Dialog open={!!confirmProject} onOpenChange={(open) => { if (!open) setConfirmProject(null) }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>새 세션 시작</DialogTitle>
            <DialogDescription>
              새 Claude Code 세션을 시작하시겠습니까?
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{confirmProject?.name}</div>
                <div className="truncate text-xs text-muted-foreground">{confirmProject?.path}</div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">취소</Button>
            </DialogClose>
            <Button
              onClick={() => {
                if (confirmProject) createSession(confirmProject.path)
                setConfirmProject(null)
              }}
            >
              시작
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
