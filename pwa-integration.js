/* ============================================
   PWA INTEGRATION - COBRANÇA FÁCIL
   Conecta Service Worker + Notificações + Instalação
   ============================================ */

(function() {
  'use strict';

  /* ============================================
     1. REGISTRO DO SERVICE WORKER
     ============================================ */
  async function registrarServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      console.log('❌ Service Worker não suportado neste navegador');
      return null;
    }

    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/'
      });

      console.log('✅ Service Worker registrado:', registration.scope);

      // Aguarda o SW estar ativo
      if (registration.installing) {
        console.log('⏳ Service Worker instalando...');
      } else if (registration.waiting) {
        console.log('⏸️ Service Worker aguardando ativação...');
      } else if (registration.active) {
        console.log('✅ Service Worker ativo!');
      }

      // Escuta atualizações do SW
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        console.log('🔄 Nova versão do Service Worker encontrada!');

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // Nova versão disponível
            mostrarNotificacaoAtualizacao();
          }
        });
      });

      // Escuta mensagens do SW
      navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);

      // Registra Periodic Background Sync
      await registrarPeriodicSync(registration);

      return registration;

    } catch (error) {
      console.error('❌ Erro ao registrar Service Worker:', error);
      return null;
    }
  }

  /* ============================================
     2. PERIODIC BACKGROUND SYNC
     ============================================ */
  async function registrarPeriodicSync(registration) {
    if (!('periodicSync' in registration)) {
      console.log('⚠️ Periodic Background Sync não suportado');
      console.log('ℹ️ Usando Background Sync como fallback');
      await registrarBackgroundSyncFallback(registration);
      return;
    }

    try {
      // Verifica permissão
      const status = await navigator.permissions.query({
        name: 'periodic-background-sync'
      });

      if (status.state === 'granted') {
        await registration.periodicSync.register('verificar-cobrancas', {
          minInterval: 60 * 60 * 1000 // 1 hora
        });
        console.log('✅ Periodic Background Sync registrado!');
        console.log('⏰ Verificações automáticas a cada 1 hora');
      } else {
        console.log('⚠️ Permissão negada para Periodic Sync');
        await registrarBackgroundSyncFallback(registration);
      }

    } catch (error) {
      console.error('❌ Erro ao registrar Periodic Sync:', error);
      await registrarBackgroundSyncFallback(registration);
    }
  }

  /* ============================================
     3. BACKGROUND SYNC FALLBACK
     ============================================ */
  async function registrarBackgroundSyncFallback(registration) {
    if (!('sync' in registration)) {
      console.log('⚠️ Background Sync também não suportado');
      console.log('ℹ️ Usando verificação manual apenas');
      return;
    }

    try {
      await registration.sync.register('verificar-cobrancas-manual');
      console.log('✅ Background Sync (fallback) registrado!');
    } catch (error) {
      console.error('❌ Erro ao registrar Background Sync:', error);
    }
  }

  /* ============================================
     4. PERMISSÕES DE NOTIFICAÇÃO
     ============================================ */
  async function solicitarPermissaoNotificacao() {
    if (!('Notification' in window)) {
      console.log('❌ Notificações não suportadas');
      return false;
    }

    if (Notification.permission === 'granted') {
      console.log('✅ Permissão de notificação já concedida');
      return true;
    }

    if (Notification.permission === 'denied') {
      console.log('❌ Permissão de notificação negada');
      mostrarInstrucoesPerm issao();
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      
      if (permission === 'granted') {
        console.log('✅ Permissão de notificação concedida!');
        mostrarNotificacaoTeste();
        return true;
      } else {
        console.log('⚠️ Usuário negou permissão de notificação');
        return false;
      }
    } catch (error) {
      console.error('❌ Erro ao solicitar permissão:', error);
      return false;
    }
  }

  /* ============================================
     5. NOTIFICAÇÃO DE TESTE
     ============================================ */
  function mostrarNotificacaoTeste() {
    new Notification('🎉 Cobrança Fácil', {
      body: 'Notificações ativadas com sucesso!',
      icon: '/icon-192.png',
      badge: '/icon-badge.png',
      tag: 'teste-notificacao',
      vibrate: [200, 100, 200]
    });
  }

  /* ============================================
     6. COMUNICAÇÃO COM SERVICE WORKER
     ============================================ */
  function handleServiceWorkerMessage(event) {
    console.log('📨 Mensagem do Service Worker:', event.data);

    const { tipo, dados } = event.data;

    switch (tipo) {
      case 'VERIFICAR_ALARME':
        // Atualiza badge e interface
        if (typeof almVerificar === 'function') {
          almVerificar();
        }
        break;

      case 'BUSCAR_CONFIG_ALARMES':
        // Retorna configurações dos alarmes
        enviarConfiguracoesParaSW(event.ports[0]);
        break;

      case 'BUSCAR_CLIENTES_ATRASADOS':
        // Retorna clientes em atraso
        enviarClientesAtrasadosParaSW(event.ports[0]);
        break;

      default:
        console.log('Tipo de mensagem desconhecido:', tipo);
    }
  }

  /* ============================================
     7. ENVIA DADOS PARA SERVICE WORKER
     ============================================ */
  function enviarConfiguracoesParaSW(port) {
    try {
      const config = JSON.parse(localStorage.getItem('cf_alm_cfg') || '{}');
      port.postMessage(config);
    } catch (error) {
      console.error('Erro ao enviar config:', error);
      port.postMessage(null);
    }
  }

  function enviarClientesAtrasadosParaSW(port) {
    try {
      const clientes = JSON.parse(localStorage.getItem('cf_clients') || '[]');
      const hoje = new Date().setHours(0, 0, 0, 0);
      
      const atrasados = clientes.filter(cliente => {
        const totalPendente = (cliente.debitos || [])
          .filter(d => d.status === 'pendente')
          .reduce((sum, d) => sum + (parseFloat(d.valor) || 0), 0);
        
        if (totalPendente <= 0) return false;
        
        const temVencido = (cliente.debitos || []).some(d => {
          if (d.status !== 'pendente') return false;
          const venc = new Date(d.vencimento).setHours(0, 0, 0, 0);
          return venc < hoje;
        });
        
        return temVencido;
      });
      
      port.postMessage(atrasados);
    } catch (error) {
      console.error('Erro ao buscar clientes atrasados:', error);
      port.postMessage([]);
    }
  }

  /* ============================================
     8. PROMPT DE INSTALAÇÃO PWA
     ============================================ */
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    console.log('💾 Prompt de instalação disponível');
    e.preventDefault();
    deferredPrompt = e;
    mostrarBotaoInstalar();
  });

  function mostrarBotaoInstalar() {
    // Cria botão de instalação se não existir
    if (document.getElementById('pwa-install-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'pwa-install-btn';
    btn.innerHTML = '📲 Instalar App';
    btn.style.cssText = `
      position: fixed;
      top: 80px;
      right: 20px;
      background: #c9a84c;
      color: #000;
      border: none;
      padding: 12px 20px;
      border-radius: 25px;
      font-weight: 700;
      font-size: 14px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(201, 168, 76, 0.4);
      z-index: 9999;
      animation: pulse 2s infinite;
    `;

    btn.addEventListener('click', instalarPWA);
    document.body.appendChild(btn);

    // Remove após 10 segundos se não clicar
    setTimeout(() => {
      btn.style.animation = 'fadeOut 0.5s forwards';
      setTimeout(() => btn.remove(), 500);
    }, 10000);
  }

  async function instalarPWA() {
    if (!deferredPrompt) {
      console.log('⚠️ Prompt de instalação não disponível');
      return;
    }

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    console.log(`Usuário ${outcome === 'accepted' ? 'aceitou' : 'recusou'} a instalação`);

    if (outcome === 'accepted') {
      showToast('✅ App instalado com sucesso!');
    }

    deferredPrompt = null;
    document.getElementById('pwa-install-btn')?.remove();
  }

  window.addEventListener('appinstalled', () => {
    console.log('🎉 PWA instalado com sucesso!');
    showToast('✅ Cobrança Fácil instalado!');
  });

  /* ============================================
     9. NOTIFICAÇÃO DE ATUALIZAÇÃO
     ============================================ */
  function mostrarNotificacaoAtualizacao() {
    const banner = document.createElement('div');
    banner.innerHTML = `
      <div style="
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: #0d0d0d;
        border: 1px solid #c9a84c;
        border-radius: 16px;
        padding: 16px 20px;
        display: flex;
        align-items: center;
        gap: 12px;
        box-shadow: 0 10px 30px rgba(201, 168, 76, 0.3);
        z-index: 99999;
        animation: slideDown 0.5s ease-out;
      ">
        <span style="font-size: 24px;">🔄</span>
        <div style="flex: 1;">
          <div style="font-weight: 700; color: #c9a84c; margin-bottom: 4px;">
            Nova versão disponível!
          </div>
          <div style="font-size: 12px; color: #888;">
            Recarregue para atualizar
          </div>
        </div>
        <button onclick="location.reload()" style="
          background: #c9a84c;
          color: #000;
          border: none;
          padding: 8px 16px;
          border-radius: 20px;
          font-weight: 700;
          cursor: pointer;
        ">
          Atualizar
        </button>
      </div>
    `;
    document.body.appendChild(banner);
  }

  /* ============================================
     10. INSTRUÇÕES DE PERMISSÃO
     ============================================ */
  function mostrarInstrucoesPermissao() {
    alert(
      '⚠️ Notificações Bloqueadas\n\n' +
      'Para receber alertas de pagamentos em atraso:\n\n' +
      '1. Clique no ícone 🔒 ou ℹ️ ao lado do endereço\n' +
      '2. Localize "Notificações"\n' +
      '3. Selecione "Permitir"\n' +
      '4. Recarregue a página'
    );
  }

  /* ============================================
     11. VERIFICAÇÃO PERIÓDICA MANUAL
     Para navegadores sem Periodic Sync
     ============================================ */
  function iniciarVerificacaoManual() {
    // Verifica a cada 15 minutos quando o app está aberto
    setInterval(() => {
      if (document.visibilityState === 'visible') {
        console.log('🔍 Verificação manual de alarmes');
        if (typeof almVerificar === 'function') {
          almVerificar();
        }
      }
    }, 15 * 60 * 1000); // 15 minutos
  }

  /* ============================================
     12. INICIALIZAÇÃO
     ============================================ */
  async function inicializarPWA() {
    console.log('🚀 Inicializando PWA...');

    // 1. Registra Service Worker
    const registration = await registrarServiceWorker();

    if (!registration) {
      console.log('⚠️ PWA não disponível - funcionando em modo básico');
      return;
    }

    // 2. Solicita permissão de notificações (apenas se alarmes ativos)
    const config = JSON.parse(localStorage.getItem('cf_alm_cfg') || '{}');
    if (config.ativo && config.notificacoes) {
      setTimeout(() => solicitarPermissaoNotificacao(), 2000);
    }

    // 3. Inicia verificação manual (fallback)
    iniciarVerificacaoManual();

    console.log('✅ PWA inicializado com sucesso!');
  }

  /* ============================================
     EXECUÇÃO AUTOMÁTICA
     ============================================ */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializarPWA);
  } else {
    inicializarPWA();
  }

  // Exporta funções globais
  window.PWA = {
    instalar: instalarPWA,
    solicitarNotificacoes: solicitarPermissaoNotificacao,
    registrarPeriodicSync: registrarPeriodicSync
  };

})();
