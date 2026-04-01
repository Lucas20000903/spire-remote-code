import { useState, useCallback } from 'react'

export interface Settings {
  notificationsEnabled: boolean
}

const DEFAULTS: Settings = { notificationsEnabled: true }
const STORAGE_KEY = 'spire-settings'

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(load)

  const updateSetting = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  return { settings, updateSetting }
}
