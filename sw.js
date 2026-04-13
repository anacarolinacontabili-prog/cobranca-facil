const CACHE_NAME = 'cobranca-cache-v2';
const ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

// ── INSTALL ──────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ─────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH ────────────────────────────────────
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});

// ── NOTIFICAÇÕES PUSH ────────────────────────
self.addEventListener('push', event => {
  const data = event.data
    ? event.data.json()
    : { title: '🔔 Cobrança Fácil', body: 'Clientes em atraso!' };

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body   : data.body,
      icon   : './icon-192.png',
      badge  : './icon-192.png',
      vibrate: [200, 100, 200, 100, 400],
      tag    : 'cf-alarme',
      requireInteraction: true,
      actions: [
        { action: 'ver',     title: '👁️ Ver detalhes' },
        { action: 'fechar',  title: '✕ Fechar'        }
      ]
    })
  );
});

// ── CLIQUE NA NOTIFICAÇÃO ────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'ver' || !event.action) {
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then(clientList => {
        // Se já tem janela aberta, foca nela
        for (const client of clientList) {
          if (client.url.includes('index.html') && 'focus' in client) {
            return client.focus();
          }
        }
        // Senão abre nova janela
        if (clients.openWindow) {
          return clients.openWindow('./index.html#alarmes');
        }
      })
    );
  }
});

// ── MENSAGENS DO APP ─────────────────────────
self.addEventListener('message', event => {
  const { tipo, dados } = event.data || {};

  // App pediu para mostrar notificação
  if (tipo === 'MOSTRAR_NOTIFICACAO') {
    const qtd   = dados?.qtd   || 0;
    const nomes = dados?.nomes || [];

    self.registration.showNotification(
      `🔔 ${qtd} cliente(s) em atraso!`, {
        body   : nomes.slice(0, 3).join(', ') +
                 (nomes.length > 3
                   ? ` +${nomes.length - 3} mais`
                   : ''),
        icon   : './icon-192.png',
        badge  : './icon-192.png',
        vibrate: [200, 100, 200, 100, 400],
        tag    : 'cf-alarme',
        requireInteraction: true,
        actions: [
          { action: 'ver',    title: '👁️ Ver detalhes' },
          { action: 'fechar', title: '✕ Fechar'        }
        ]
      }
    );
  }

  // App pediu para agendar alarme
  if (tipo === 'AGENDAR_ALARME') {
    console.log('⏰ Alarme agendado:', dados);
  }
});

// ── SYNC EM SEGUNDO PLANO ────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'cf-verificar-alarme') {
    event.waitUntil(verificarAlarmeBackground());
  }
});

async function verificarAlarmeBackground() {
  const clientList = await clients.matchAll({ type: 'window' });
  for (const client of clientList) {
    client.postMessage({ tipo: 'VERIFICAR_ALARME' });
  }
}
