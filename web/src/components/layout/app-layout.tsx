import { createContext, useContext, useState, useEffect, useMemo } from 'react'
import { Outlet } from 'react-router-dom'
import { motion, AnimatePresence } from 'motion/react'

import { SidebarContent } from './sidebar'
import { ConnectionBanner } from './connection-banner'
import { useSessions } from '@/hooks/use-sessions'
import { Menu, Monitor, TerminalSquare } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { WebViewPanel } from '@/components/webview/webview-panel'

interface HeaderTitle {
  project: string
  subtitle?: string
}

export type ViewMode = 'chat' | 'terminal'

interface LayoutContextValue {
  setTitle: (title: HeaderTitle | null) => void
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  tmuxSession: string | null
  setTmuxSession: (name: string | null) => void
}

const LayoutContext = createContext<LayoutContextValue>({
  setTitle: () => {},
  viewMode: 'chat',
  setViewMode: () => {},
  tmuxSession: null,
  setTmuxSession: () => {},
})

export function useLayout() {
  return useContext(LayoutContext)
}

const SIDEBAR_W = 280
const MD_BREAKPOINT = 768

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= MD_BREAKPOINT
  )
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${MD_BREAKPOINT}px)`)
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return isDesktop
}

function CompletedBadge() {
  const { completedCount } = useSessions()
  if (completedCount === 0) return null
  return (
    <span className="absolute -right-1.5 -top-1.5 h-1.5 w-1.5 rounded-full bg-green-500" />
  )
}

export function AppLayout() {
  const isDesktop = useIsDesktop()
  const location = useLocation()
  const { findByBridgeId } = useSessions()
  // URL에서 bridgeId 추출 (/chat/:bridgeId)
  const bridgeId = location.pathname.match(/^\/chat\/(.+)/)?.[1]
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true)
  const [title, setTitle] = useState<HeaderTitle | null>(null)
  const [webviewOpen, setWebviewOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('chat')
  const [tmuxSession, setTmuxSession] = useState<string | null>(null)

  const toggleTerminal = () => {
    if (viewMode === 'terminal') {
      setViewMode('chat')
    } else {
      // tmuxSession이 이미 있으면 바로 전환
      if (tmuxSession) {
        setViewMode('terminal')
        return
      }
      // 없으면 현재 세션의 tmux_session 사용
      const currentSession = bridgeId ? findByBridgeId(bridgeId) : null
      if (currentSession?.tmux_session) {
        setTmuxSession(currentSession.tmux_session)
        setViewMode('terminal')
      }
    }
  }

  // bridgeId 바뀌면 tmux 세션만 갱신 (viewMode는 유지)
  useEffect(() => {
    const s = bridgeId ? findByBridgeId(bridgeId) : null
    setTmuxSession(s?.tmux_session || null)
  }, [bridgeId, findByBridgeId])

  const sidebarOpen = isDesktop ? desktopSidebarOpen : mobileSidebarOpen
  const setSidebarOpen = isDesktop ? setDesktopSidebarOpen : setMobileSidebarOpen

  const mobileSlideX = 'calc(100dvw - 72px)'

  const contentStyle = useMemo(() => {
    if (isDesktop) return { paddingLeft: SIDEBAR_W + 24, boxShadow: 'none' }
    return sidebarOpen
      ? { paddingLeft: 0, boxShadow: '-1px 0 0 0 rgba(255,255,255,0.1), -2px 0 0 0 rgba(0,0,0,0.5)' }
      : { paddingLeft: 0, boxShadow: 'none' }
  }, [isDesktop, sidebarOpen])

  return (
    <LayoutContext.Provider value={{ setTitle, viewMode, setViewMode, tmuxSession, setTmuxSession }}>
      <div className="flex h-full overflow-hidden" style={{ paddingTop: 'env(safe-area-inset-top)', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}>
        {/* ---- Sidebar ---- */}
        {isDesktop ? (
          /* Desktop: sidebar as floating card, always open */
          <div
            className="absolute left-0 top-0 z-20 m-3 flex h-[calc(100%-24px)] flex-col overflow-hidden rounded-2xl bg-background/80 backdrop-blur-xl border border-white/10 shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
            style={{ width: SIDEBAR_W }}
          >
            <div className="flex h-20 items-center px-5">
              <img src="/logo-light.svg" alt="Spire" className="h-7 dark:hidden" />
              <img src="/logo-dark.svg" alt="Spire" className="h-7 hidden dark:block" />
            </div>
            <SidebarContent />
          </div>
        ) : (
          /* Mobile: sidebar behind content */
          <div
            className="fixed left-0 top-0 z-0 flex h-full flex-col bg-background"
            style={{ width: mobileSlideX }}
          >
            <div className="flex h-16 items-center justify-between px-4">
              <img src="/logo-light.svg" alt="Spire" className="h-7 dark:hidden" />
              <img src="/logo-dark.svg" alt="Spire" className="h-7 hidden dark:block" />
            </div>
            <SidebarContent onSelect={() => setSidebarOpen(false)} />
          </div>
        )}

        {/* ---- Main content ---- */}
        <div
          className="noise relative z-10 flex min-w-0 flex-1 flex-col bg-background overflow-hidden transition-[transform,border-radius] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)]"
          style={{
            ...contentStyle,
            transform: !isDesktop && sidebarOpen ? `translateX(${mobileSlideX})` : 'translateX(0)',
            borderTopLeftRadius: !isDesktop && sidebarOpen ? 16 : 0,
            borderBottomLeftRadius: !isDesktop && sidebarOpen ? 16 : 0,
          }}
          onClick={!isDesktop && sidebarOpen ? () => setSidebarOpen(false) : undefined}
        >
          {/* Dark overlay when sidebar open on mobile */}
          <AnimatePresence>
            {!isDesktop && sidebarOpen && (
              <motion.div
                className="absolute inset-0 z-30 bg-black pointer-events-none"
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.4 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              />
            )}
          </AnimatePresence>

          <ConnectionBanner />

          {/* Header gradient — spans full width including paddingLeft (behind sidebar on desktop) */}
          <div
            className="pointer-events-none absolute inset-x-0 top-0 z-20 flex h-16 md:h-20 items-center gap-2 px-3"
            style={{
              background:
                'linear-gradient(to bottom, color-mix(in srgb, var(--color-background) 95%, transparent) 0%, color-mix(in srgb, var(--color-background) 90%, transparent) 50%, transparent 100%)',
            }}
          >
            {/* Spacer to push content past sidebar paddingLeft on desktop */}
            {isDesktop && <div style={{ width: SIDEBAR_W + 24 }} className="shrink-0" />}
            {!isDesktop && (
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="pointer-events-auto relative flex h-10 w-10 shrink-0 aspect-square items-center justify-center rounded-full bg-background/75 backdrop-blur-xl text-muted-foreground hover:text-foreground gradient-border"
              >
                <span className="relative">
                  <Menu className="h-4 w-4" />
                  <CompletedBadge />
                </span>
              </button>
            )}
            {title && (
              <div className="min-w-0 truncate text-sm md:text-base">
                <span className="font-medium">{title.project}</span>
                {title.subtitle && (
                  <span className="text-muted-foreground"> · {title.subtitle}</span>
                )}
              </div>
            )}
            <div className="pointer-events-auto ml-auto flex items-center gap-1.5">
              <button
                onClick={toggleTerminal}
                className={`flex h-10 w-10 shrink-0 aspect-square items-center justify-center rounded-full backdrop-blur-xl gradient-border ${
                  viewMode === 'terminal' ? 'bg-foreground/10 text-foreground' : 'bg-background/75 text-muted-foreground hover:text-foreground'
                }`}
              >
                <TerminalSquare className="h-4 w-4" />
              </button>
              <button
                onClick={() => setWebviewOpen((v) => !v)}
                className="flex h-10 w-10 shrink-0 aspect-square items-center justify-center rounded-full bg-background/75 backdrop-blur-xl text-muted-foreground hover:text-foreground gradient-border"
              >
                <Monitor className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden md:px-4">
            <Outlet />
          </div>
        </div>
      </div>
      <WebViewPanel open={webviewOpen} onClose={() => setWebviewOpen(false)} />
    </LayoutContext.Provider>
  )
}
