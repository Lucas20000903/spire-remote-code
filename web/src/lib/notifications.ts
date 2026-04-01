export async function requestPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  const result = await Notification.requestPermission()
  return result === 'granted'
}

export function showNotification(title: string, body?: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  try {
    new Notification(title, {
      body,
      icon: '/favicon.svg',
      tag: 'spire-session',
    })
  } catch {
    // Fallback for environments that don't support Notification constructor
  }
}
