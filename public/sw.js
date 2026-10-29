/**
 * FatosBR — Service Worker Oficial
 * Suporte a Web Push API, Background Notifications (Breaking News) e PWA Offline Caching
 */

const CACHE_NAME = 'fatosbr-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/logo-fatosbr.svg',
  '/pwa-icon-192.png',
  '/pwa-icon-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) => {
        return Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        );
      })
    ])
  );
});

// Suporte a Web Push do Navegador mesmo em Segundo Plano
self.addEventListener('push', (event) => {
  let payload = {
    title: 'FatosBR • Notícia Urgente',
    body: 'Novo acontecimento crítico monitorado pela inteligência analítica.',
    url: '/',
    tag: 'fatosbr-breaking-news',
    category: 'URGENTE',
    timestamp: new Date().toISOString()
  };

  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      payload.body = event.data.text() || payload.body;
    }
  }

  const notificationOptions = {
    body: payload.body,
    icon: '/pwa-icon-192.png',
    badge: '/logo-fatosbr.svg',
    tag: payload.tag || `fatosbr-push-${Date.now()}`,
    data: {
      url: payload.url || '/',
      eventId: payload.eventId
    },
    vibrate: [200, 100, 200, 100, 200],
    requireInteraction: true,
    actions: [
      { action: 'open', title: 'Abrir no FatosBR' },
      { action: 'dismiss', title: 'Fechar' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, notificationOptions)
  );
});

// Manipulador de clique na notificação em segundo plano
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          if (client.url.includes(targetUrl)) {
            return client.focus();
          }
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
