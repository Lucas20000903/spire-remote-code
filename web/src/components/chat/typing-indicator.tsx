import { useState, useEffect, useRef } from 'react'

const SPIRE_FRAMES = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢']

const SPIRE_VERBS = [
  'Watching clouds drift below',     // 구름이 아래로 흘러가는 걸 보는 중
  'Feeling the wind shift',          // 바람이 바뀌는 걸 느끼는 중
  'Listening to distant bells',      // 먼 종소리에 귀 기울이는 중
  'Tracing constellations',          // 별자리를 따라가는 중
  'Catching the first light',        // 첫 빛을 맞이하는 중
  'Breathing the thin air',          // 얇은 공기를 들이마시는 중
  'Counting the city lights',        // 도시의 불빛을 세는 중
  'Watching storms approach',        // 폭풍이 다가오는 걸 지켜보는 중
  'Touching the cold stone',         // 차가운 돌을 만지는 중
  'Hearing echoes rise',             // 메아리가 올라오는 걸 듣는 중
]

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`
}

interface TypingIndicatorProps {
  isActive: boolean
}

export function TypingIndicator({ isActive }: TypingIndicatorProps) {
  const [frameIdx, setFrameIdx] = useState(0)
  const [verbIdx, setVerbIdx] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const startTime = useRef(Date.now())

  // 새로 active 될 때 타이머 리셋
  useEffect(() => {
    if (isActive) {
      startTime.current = Date.now()
      setElapsed(0)
      setVerbIdx(0)
    }
  }, [isActive])

  // 심볼 애니메이션: 150ms (active일 때만)
  useEffect(() => {
    if (!isActive) return
    const interval = setInterval(() => {
      setFrameIdx((i) => (i + 1) % SPIRE_FRAMES.length)
    }, 150)
    return () => clearInterval(interval)
  }, [isActive])

  // 메시지 전환: 3초 (active일 때만)
  useEffect(() => {
    if (!isActive) return
    const interval = setInterval(() => {
      setVerbIdx((i) => (i + 1) % SPIRE_VERBS.length)
    }, 3000)
    return () => clearInterval(interval)
  }, [isActive])

  // 경과 시간: 1초 간격
  useEffect(() => {
    if (!isActive) return
    const interval = setInterval(() => {
      setElapsed(Date.now() - startTime.current)
    }, 1000)
    return () => clearInterval(interval)
  }, [isActive])

  if (!isActive && elapsed === 0) return null

  const showTimer = elapsed >= 10000

  // 완료 상태: 총 소요 시간만 표시
  if (!isActive) {
    return showTimer ? (
      <div className="flex items-center gap-2.5 text-[13px] text-muted-foreground py-1">
        <span className="text-foreground font-medium">{formatElapsed(elapsed)}</span>
        <span>소요됨</span>
      </div>
    ) : null
  }

  // 진행 중
  return (
    <div className="flex h-10 items-center gap-2.5 text-sm animate-[spire-pulse_2s_ease-in-out_infinite]">
      <span className="w-4 shrink-0 text-center font-light">{SPIRE_FRAMES[frameIdx]}</span>
      <span className="truncate">{SPIRE_VERBS[verbIdx]}</span>
      {showTimer && (
        <span className="shrink-0 opacity-60 text-xs">({formatElapsed(elapsed)})</span>
      )}
    </div>
  )
}
