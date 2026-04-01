import { useWebSocket } from '@/hooks/use-websocket'

export function ConnectionBanner() {
  const { status } = useWebSocket()
  if (status === 'connected') return null
  return (
    <div className="bg-yellow-500 text-center text-sm text-white py-1">
      {status === 'connecting' ? '연결 중...' : '연결 끊김 — 재연결 중...'}
    </div>
  )
}
