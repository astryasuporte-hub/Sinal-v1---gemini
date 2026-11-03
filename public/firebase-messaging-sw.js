/**
 * FatosBR — Firebase Cloud Messaging & Web Push Service Worker Oficial
 * Permite receber alertas de Breaking News mesmo com o navegador fechado.
 */

// Scripts compatíveis do Firebase para Web Push
try {
  importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

  const firebaseConfig = {
    apiKey: "AIzaSyFakeKeyForFCMStandardWebPush",
    authDomain: "fatosbr-noticias.firebaseapp.com",
    projectId: "fatosbr-noticias",
    storageBucket: "fatosbr-noticias.appspot.com",
    messagingSenderId: "479989669402",
    appId: "1:479989669402:web:fatosbrwebpush"
  };

  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    console.log('[FatosBR FCM] Mensagem em segundo plano recebida:', payload);
    const notificationTitle = payload.notification?.title || payload.data?.title || 'FatosBR • Notícia Urgente';
    const notificationOptions = {
      body: payload.notification?.body || payload.data?.body || 'Novo acontecimento crítico monitorado em tempo real.',
      icon: '/pwa-icon-192.png',
      badge: '/logo-fatosbr.svg',
      tag: payload.data?.tag || `fatosbr-breaking-${Date.now()}`,
      data: {
        url: payload.data?.url || '/',
        eventId: payload.data?.eventId
      },
      vibrate: [200, 100, 200, 100, 200],
      requireInteraction: true,
      actions: [
        { action: 'open', title: 'Abrir no FatosBR' },
        { action: 'dismiss', title: 'Fechar' }
      ]
    };

    return self.registration.showNotification(notificationTitle, notificationOptions);
  });
} catch (err) {
  console.info('[FatosBR FCM] Modo de compatibilidade nativa Web Push ativo');
}

// Fallback nativo do protocolo W3C Web Push (garante funcionamento offline e em background)
self.addEventListener('push', (event) => {
  let payload = {
    title: 'FatosBR • Breaking News',
    body: 'Acontecimento com alta repercussão identificado nos principais veículos.',
    url: '/',
    tag: `fatosbr-push-${Date.now()}`,
    category: 'URGENTE'
  };

  if (event.data) {
    try {
      const json = event.data.json();
      payload = {
        title: json.title || json.notification?.title || payload.title,
        body: json.body || json.notification?.body || payload.body,
        url: json.url || json.data?.url || '/',
        tag: json.tag || payload.tag,
        eventId: json.eventId || json.data?.eventId
      };
    } catch {
      payload.body = event.data.text() || payload.body;
    }
  }

  const notificationOptions = {
    body: payload.body,
    icon: '/pwa-icon-192.png',
    badge: '/logo-fatosbr.svg',
    tag: payload.tag,
    data: {
      url: payload.url,
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
          if (client.url.includes(targetUrl) || client.url.endsWith('/')) {
            client.navigate(targetUrl);
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
