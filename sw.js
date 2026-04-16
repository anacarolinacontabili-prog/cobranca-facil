/* ================================================
   SERVICE WORKER — Cobrança Fácil
   Versão 2.0
   ================================================ */

const CACHE_NAME = 'cobranca-cache-v2';
const ARQUIVOS_CACHE = [
  './',
  './index.html',
  './manifest.json'
];

/* ── INSTALL: guarda arquivos no cache ─────────── */
self.addEventListener('install', function(event) {
  console.log('[SW] Instalando...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(ARQUIVOS_CACHE);
    })
  );
  // Ativa imediatamente sem esperar aba fechar
  self.skipWaiting();
});

/* ── ACTIVATE: limpa caches antigos ────────────── */
self.addEventListener('activate', function(event) {
  console.log('[SW] Ativando...');
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cache) {
          if (cache !== CACHE_NAME) {
            console.log('[SW] Removendo cache antigo:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(function() {
      // Assume controle de todas as abas abertas
      return self.clients.claim();
    })
  );
});

/* ── FETCH: responde com cache ou rede ─────────── */
self.addEventListener('fetch', function(event) {
  event.respondWith(
    caches.match(event.request).then(function(response) {
      return response || fetch(event.request);
    })
  );
});

/* ── MESSAGE: recebe ordens do app ─────────────── */
/*
  O app envia mensagens com:
    { tipo: 'MOSTRAR_NOTIFICACAO', dados: { qtd, nomes } }
    { tipo: 'AGENDAR_ALARME', dados: { timestamp, qtd, nomes } }
    { tipo: 'CANCELAR_ALARME' }
    { tipo: 'VERIFICAR_AGORA' }
*/
self.addEventListener('message', function(event) {
  const msg = event.data;
  if (!msg || !msg.tipo) return;

  console.log('[SW] Mensagem recebida:', msg.tipo);

  switch (msg.tipo) {

    /* Mostra notificação imediatamente */
    case 'MOSTRAR_NOTIFICACAO':
      mostrarNotificacao(msg.dados);
      break;

    /* Agenda um alarme futuro via setTimeout interno */
    case 'AGENDAR_ALARME':
      agendarAlarme(msg.dados);
      break;

    /* Cancela alarme agendado */
    case 'CANCELAR_ALARME':
      cancelarAlarme();
      break;

    /* App pede para SW avisar o app para verificar agora */
    case 'VERIFICAR_AGORA':
      avisarApp('VERIFICAR_ALARME');
      break;
  }
});

/* ── NOTIFICATION CLICK: usuário tocou na notificação ── */
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  const action = event.action;

  if (action === 'ver') {
    // Abre/foca o app e vai para aba de alarmes
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(function(clients) {
        // Se já tem o app aberto, foca
        for (const client of clients) {
          if ('focus' in client) {
            client.focus();
            client.postMessage({ tipo: 'IR_PARA_ALARMES' });
            return;
          }
        }
        // Senão abre nova janela
        if (self.clients.openWindow) {
          return self.clients.openWindow('./');
        }
      })
    );
  }

  if (action === 'silenciar') {
    // Avisa o app para silenciar hoje
    avisarApp('SILENCIAR_HOJE');
  }
});

/* ── NOTIFICATION CLOSE: usuário dispensou ─────── */
self.addEventListener('notificationclose', function(event) {
  console.log('[SW] Notificação dispensada');
});

/* ================================================
   FUNÇÕES AUXILIARES
   ================================================ */

/* Mostra a notificação de cobrança */
function mostrarNotificacao(dados) {
  const qtd   = dados?.qtd   || 0;
  const nomes = dados?.nomes || [];

  if (qtd === 0) return;

  // Monta texto da notificação
  const titulo = '🚨 Cobrança Fácil — ' + qtd + ' cliente(s) em atraso';
  let corpo;

  if (nomes.length === 1) {
    corpo = nomes[0] + ' está com pagamento pendente.';
  } else if (nomes.length === 2) {
    corpo = nomes[0] + ' e ' + nomes[1] + ' estão com pagamentos pendentes.';
  } else if (nomes.length <= 4) {
    corpo = nomes.slice(0, -1).join(', ') + ' e ' + nomes[nomes.length - 1] + '.';
  } else {
    corpo = nomes.slice(0, 3).join(', ') + ' e mais ' + (nomes.length - 3) + ' outros.';
  }

  const opcoes = {
    body   : corpo,
    icon   : './icon-192.png',
    badge  : './icon-badge.png',
    tag    : 'cobranca-alerta',          // substitui notificação anterior
    renotify: true,                       // vibra mesmo se tag igual
    vibrate: [200, 100, 200, 100, 200],
    requireInteraction: true,             // não some sozinha no Android
    data   : { qtd, nomes, timestamp: Date.now() },
    actions: [
      { action: 'ver',       title: '📋 Ver lista'    },
      { action: 'silenciar', title: '🔕 Silenciar hoje' }
    ]
  };

  return self.registration.showNotification(titulo, opcoes);
}

/* ── Agendamento interno via setTimeout ─────────
   IMPORTANTE: O SW pode ser encerrado pelo sistema
   operacional a qualquer momento. Por isso este
   agendamento é um BACKUP — o app principal já
   verifica via setInterval. Mas enquanto o SW
   estiver ativo (ex: tela bloqueada, app em background
   no Android), este timer vai funcionar.
   ─────────────────────────────────────────────── */
let alarmeTimer = null;

function agendarAlarme(dados) {
  cancelarAlarme(); // cancela anterior se houver

  const agora      = Date.now();
  const timestamp  = dados?.timestamp || agora;
  const delay      = timestamp - agora;

  if (delay <= 0) {
    console.log('[SW] Horário já passou, ignorando agendamento');
    return;
  }

  console.log('[SW] Alarme agendado em', Math.round(delay / 60000), 'minutos');

  alarmeTimer = setTimeout(function() {
    // Pede para o app verificar atrasados
    avisarApp('VERIFICAR_ALARME');
    alarmeTimer = null;
  }, delay);
}

function cancelarAlarme() {
  if (alarmeTimer !== null) {
    clearTimeout(alarmeTimer);
    alarmeTimer = null;
    console.log('[SW] Alarme cancelado');
  }
}

/* Envia mensagem para todas as abas abertas do app */
function avisarApp(tipo) {
  self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(function(clients) {
      clients.forEach(function(client) {
        client.postMessage({ tipo: tipo });
      });
    });
}
