/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope

self.addEventListener('push', (event: PushEvent) => {
  const data = event.data?.json()
  if (data?.type === 'permission_request') {
    event.waitUntil(
      self.registration.showNotification(`Claude: ${data.tool_name}`, {
        body: data.description,
        icon: '/icons/icon-192.png',
        data: { url: '/', ...data },
        requireInteraction: true,
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
