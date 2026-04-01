import type { TranscriptEntry } from './types'

/** 디버깅용: 체크한 메시지들의 원본 데이터를 콘솔에 묶어서 출력 */
class DebugSelection {
  private selected = new Map<string, TranscriptEntry>()

  toggle(entry: TranscriptEntry, checked: boolean) {
    if (checked) {
      this.selected.set(entry.uuid, entry)
    } else {
      this.selected.delete(entry.uuid)
    }
    this.print()
  }

  private print() {
    if (this.selected.size === 0) {
      console.clear()
      return
    }
    console.clear()
    const entries = Array.from(this.selected.values())
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    console.group(`🔍 Selected messages (${entries.length})`)
    for (const e of entries) {
      console.log(`[${e.type}] ${e.uuid}`, e)
    }
    console.groupEnd()
  }
}

export const debugSelection = new DebugSelection()
