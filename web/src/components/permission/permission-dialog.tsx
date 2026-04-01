import { useCallback, useEffect, useState } from 'react'
import { useWebSocket } from '@/hooks/use-websocket'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { WsServerMessage } from '@/lib/types'

interface PermissionRequest {
  session_id: string
  request_id: string
  tool_name: string
  description: string
  input_preview: string
}

export function PermissionDialog() {
  const { send, onMessage } = useWebSocket()
  const [queue, setQueue] = useState<PermissionRequest[]>([])

  useEffect(() => {
    const unsub = onMessage((msg: WsServerMessage) => {
      if (msg.type === 'permission_request') {
        setQueue((prev) => [
          ...prev,
          {
            session_id: msg.session_id,
            request_id: msg.request_id,
            tool_name: msg.tool_name,
            description: msg.description,
            input_preview: msg.input_preview,
          },
        ])
      }
    })
    return unsub
  }, [onMessage])

  const current = queue[0] ?? null

  const respond = useCallback(
    (behavior: 'allow' | 'deny') => {
      if (!current) return
      send({
        type: 'permission_response',
        session_id: current.session_id,
        request_id: current.request_id,
        behavior,
      })
      setQueue((prev) => prev.slice(1))
    },
    [current, send],
  )

  return (
    <Dialog open={current !== null}>
      <DialogContent showCloseButton={false}>
        {current && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                Permission Request
                <Badge variant="outline" className="font-mono text-xs">
                  {current.tool_name}
                </Badge>
              </DialogTitle>
              <DialogDescription>{current.description}</DialogDescription>
            </DialogHeader>

            {current.input_preview && (
              <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed">
                {current.input_preview}
              </pre>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => respond('deny')}>
                Deny
              </Button>
              <Button onClick={() => respond('allow')}>Allow</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
