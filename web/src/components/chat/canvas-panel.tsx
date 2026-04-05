import { useState, useRef, useMemo } from 'react'
import { X, Globe, RotateCw } from 'lucide-react'
import { cn } from '@/lib/utils'

// --- Tab types ---

export interface ToolTab {
  kind: 'tool'
  id: string
  label: string
  toolName: string
  input: Record<string, unknown>
  result?: { content?: unknown; is_error?: boolean; interrupted?: boolean }
}

export interface WebViewTab {
  kind: 'webview'
  id: string
  label: string
  port: string
}

export type CanvasTab = ToolTab | WebViewTab

interface CanvasPanelProps {
  tabs: CanvasTab[]
  activeTabId: string | null
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onCloseAll: () => void
}

// --- Result text extraction ---

function extractResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((c: { type?: string; text?: string }) => c.type === 'text')
      .map((c: { text?: string }) => c.text || '')
      .join('\n')
  }
  if (content != null) return JSON.stringify(content, null, 2)
  return ''
}

// --- File extension to language hint ---

function langFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    rs: 'rust', py: 'python', go: 'go', rb: 'ruby', java: 'java',
    json: 'json', toml: 'toml', yaml: 'yaml', yml: 'yaml',
    md: 'markdown', html: 'html', css: 'css', scss: 'scss',
    sh: 'shell', bash: 'shell', zsh: 'shell',
    sql: 'sql', swift: 'swift', kt: 'kotlin',
  }
  return map[ext] || ''
}

// --- Tool content renderers ---

function ReadWriteContent({ input, result }: { input: Record<string, unknown>; result?: { content?: unknown; is_error?: boolean } }) {
  const filePath = typeof input.file_path === 'string' ? input.file_path : ''
  const lang = langFromPath(filePath)
  const text = result ? extractResultText(result.content) : (typeof input.content === 'string' ? input.content : '')

  if (result?.is_error) {
    return (
      <div className="p-4">
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400 font-mono whitespace-pre-wrap">
          {text}
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-auto">
      <pre className={cn('p-4 text-xs font-mono leading-relaxed whitespace-pre text-foreground/90', lang && `language-${lang}`)}>
        {text || '(empty)'}
      </pre>
    </div>
  )
}

function EditContent({ input }: { input: Record<string, unknown> }) {
  const oldStr = typeof input.old_string === 'string' ? input.old_string : ''
  const newStr = typeof input.new_string === 'string' ? input.new_string : ''

  const oldLines = oldStr.split('\n')
  const newLines = newStr.split('\n')

  return (
    <div className="overflow-auto p-4 font-mono text-xs leading-relaxed">
      {oldLines.map((line, i) => (
        <div key={`old-${i}`} className="bg-red-500/10 text-red-400">
          <span className="inline-block w-6 text-right mr-2 text-red-400/50 select-none">-</span>
          {line || ' '}
        </div>
      ))}
      {oldLines.length > 0 && newLines.length > 0 && (
        <div className="border-t border-border/30 my-1" />
      )}
      {newLines.map((line, i) => (
        <div key={`new-${i}`} className="bg-green-500/10 text-green-400">
          <span className="inline-block w-6 text-right mr-2 text-green-400/50 select-none">+</span>
          {line || ' '}
        </div>
      ))}
    </div>
  )
}

function BashContent({ input, result }: { input: Record<string, unknown>; result?: { content?: unknown; is_error?: boolean } }) {
  const command = typeof input.command === 'string' ? input.command : ''
  const description = typeof input.description === 'string' ? input.description : ''
  const text = result ? extractResultText(result.content) : ''

  return (
    <div className="overflow-auto">
      {description && (
        <div className="px-4 pt-3 pb-1 text-xs text-muted-foreground">{description}</div>
      )}
      <div className="px-4 py-2 border-b border-border/30">
        <pre className="text-xs font-mono text-violet-400 whitespace-pre-wrap break-all">$ {command}</pre>
      </div>
      {text && (
        <pre className={cn(
          'p-4 text-xs font-mono leading-relaxed whitespace-pre-wrap break-all',
          result?.is_error ? 'text-red-400' : 'text-foreground/90',
        )}>
          {text}
        </pre>
      )}
    </div>
  )
}

function GrepGlobContent({ toolName, input, result }: { toolName: string; input: Record<string, unknown>; result?: { content?: unknown; is_error?: boolean } }) {
  const pattern = typeof input.pattern === 'string' ? input.pattern : ''
  const text = result ? extractResultText(result.content) : ''
  const lines = text.split('\n').filter(Boolean)

  return (
    <div className="overflow-auto">
      <div className="px-4 py-2 border-b border-border/30 text-xs">
        <span className="text-muted-foreground">{toolName === 'Grep' ? 'Pattern' : 'Glob'}:</span>{' '}
        <span className="font-mono text-foreground">{pattern}</span>
        <span className="ml-2 text-muted-foreground">({lines.length} results)</span>
      </div>
      <div className="p-4 space-y-0.5">
        {lines.map((line, i) => (
          <div key={i} className="text-xs font-mono text-foreground/90 truncate">{line}</div>
        ))}
        {lines.length === 0 && <div className="text-xs text-muted-foreground">No results</div>}
      </div>
    </div>
  )
}

function DefaultContent({ toolName, result }: { toolName: string; result?: { content?: unknown; is_error?: boolean } }) {
  const text = result ? extractResultText(result.content) : ''
  return (
    <div className="overflow-auto">
      <div className="px-4 pt-3 pb-1 text-xs text-muted-foreground">{toolName} result</div>
      <pre className={cn(
        'p-4 text-xs font-mono leading-relaxed whitespace-pre-wrap break-all',
        result?.is_error ? 'text-red-400' : 'text-foreground/90',
      )}>
        {text || '(no output)'}
      </pre>
    </div>
  )
}

function ToolContent({ tab }: { tab: ToolTab }) {
  switch (tab.toolName) {
    case 'Read':
    case 'Write':
      return <ReadWriteContent input={tab.input} result={tab.result} />
    case 'Edit':
      return <EditContent input={tab.input} />
    case 'Bash':
      return <BashContent input={tab.input} result={tab.result} />
    case 'Grep':
    case 'Glob':
      return <GrepGlobContent toolName={tab.toolName} input={tab.input} result={tab.result} />
    default:
      return <DefaultContent toolName={tab.toolName} result={tab.result} />
  }
}

// --- Webview tab content ---

const IFRAME_W = 1600
const IFRAME_H = 900

function WebViewContent({ tab }: { tab: WebViewTab }) {
  const [port, setPort] = useState(tab.port)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  // 로컬호스트 포트를 Spire 서버를 통해 프록시
  const src = useMemo(
    () => `${window.location.protocol}//${window.location.host}/proxy/${port}/`,
    [port],
  )

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="shrink-0 flex items-center gap-2 border-b border-border/30 px-3 py-2">
        <Globe className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">:</span>
        <input
          value={port}
          onChange={(e) => setPort(e.target.value)}
          className="w-20 rounded-md border border-border/50 bg-muted/50 px-2 py-0.5 text-xs text-foreground outline-none focus:border-ring"
          placeholder="5173"
        />
        <button
          onClick={() => { if (iframeRef.current) iframeRef.current.src = src }}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <RotateCw className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden bg-white">
        <iframe
          ref={iframeRef}
          src={src}
          style={{
            width: IFRAME_W,
            height: IFRAME_H,
            transform: `scale(${Math.min(1, 1)})`,
            transformOrigin: 'top left',
            border: 'none',
          }}
          className="h-full w-full"
          title="Dev Preview"
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
      </div>
    </div>
  )
}

// --- Main canvas panel ---

export function CanvasPanel({ tabs, activeTabId, onActivate, onClose, onCloseAll }: CanvasPanelProps) {
  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0]

  if (tabs.length === 0) return null

  return (
    <div className="flex h-full flex-col border-l border-border/30 bg-background">
      {/* Tab bar */}
      <div className="shrink-0 flex items-center border-b border-border/30 bg-background/80 backdrop-blur-sm overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex items-center min-w-0 flex-1">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={cn(
                'group/tab flex items-center gap-1.5 border-r border-border/20 px-3 py-2 text-xs cursor-pointer shrink-0 max-w-[180px] transition-colors',
                tab.id === activeTab?.id
                  ? 'bg-muted/30 text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/20',
              )}
              onClick={() => onActivate(tab.id)}
            >
              {tab.kind === 'webview' && <Globe className="h-3 w-3 shrink-0 text-blue-400" />}
              <span className="truncate">{tab.label}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(tab.id)
                }}
                className="shrink-0 rounded p-0.5 text-muted-foreground/0 group-hover/tab:text-muted-foreground hover:!text-foreground transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
        {tabs.length > 1 && (
          <button
            onClick={onCloseAll}
            className="shrink-0 px-2 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Tab content — 독립 스크롤 영역 (좌우 포함) */}
      <div className="flex-1 min-h-0 overflow-auto">
        {activeTab?.kind === 'tool' && <ToolContent tab={activeTab} />}
        {activeTab?.kind === 'webview' && <WebViewContent tab={activeTab} />}
      </div>
    </div>
  )
}
