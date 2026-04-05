import { useState, useMemo } from 'react'
import { ChevronRight, Loader2, FileText, Terminal, Search, Pencil, FolderOpen, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SubagentBlock } from './subagent-block'
import hljs from 'highlight.js/lib/core'
import hljsTypescript from 'highlight.js/lib/languages/typescript'
import hljsJava from 'highlight.js/lib/languages/java'
import hljsBash from 'highlight.js/lib/languages/bash'
import hljsJson from 'highlight.js/lib/languages/json'
import hljsXml from 'highlight.js/lib/languages/xml'
import hljsCss from 'highlight.js/lib/languages/css'
import hljsSql from 'highlight.js/lib/languages/sql'
import hljsPython from 'highlight.js/lib/languages/python'
import hljsRust from 'highlight.js/lib/languages/rust'
import hljsGo from 'highlight.js/lib/languages/go'
import 'highlight.js/styles/github-dark.css'

hljs.registerLanguage('typescript', hljsTypescript)
hljs.registerLanguage('javascript', hljsTypescript)
hljs.registerLanguage('java', hljsJava)
hljs.registerLanguage('bash', hljsBash)
hljs.registerLanguage('shell', hljsBash)
hljs.registerLanguage('json', hljsJson)
hljs.registerLanguage('xml', hljsXml)
hljs.registerLanguage('html', hljsXml)
hljs.registerLanguage('css', hljsCss)
hljs.registerLanguage('sql', hljsSql)
hljs.registerLanguage('python', hljsPython)
hljs.registerLanguage('rust', hljsRust)
hljs.registerLanguage('go', hljsGo)

interface ToolUseBlockProps {
  id: string
  name: string
  input: Record<string, unknown>
  hasResult: boolean
  result?: { content?: unknown; is_error?: boolean; interrupted?: boolean }
  isHistorical?: boolean
}

// --- 도구 아이콘 + 컬러 ---

function toolColor(name: string) {
  switch (name) {
    case 'Edit': return 'bg-amber-500/10 text-amber-400'
    case 'Bash': return 'bg-violet-500/10 text-violet-400'
    case 'Read': return 'bg-blue-500/10 text-blue-400'
    case 'Write': return 'bg-emerald-500/10 text-emerald-400'
    case 'Grep': return 'bg-cyan-500/10 text-cyan-400'
    case 'Glob': return 'bg-pink-500/10 text-pink-400'
    case 'WebFetch': return 'bg-orange-500/10 text-orange-400'
    default: return 'bg-muted/30 text-muted-foreground'
  }
}

function ToolIcon({ name }: { name: string }) {
  const cls = 'h-3.5 w-3.5'
  switch (name) {
    case 'Read': case 'Write': return <FileText className={cls} />
    case 'Edit': return <Pencil className={cls} />
    case 'Bash': return <Terminal className={cls} />
    case 'Grep': return <Search className={cls} />
    case 'Glob': return <FolderOpen className={cls} />
    default: return <FileText className={cls} />
  }
}

function StatusIcon({ hasResult, isError, interrupted }: { hasResult: boolean; isError?: boolean; interrupted?: boolean }) {
  if (interrupted) return <X className="h-3.5 w-3.5 text-red-400" />
  if (!hasResult) return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
  if (isError) return <X className="h-3.5 w-3.5 text-red-400" />
  return <Check className="h-3.5 w-3.5 text-emerald-500" />
}

// --- 라벨 ---

function toolLabel(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Read': case 'Write': case 'Edit':
      return typeof input.file_path === 'string' ? input.file_path : name
    case 'Bash': {
      const desc = typeof input.description === 'string' ? input.description : ''
      const cmd = typeof input.command === 'string' ? input.command : ''
      return desc || cmd || name
    }
    case 'Grep': return typeof input.pattern === 'string' ? input.pattern : name
    case 'Glob': return typeof input.pattern === 'string' ? input.pattern : name
    case 'WebFetch': return typeof input.url === 'string' ? input.url : name
    default: return name
  }
}

// --- 파일 확장자 → highlight.js 언어 ---

function langFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    rs: 'rust', py: 'python', go: 'go', rb: 'ruby', java: 'java',
    json: 'json', toml: 'toml', yaml: 'yaml', yml: 'yaml',
    md: 'markdown', html: 'html', css: 'css', scss: 'css',
    sh: 'bash', bash: 'bash', zsh: 'bash', sql: 'sql',
    swift: 'swift', kt: 'kotlin', xml: 'xml',
  }
  return map[ext] || ''
}

// --- 결과 텍스트 추출 ---

function extractResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content))
    return content.filter((c: { type?: string }) => c.type === 'text').map((c: { text?: string }) => c.text || '').join('\n')
  if (content != null) return JSON.stringify(content, null, 2)
  return ''
}

// --- 하이라이팅된 코드 ---

function HighlightedCode({ code, lang, maxLines = 12 }: { code: string; lang?: string; maxLines?: number }) {
  const lines = code.split('\n')
  const truncated = lines.length > maxLines
  const displayCode = truncated ? lines.slice(0, maxLines).join('\n') : code

  const highlighted = useMemo(() => {
    if (!lang) return null
    try { return hljs.highlight(displayCode, { language: lang }).value } catch { return null }
  }, [displayCode, lang])

  return (
    <div className="overflow-x-auto">
      <pre className="px-3 py-2 text-xs font-mono leading-relaxed">
        {highlighted
          ? <code dangerouslySetInnerHTML={{ __html: highlighted }} />
          : <code className="text-foreground/80">{displayCode}</code>
        }
      </pre>
      {truncated && (
        <div className="px-3 py-1 text-[11px] text-muted-foreground border-t border-border/20">
          {lines.length} lines total
        </div>
      )}
    </div>
  )
}

// --- Diff 뷰 ---

function DiffContent({ input }: { input: Record<string, unknown> }) {
  const oldStr = typeof input.old_string === 'string' ? input.old_string : ''
  const newStr = typeof input.new_string === 'string' ? input.new_string : ''
  const filePath = typeof input.file_path === 'string' ? input.file_path : ''
  const lang = langFromPath(filePath)

  const oldHtml = useMemo(() => {
    if (!lang) return null
    try { return hljs.highlight(oldStr, { language: lang }).value } catch { return null }
  }, [oldStr, lang])
  const newHtml = useMemo(() => {
    if (!lang) return null
    try { return hljs.highlight(newStr, { language: lang }).value } catch { return null }
  }, [newStr, lang])

  const renderLine = (html: string | null, text: string, prefix: string, bgClass: string, prefixClass: string) => {
    return text.split('\n').map((line, i) => {
      const htmlLine = html?.split('\n')[i]
      return (
        <div key={i} className={cn(bgClass, 'px-3 py-0.5 flex')}>
          <span className={cn('inline-block w-5 text-right mr-2 select-none shrink-0', prefixClass)}>{prefix}</span>
          {htmlLine
            ? <span dangerouslySetInnerHTML={{ __html: htmlLine || '&nbsp;' }} />
            : <span>{line || ' '}</span>
          }
        </div>
      )
    })
  }

  return (
    <div className="overflow-x-auto font-mono text-xs leading-relaxed">
      {renderLine(oldHtml, oldStr, '-', 'bg-red-500/8', 'text-red-400/40')}
      {renderLine(newHtml, newStr, '+', 'bg-emerald-500/8', 'text-emerald-400/40')}
    </div>
  )
}

// --- Bash 출력 ---

function BashContent({ input, result }: { input: Record<string, unknown>; result?: { content?: unknown; is_error?: boolean } }) {
  const command = typeof input.command === 'string' ? input.command : ''
  const text = result ? extractResultText(result.content) : ''
  return (
    <div className="overflow-x-auto">
      <div className="px-3 py-1.5 border-b border-border/20">
        <span className="font-mono text-xs text-violet-400">$ {command}</span>
      </div>
      {text && (
        <pre className={cn('px-3 py-2 text-xs font-mono leading-relaxed whitespace-pre', result?.is_error ? 'text-red-400' : 'text-foreground/80')}>
          {text}
        </pre>
      )}
    </div>
  )
}

// --- Grep/Glob 결과 ---

function ListContent({ name, input, result }: { name: string; input: Record<string, unknown>; result?: { content?: unknown } }) {
  const pattern = typeof input.pattern === 'string' ? input.pattern : ''
  const text = result ? extractResultText(result.content) : ''
  const lines = text.split('\n').filter(Boolean)
  return (
    <div className="overflow-x-auto">
      <div className="px-3 py-1.5 border-b border-border/20 text-xs">
        <span className="text-muted-foreground">{name === 'Grep' ? 'Pattern' : 'Glob'}:</span>{' '}
        <span className="font-mono text-foreground">{pattern}</span>
        <span className="ml-2 text-muted-foreground">({lines.length} results)</span>
      </div>
      <div className="px-3 py-1.5 space-y-0.5">
        {lines.slice(0, 20).map((line, i) => (
          <div key={i} className="text-xs font-mono text-foreground/80 truncate">{line}</div>
        ))}
        {lines.length > 20 && <div className="text-[11px] text-muted-foreground">...and {lines.length - 20} more</div>}
        {lines.length === 0 && <div className="text-xs text-muted-foreground">No results</div>}
      </div>
    </div>
  )
}

// --- 펼침 콘텐츠 렌더링 ---

function ExpandedContent({ name, input, result }: { name: string; input: Record<string, unknown>; result?: { content?: unknown; is_error?: boolean } }) {
  switch (name) {
    case 'Read': {
      const filePath = typeof input.file_path === 'string' ? input.file_path : ''
      const text = result ? extractResultText(result.content) : ''
      if (result?.is_error) return <pre className="px-3 py-2 text-xs font-mono text-red-400">{text}</pre>
      return <HighlightedCode code={text} lang={langFromPath(filePath)} />
    }
    case 'Write': {
      const filePath = typeof input.file_path === 'string' ? input.file_path : ''
      const content = typeof input.content === 'string' ? input.content : ''
      return <HighlightedCode code={content} lang={langFromPath(filePath)} />
    }
    case 'Edit':
      return <DiffContent input={input} />
    case 'Bash':
      return <BashContent input={input} result={result} />
    case 'Grep':
    case 'Glob':
      return <ListContent name={name} input={input} result={result} />
    default: {
      const text = result ? extractResultText(result.content) : ''
      return text ? <pre className="px-3 py-2 text-xs font-mono text-foreground/80 whitespace-pre-wrap">{text}</pre> : null
    }
  }
}

// --- 메인 컴포넌트 ---

export function ToolUseBlock({
  id: _id,
  name,
  input,
  hasResult,
  result,
  isHistorical,
}: ToolUseBlockProps) {
  const [open, setOpen] = useState(false)

  if (name === 'Agent' || name === 'Task') {
    return <SubagentBlock name={name} input={input} hasResult={hasResult} />
  }

  const effectiveHasResult = hasResult || !!isHistorical
  const label = toolLabel(name, input)
  const hasContent = effectiveHasResult && !result?.interrupted

  return (
    <div className="rounded-lg border border-border/50 bg-muted/10 overflow-hidden">
      <button
        onClick={() => hasContent && setOpen(!open)}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors',
          hasContent && 'hover:bg-muted/20 cursor-pointer',
        )}
      >
        {hasContent && (
          <ChevronRight className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        )}
        <span className={cn('rounded px-1.5 py-0.5 font-mono', toolColor(name))}>
          <ToolIcon name={name} />
        </span>
        <span className="truncate text-muted-foreground">{label}</span>
        <span className="ml-auto shrink-0">
          <StatusIcon hasResult={effectiveHasResult} isError={result?.is_error} interrupted={result?.interrupted} />
        </span>
      </button>
      {open && hasContent && (
        <div className="border-t border-border/30">
          <ExpandedContent name={name} input={input} result={result} />
        </div>
      )}
    </div>
  )
}
