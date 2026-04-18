/* ============================================
   SERVICE WORKER - COBRANÇA FÁCIL
   Notificações em Background + Cache Offline
   ============================================ */

const CACHE_NAME = 'cobranca-facil-v1.0.0';
const RUNTIME_CACHE = 'cobranca-facil-runtime';

// Arquivos para cache offline
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

/* ============================================
   1. INSTALAÇÃO - Cache inicial
   ============================================ */
self.addEventListener('install', event => {
  console.log('🔧 Service Worker: Instalando...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('📦 Cache: Armazenando arquivos');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('✅ Service Worker: Instalado com sucesso!');
        // Força ativação imediata
        return self.skipWaiting();
      })
      .catch(err => {
        console.error('❌ Erro ao instalar SW:', err);
      })
  );
});

/* ============================================
   2. ATIVAÇÃO - Limpa cache antigo
   ============================================ */
self.addEventListener('activate', event => {
  console.log('🔄 Service Worker: Ativando...');
  
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(name => name !== CACHE_NAME && name !== RUNTIME_CACHE)
            .map(name => {
              console.log('🗑️ Cache: Removendo versão antiga:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('✅ Service Worker: Ativado!');
        // Assume controle de todas as páginas imediatamente
        return self.clients.claim();
      })
  );
});

/* ============================================
   3. FETCH - Estratégia Cache First
   ============================================ */
self.addEventListener('fetch', event => {
  // Ignora requisições não-GET
  if (event.request.method !== 'GET') return;
  
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        
        return fetch(event.request)
          .then(response => {
            // Não cacheia se não for OK
            if (!response || response.status !== 200 || response.type === 'error') {
              return response;
            }
            
            // Clona a resposta
            const responseToCache = response.clone();
            
            caches.open(RUNTIME_CACHE)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });
            
            return response;
          });
      })
      .catch(() => {
        // Fallback offline
        return caches.match('/');
      })
  );
});

/* ============================================
   4. PERIODIC BACKGROUND SYNC
   Verifica alarmes a cada 1 hora
   ============================================ */
self.addEventListener('periodicsync', event => {
  console.log('⏰ Periodic Sync disparado:', event.tag);
  
  if (event.tag === 'verificar-cobrancas') {
    event.waitUntil(verificarAlarmesAgendados());
  }
});

/* ============================================
   5. SYNC - Fallback para navegadores sem Periodic Sync
   ============================================ */
self.addEventListener('sync', event => {
  console.log('🔄 Background Sync disparado:', event.tag);
  
  if (event.tag === 'verificar-cobrancas-manual') {
    event.waitUntil(verificarAlarmesAgendados());
  }
});

/* ============================================
   6. MENSAGENS - Comunicação com a página
   ============================================ */
self.addEventListener('message', event => {
  console.log('📨 Mensagem recebida:', event.data);
  
  const { tipo, dados } = event.data;
  
  switch (tipo) {
    case 'VERIFICAR_ALARME':
      verificarAlarmesAgendados();
      break;
      
    case 'MOSTRAR_NOTIFICACAO':
      mostrarNotificacao(dados);
      break;
      
    case 'REGISTRAR_PERIODIC_SYNC':
      registrarPeriodicSync();
      break;
      
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
      
    default:
      console.log('Tipo de mensagem desconhecido:', tipo);
  }
});

/* ============================================
   7. NOTIFICAÇÕES - Clique do usuário
   ============================================ */
self.addEventListener('notificationclick', event => {
  console.log('🔔 Notificação clicada:', event.notification.tag);
  
  event.notification.close();
  
  // Abre/foca o app
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        // Se já tem uma janela aberta, foca nela
        for (let client of clientList) {
          if (client.url.includes('cobrancafacil') && 'focus' in client) {
            return client.focus();
          }
        }
        // Senão, abre nova janela
        if (clients.openWindow) {
          return clients.openWindow('/');
        }
      })
  );
});

/* ============================================
   FUNÇÕES AUXILIARES
   ============================================ */

/**
 * Verifica se é hora de disparar alarmes
 */
async function verificarAlarmesAgendados() {
  console.log('🔍 Verificando alarmes agendados...');
  
  try {
    // Busca configurações do localStorage via client
    const config = await buscarConfiguracoesDoCliente();
    
    if (!config || !config.ativo) {
      console.log('⏸️ Sistema de alarmes desativado');
      return;
    }
    
    const agora = new Date();
    const diaSemana = agora.getDay(); // 0=Dom, 1=Seg, ..., 6=Sáb
    const hora = agora.getHours();
    const minuto = agora.getMinutes();
    
    // Verifica se é um dos dias agendados
    const diasAtivos = config.dias || [1, 5]; // Segunda e Sexta por padrão
    
    if (!diasAtivos.includes(diaSemana)) {
      console.log('📅 Hoje não é dia de alarme');
      return;
    }
    
    // Verifica horário (com margem de 1 hora)
    const [horaAlarme, minutoAlarme] = (config.horario || '09:00').split(':').map(Number);
    
    if (hora === horaAlarme && minuto >= minutoAlarme && minuto < minutoAlarme + 60) {
      console.log('⏰ É HORA DO ALARME!');
      
      // Busca clientes em atraso
      const clientesAtrasados = await buscarClientesAtrasados();
      
      if (clientesAtrasados && clientesAtrasados.length > 0) {
        await mostrarNotificacao({
          qtd: clientesAtrasados.length,
          nomes: clientesAtrasados.map(c => c.nome)
        });
        
        // Envia mensagem para a página atualizar o badge
        notificarClientes();
      } else {
        console.log('✅ Nenhum cliente em atraso');
      }
    } else {
      console.log(`⏰ Ainda não é hora (agora: ${hora}:${minuto}, alarme: ${horaAlarme}:${minutoAlarme})`);
    }
    
  } catch (error) {
    console.error('❌ Erro ao verificar alarmes:', error);
  }
}

/**
 * Mostra notificação do navegador
 */
async function mostrarNotificacao({ qtd, nomes }) {
  console.log('🔔 Mostrando notificação:', qtd, 'clientes');
  
  const titulo = qtd === 1 
    ? '🚨 1 Cliente em Atraso!' 
    : `🚨 ${qtd} Clientes em Atraso!`;
  
  const corpo = qtd === 1
    ? nomes[0]
    : `${nomes.slice(0, 3).join(', ')}${qtd > 3 ? ` e mais ${qtd - 3}...` : ''}`;
  
  const opcoes = {
    body: corpo,
    icon: '/icon-192.png',
    badge: '/icon-badge.png',
    tag: 'cobranca-atraso',
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 200],
    data: {
      url: '/',
      timestamp: Date.now()
    },
    actions: [
      {
        action: 'ver',
        title: '👁️ Ver Detalhes'
      },
      {
        action: 'silenciar',
        title: '🔕 Silenciar'
      }
    ]
  };
  
  try {
    await self.registration.showNotification(titulo, opcoes);
    console.log('✅ Notificação mostrada com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao mostrar notificação:', error);
  }
}

/**
 * Busca configurações do app via mensagem para o cliente
 */
async function buscarConfiguracoesDoCliente() {
  const clients = await self.clients.matchAll({ type: 'window' });
  
  if (clients.length === 0) {
    console.log('⚠️ Nenhum cliente conectado');
    return null;
  }
  
  // Envia mensagem para o primeiro cliente
  return new Promise((resolve) => {
    const messageChannel = new MessageChannel();
    
    messageChannel.port1.onmessage = (event) => {
      resolve(event.data);
    };
    
    clients[0].postMessage(
      { tipo: 'BUSCAR_CONFIG_ALARMES' },
      [messageChannel.port2]
    );
    
    // Timeout de 5 segundos
    setTimeout(() => resolve(null), 5000);
  });
}

/**
 * Busca clientes em atraso via mensagem para o cliente
 */
async function buscarClientesAtrasados() {
  const clients = await self.clients.matchAll({ type: 'window' });
  
  if (clients.length === 0) {
    console.log('⚠️ Nenhum cliente conectado');
    return [];
  }
  
  return new Promise((resolve) => {
    const messageChannel = new MessageChannel();
    
    messageChannel.port1.onmessage = (event) => {
      resolve(event.data || []);
    };
    
    clients[0].postMessage(
      { tipo: 'BUSCAR_CLIENTES_ATRASADOS' },
      [messageChannel.port2]
    );
    
    // Timeout de 5 segundos
    setTimeout(() => resolve([]), 5000);
  });
}

/**
 * Notifica todos os clientes para atualizar o badge
 */
async function notificarClientes() {
  const clients = await self.clients.matchAll({ type: 'window' });
  
  clients.forEach(client => {
    client.postMessage({
      tipo: 'VERIFICAR_ALARME'
    });
  });
}

/**
 * Registra Periodic Background Sync
 */
async function registrarPeriodicSync() {
  try {
    const status = await self.registration.periodicSync.getTags();
    
    if (!status.includes('verificar-cobrancas')) {
      await self.registration.periodicSync.register('verificar-cobrancas', {
        minInterval: 60 * 60 * 1000 // 1 hora
      });
      console.log('✅ Periodic Sync registrado!');
    } else {
      console.log('ℹ️ Periodic Sync já está registrado');
    }
  } catch (error) {
    console.error('❌ Erro ao registrar Periodic Sync:', error);
  }
}

/* ============================================
   INICIALIZAÇÃO
   ============================================ */
console.log('🚀 Service Worker carregado!');
