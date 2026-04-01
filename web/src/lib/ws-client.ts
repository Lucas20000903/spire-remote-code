import type { WsClientMessage, WsServerMessage } from './types'

type MessageHandler = (msg: WsServerMessage) => void
type StatusHandler = (status: 'connecting' | 'connected' | 'disconnected') => void

export class WsClient {
  private ws: WebSocket | null = null
  private url: string
  private handlers: Set<MessageHandler> = new Set()
  private statusHandlers: Set<StatusHandler> = new Set()
  private retryDelay = 1000
  private maxRetryDelay = 30000
  private closed = false

  constructor(token: string) {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    this.url = `${protocol}//${location.host}/ws?token=${token}`
  }

  connect() {
    if (this.closed) return
    this.setStatus('connecting')
    this.ws = new WebSocket(this.url)

    this.ws.onopen = () => {
      this.retryDelay = 1000
      this.setStatus('connected')
    }

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as WsServerMessage
        this.handlers.forEach((h) => h(msg))
      } catch {
        // ignore malformed messages
      }
    }

    this.ws.onclose = () => {
      this.setStatus('disconnected')
      if (!this.closed) {
        setTimeout(() => this.connect(), this.retryDelay)
        this.retryDelay = Math.min(this.retryDelay * 2, this.maxRetryDelay)
      }
    }

    this.ws.onerror = () => this.ws?.close()
  }

  send(msg: WsClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  onMessage(handler: MessageHandler) {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  onStatus(handler: StatusHandler) {
    this.statusHandlers.add(handler)
    return () => {
      this.statusHandlers.delete(handler)
    }
  }

  private setStatus(s: 'connecting' | 'connected' | 'disconnected') {
    this.statusHandlers.forEach((h) => h(s))
  }

  disconnect() {
    this.closed = true
    this.ws?.close()
  }
}
