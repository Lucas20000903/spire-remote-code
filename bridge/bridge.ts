#!/usr/bin/env npx tsx
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { createServer } from 'net'

// --- Config ---
import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

function readPortFromPrefs(): number {
  try {
    const content = readFileSync(join(homedir(), '.spire/preferences.toml'), 'utf-8')
    const match = content.match(/^port\s*=\s*(\d+)/m)
    if (match) return parseInt(match[1])
  } catch {}
  return 3000
}

const RUST_SERVER = process.env.BRIDGE_RUST_SERVER || `http://localhost:${readPortFromPrefs()}`
const PORT_MIN = parseInt(process.env.BRIDGE_PORT_MIN || '8800')
const PORT_MAX = parseInt(process.env.BRIDGE_PORT_MAX || '8899')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// --- Find free port ---
async function findFreePort(): Promise<number> {
  for (let port = PORT_MIN; port <= PORT_MAX; port++) {
    const available = await new Promise<boolean>((resolve) => {
      const srv = createServer()
      srv.once('error', () => resolve(false))
      srv.listen(port, '127.0.0.1', () => {
        srv.close(() => resolve(true))
      })
    })
    if (available) return port
  }
  throw new Error(`No free port in range ${PORT_MIN}-${PORT_MAX}`)
}

// --- Register with Rust server ---
let bridgeId: string | null = null

async function register(port: number): Promise<string> {
  const res = await fetch(`${RUST_SERVER}/api/bridges/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      port,
      session_id: null,
      cwd: process.cwd(),
      pid: process.pid,
    }),
  })
  const data = await res.json() as { bridge_id: string }
  return data.bridge_id
}

async function updateSession(sessionId: string) {
  if (!bridgeId) return
  await fetch(`${RUST_SERVER}/api/bridges/update-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bridge_id: bridgeId, session_id: sessionId }),
  })
}

// --- SSE connection to Rust server ---
async function connectSSE(port: number, mcp: Server) {
  let retryDelay = 1000

  // 30초마다 재등록 (서버 재시작 시 자동 복구)
  setInterval(async () => {
    try {
      bridgeId = await register(port)
    } catch {}
  }, 30_000)

  while (true) {
    try {
      // 서버 재시작 시 registry가 초기화되므로 매번 재등록
      bridgeId = await register(port)
      const url = `${RUST_SERVER}/api/bridges/stream?bridge_id=${bridgeId}`
      const controller = new AbortController()
      // 60초 동안 SSE 이벤트가 없으면 재연결 (서버 keepalive 감지)
      let lastActivity = Date.now()
      const watchdog = setInterval(() => {
        if (Date.now() - lastActivity > 60_000) controller.abort()
      }, 10_000)

      const res = await fetch(url, { signal: controller.signal })
      if (!res.ok || !res.body) throw new Error(`SSE failed: ${res.status}`)
      retryDelay = 1000

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          lastActivity = Date.now()
          buffer += decoder.decode(value, { stream: true })

          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          let eventType = 'message'
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim()
            } else if (line.startsWith('data: ')) {
              const data = JSON.parse(line.slice(6))
              await handleSSEEvent(eventType, data, mcp)
              eventType = 'message'
            }
          }
        }
      } finally {
        clearInterval(watchdog)
      }
    } catch (err) {
      console.error(`SSE error, retry in ${retryDelay}ms:`, err)
      await sleep(retryDelay)
      retryDelay = Math.min(retryDelay * 2, 16000)
    }
  }
}

async function handleSSEEvent(type: string, data: any, mcp: Server) {
  if (type === 'message' && data.type === 'send_message') {
    await mcp.notification({
      method: 'notifications/claude/channel',
      params: {
        content: data.content,
        meta: { chat_id: data.chat_id },
      },
    })
  } else if (type === 'permission_response') {
    await mcp.notification({
      method: 'notifications/claude/channel/permission',
      params: {
        request_id: data.request_id,
        behavior: data.behavior,
      },
    })
  }
}

// --- MCP Server ---
const mcp = new Server(
  { name: 'spire', version: '0.1.0' },
  {
    capabilities: {
      experimental: {
        'claude/channel': {},
        'claude/channel/permission': {},
      },
      tools: {},
    },
    instructions:
      'Messages from the user\'s phone arrive as <channel source="spire" chat_id="...">. ' +
      'Respond normally — the user will see your response through the JSONL transcript.',
  },
)

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }))

const PermissionRequestSchema = z.object({
  method: z.literal('notifications/claude/channel/permission_request'),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string(),
    input_preview: z.string(),
  }),
})

mcp.setNotificationHandler(PermissionRequestSchema, async ({ params }) => {
  await fetch(`${RUST_SERVER}/api/bridges/permission_request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      port: listenPort,
      request_id: params.request_id,
      tool_name: params.tool_name,
      description: params.description,
      input_preview: params.input_preview,
    }),
  })
})

// --- Start ---
const listenPort = await findFreePort()
bridgeId = await register(listenPort)
connectSSE(listenPort, mcp)

await mcp.connect(new StdioServerTransport())
