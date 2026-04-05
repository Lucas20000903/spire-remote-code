import { useState, useRef, useCallback } from 'react'
import { Paperclip, ArrowUp, X, Loader2, FileText } from 'lucide-react'

interface ChatInputProps {
  disabled: boolean
  onSend: (content: string) => void
}

interface UploadedFile {
  id: string
  name: string
  path: string | null      // null while uploading
  status: 'uploading' | 'done' | 'error'
  previewUrl: string | null // object URL for images
  abortController: AbortController | null
}

function isImageFile(name: string) {
  return /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i.test(name)
}

export function ChatInput({ disabled, onSend }: ChatInputProps) {
  const [value, setValue] = useState('')
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [focused, setFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isUploading = files.some((f) => f.status === 'uploading')
  const hasContent = value.trim().length > 0 || files.some((f) => f.status === 'done')
  const canSend = hasContent && !isUploading && !disabled
  const active = focused || hasContent || files.length > 0

  const submit = useCallback(() => {
    if (!canSend) return

    files.forEach((f) => {
      if (f.previewUrl) URL.revokeObjectURL(f.previewUrl)
    })

    const filePaths = files
      .filter((f) => f.status === 'done' && f.path)
      .map((f) => `[file:${f.path}]`)

    const parts = [value.trim(), ...filePaths].filter(Boolean)
    onSend(parts.join('\n'))

    setValue('')
    setFiles([])
    if (textareaRef.current) {
      textareaRef.current.style.height = ''
    }
  }, [disabled, value, files, onSend])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    if (e.key === 'Enter' && !e.shiftKey && !isMobile) {
      e.preventDefault()
      submit()
    }
  }

  const handleInput = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }

  const uploadFile = async (file: File) => {
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36)
    const abortController = new AbortController()
    const previewUrl = isImageFile(file.name)
      ? URL.createObjectURL(file)
      : null

    const entry: UploadedFile = {
      id,
      name: file.name,
      path: null,
      status: 'uploading',
      previewUrl,
      abortController,
    }
    setFiles((prev) => [...prev, entry])

    try {
      const form = new FormData()
      form.append('file', file)

      const token = localStorage.getItem('token')
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
        signal: abortController.signal,
      })

      if (!res.ok) {
        throw new Error(`Upload failed: ${res.status}`)
      }

      const data = await res.json()
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id
            ? { ...f, path: data.path, status: 'done' as const, abortController: null }
            : f
        )
      )
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // Removed by user during upload
        return
      }
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id ? { ...f, status: 'error' as const, abortController: null } : f
        )
      )
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files
    if (!selected) return
    Array.from(selected).forEach(uploadFile)
    e.target.value = '' // reset so same file can be re-selected
  }

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const file = prev.find((f) => f.id === id)
      if (file?.abortController) {
        file.abortController.abort()
      }
      if (file?.previewUrl) {
        URL.revokeObjectURL(file.previewUrl)
      }
      return prev.filter((f) => f.id !== id)
    })
  }

  return (
    <div className={`p-4 transition-[padding] duration-200 ${active ? '' : 'px-6'}`}>
      <div className="mx-auto max-w-4xl">
        <div
          className={`flex flex-col gap-2 rounded-3xl bg-background/80 backdrop-blur-xl border border-muted px-4 py-3 transition-colors duration-200`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => e.preventDefault()}
        >
          {/* File preview area */}
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {files.map((f) => (
                <div
                  key={f.id}
                  className="group relative h-20 w-20 overflow-hidden rounded-xl border bg-muted"
                >
                  {/* Thumbnail content */}
                  {f.previewUrl ? (
                    <img
                      src={f.previewUrl}
                      alt={f.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-primary/10">
                      <FileText className="h-5 w-5 text-primary/60" />
                      <span className="max-w-[64px] truncate px-1 text-[10px] text-muted-foreground">
                        {f.name}
                      </span>
                    </div>
                  )}
                  {/* Upload spinner overlay */}
                  {f.status === 'uploading' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <Loader2 className="h-6 w-6 animate-spin text-white" />
                    </div>
                  )}
                  {/* Error overlay */}
                  {f.status === 'error' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-red-500/30">
                      <X className="h-5 w-5 text-red-400" />
                    </div>
                  )}
                  {/* X remove button */}
                  <button
                    type="button"
                    onClick={() => removeFile(f.id)}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="메시지를 입력하세요..."
            disabled={disabled}
            rows={2}
            className="w-full resize-none bg-transparent text-sm leading-relaxed placeholder:text-muted-foreground focus:outline-none disabled:opacity-50 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          />

          {/* Bottom toolbar */}
          <div className="flex items-center justify-between">
            {/* Attach button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              aria-label="파일 첨부"
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <Paperclip className="h-5 w-5" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />

            {/* Send button */}
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              aria-label="메시지 전송"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-30"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
