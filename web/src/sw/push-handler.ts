/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope

self.addEventListener('push', (event: PushEvent) => {
  const data = event.data?.json()
  if (data?.type === 'message') {
    event.waitUntil(
      self.registration.showNotification('Spire', {
        body: data.text || 'New message',
        icon: '/icons/icon-192.png',
        data: { url: '/', ...data },
      })
    )
  }
})

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()
  event.waitUntil(
    self.clients.openWindow(event.notification.data?.url || '/')
  )
})
