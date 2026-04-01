export function OfflinePage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground p-4">
      <div className="text-4xl mb-4">📡</div>
      <h1 className="text-xl font-bold mb-2">Mac에 연결할 수 없습니다</h1>
      <p className="text-muted-foreground text-center">
        네트워크 연결을 확인하거나 Mac이 켜져 있는지 확인해주세요.
        <br />
        자동으로 재연결을 시도합니다.
      </p>
    </div>
  )
}
