import { useState, useRef, useCallback } from 'react'
import { X, GripHorizontal, RotateCw } from 'lucide-react'

interface WebViewPanelProps {
  open: boolean
  onClose: () => void
}

const IFRAME_W = 1600
const IFRAME_H = 900
const PANEL_W = 480
const SCALE = PANEL_W / IFRAME_W
const PANEL_H = IFRAME_H * SCALE

export function WebViewPanel({ open, onClose }: WebViewPanelProps) {
  const [port, setPort] = useState('5173')
  const posRef = useRef({ x: Math.max(16, window.innerWidth - PANEL_W - 16), y: 80 })
  const [pos, setPos] = useState(posRef.current)
  const draggingRef = useRef(false)
  const dragOffset = useRef({ x: 0, y: 0 })
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const src = `${window.location.protocol}//${window.location.hostname}:${port}`

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    draggingRef.current = true
    dragOffset.current = { x: e.clientX - posRef.current.x, y: e.clientY - posRef.current.y }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return
    const next = { x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y }
    posRef.current = next
    setPos(next)
  }, [])

  const onPointerUp = useCallback(() => {
    draggingRef.current = false
  }, [])

  if (!open) return null

  return (
    <div
      className="fixed z-50 rounded-xl shadow-2xl"
      style={{ left: pos.x, top: pos.y, width: PANEL_W }}
    >
      {/* Toolbar / drag handle */}
      <div
        className="flex items-center gap-2 rounded-t-xl border border-border bg-background/95 px-3 py-2 backdrop-blur-xl select-none cursor-grab active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <GripHorizontal className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
        <div
          className="flex flex-1 items-center gap-1.5"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span className="text-xs text-muted-foreground">:</span>
          <input
            value={port}
            onChange={(e) => setPort(e.target.value)}
            className="w-16 rounded-md border border-border/50 bg-muted/50 px-2 py-0.5 text-xs text-foreground outline-none focus:border-ring"
          />
        </div>
        <button
          onClick={() => { if (iframeRef.current) iframeRef.current.src = src }}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <RotateCw className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Scaled iframe */}
      <div
        className="overflow-hidden rounded-b-xl border border-t-0 border-border bg-white"
        style={{ width: PANEL_W, height: PANEL_H }}
      >
        <iframe
          ref={iframeRef}
          src={src}
          style={{
            width: IFRAME_W,
            height: IFRAME_H,
            transform: `scale(${SCALE})`,
            transformOrigin: 'top left',
            border: 'none',
          }}
          title="Dev Preview"
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
      </div>
    </div>
  )
}
