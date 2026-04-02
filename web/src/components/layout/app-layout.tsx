import { createContext, useContext, useState, useEffect, useRef } from 'react'
import { Outlet } from 'react-router-dom'

import { SidebarContent } from './sidebar'
import { ConnectionBanner } from './connection-banner'
import { useSessions } from '@/hooks/use-sessions'
import { Menu } from 'lucide-react'

interface HeaderTitle {
  project: string
  subtitle?: string
}

interface LayoutContextValue {
  setTitle: (title: HeaderTitle | null) => void
}

const LayoutContext = createContext<LayoutContextValue>({ setTitle: () => {} })

export function useLayout() {
  return useContext(LayoutContext)
}

const SIDEBAR_W = 280
const MD_BREAKPOINT = 768

function useIsDesktop() {
  const ref = useRef(typeof window !== 'undefined' && window.innerWidth >= MD_BREAKPOINT)
  const [, forceRender] = useState(0)
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${MD_BREAKPOINT}px)`)
    const handler = (e: MediaQueryListEvent) => {
      if (ref.current !== e.matches) {
        ref.current = e.matches
        forceRender((n) => n + 1)
      }
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return ref.current
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
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true)
  const [title, setTitle] = useState<HeaderTitle | null>(null)

  const sidebarOpen = isDesktop ? desktopSidebarOpen : mobileSidebarOpen
  const setSidebarOpen = isDesktop ? setDesktopSidebarOpen : setMobileSidebarOpen

  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.style.paddingLeft = isDesktop ? `${SIDEBAR_W + 24}px` : '0'
    }
  }, [isDesktop])

  return (
    <LayoutContext.Provider value={{ setTitle }}>
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
            style={{ width: 'calc(100dvw - 72px)' }}
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
          ref={contentRef}
          className={`relative left-0 z-10 flex min-w-0 flex-1 flex-col bg-background overflow-hidden ${
            !isDesktop && sidebarOpen ? 'sidebar-open' : ''
          }`}
          onClick={!isDesktop && sidebarOpen ? () => setSidebarOpen(false) : undefined}
        >
          {/* Dark overlay when sidebar open on mobile */}
          <div
            className={`absolute inset-0 z-30 bg-black pointer-events-none ${
              !isDesktop && sidebarOpen ? 'opacity-40' : 'opacity-0'
            }`}
          />

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
          </div>

          {/* Content */}
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden md:px-4">
            <Outlet />
          </div>
        </div>
      </div>
    </LayoutContext.Provider>
  )
}
