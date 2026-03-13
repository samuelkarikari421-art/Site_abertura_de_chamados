// ==========================================
// 1. CONFIGURAÇÕES E VARIAVEIS GLOBAIS
// ==========================================
const SERVIDOR_IP = "http://192.168.100.132:3000"; // IP Fixo
const API_BASE_URL = `${SERVIDOR_IP}/api`;
const socketGlobal = io(SERVIDOR_IP);

let notificacoes = [];
let naoLidas = 0;

// ==========================================
// 2. INICIALIZAÇÃO
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    // Carrega tema
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') document.body.classList.add('dark-mode');
    
    // Botão de tema na Home
    const path = window.location.pathname;
    if ((path.includes('index.html') || path.endsWith('/')) && !document.getElementById('btnThemeToggle')) {
        criarBotaoTema();
    }

    // --- LÓGICA DE NOTIFICAÇÃO ---
    const user = JSON.parse(sessionStorage.getItem("usuarioLogado"));
    
    if (user) {
        initNotificationSystem(user);
    }
});

function initNotificationSystem(user) {
    // Só mostra o ícone de sino e lista se for TI/Admin
    if (user.role === 'Admin' || user.role === 'Desenvolvedor' || user.role === 'Tecnico') {
        injectNotificationHTML(); 
        carregarNotificacoes();
    }

    // O Socket conecta para TODO MUNDO (para receber os popups do Windows, se ativado)
    setupSocketListener(); 
}

// ==========================================
// 3. ENVIO PARA WINDOWS (COM VERIFICAÇÃO DE PREFERÊNCIA)
// ==========================================
function enviarNotificacaoWindows(titulo, corpo) {
    // 1. VERIFICAÇÃO DE PREFERÊNCIA DO USUÁRIO
    const user = JSON.parse(sessionStorage.getItem("usuarioLogado"));
    
    // Se o usuário desativou as notificações no perfil, paramos aqui.
    if (user && user.recebe_notificacao === false) {
        console.log("Notificação bloqueada pela preferência do usuário.");
        return;
    }

    if (!("Notification" in window)) return;

    const options = {
        body: corpo,
        icon: 'Imagens/logo.png', 
        silent: false
    };

    const spawnNotification = () => {
        const n = new Notification(titulo, options);
        n.onclick = () => { window.focus(); n.close(); };
    };

    if (Notification.permission === "granted") {
        spawnNotification();
    } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then(permission => {
            if (permission === "granted") {
                spawnNotification();
            }
        });
    }
}

function setupSocketListener() {
    socketGlobal.off('nova_notificacao');
    socketGlobal.off('mudanca_status');
    
    const user = JSON.parse(sessionStorage.getItem("usuarioLogado"));
    if (!user) return;

    const souTI = (user.role === 'Admin' || user.role === 'Desenvolvedor' || user.role === 'Tecnico');

    // --- A. NOTIFICAÇÃO DE CRIAÇÃO/REABERTURA (EXCLUSIVO PARA TI) ---
    socketGlobal.on('nova_notificacao', (data) => {
        if (souTI) {
            notificacoes.unshift({ ...data, lida: false });
            atualizarBadge();
            
            const menu = document.getElementById('notifDropdown');
            if (menu && menu.classList.contains('active')) renderNotificationList();
            
            enviarNotificacaoWindows("Novo Chamado - Kari-Kari", data.mensagem);
        }
    });

    // --- B. NOTIFICAÇÃO DE MUDANÇA DE STATUS (MISTA) ---
    socketGlobal.on('mudanca_status', (data) => {
        const souDono = user.email === data.criador_email;

        if (souDono) {
            enviarNotificacaoWindows(
                `Atualização no seu Chamado #${data.chamado_id}`, 
                `Novo Status: ${data.novo_status.toUpperCase()}\n${data.titulo}`
            );
        }
    });
}

// ==========================================
// 4. FUNÇÕES DE UI (Visual, Toasts, Badges)
// ==========================================
function injectNotificationHTML() {
    const existing = document.querySelector('.notification-wrapper');
    if (existing) { existing.onclick = toggleNotificationMenu; return; }

    const headerIcons = document.querySelector('.header-icons');
    if (headerIcons) {
        const wrapper = document.createElement('div');
        wrapper.className = 'notification-wrapper';
        wrapper.onclick = toggleNotificationMenu;
        wrapper.innerHTML = `
            <i class="fa-regular fa-bell notification-icon"></i>
            <span class="notification-badge" id="notifBadge">0</span>
            <div class="notification-dropdown" id="notifDropdown" onclick="event.stopPropagation()">
                <div class="notif-header">Notificações<button class="btn-mark-read" onclick="marcarTodasLidas()">Marcar todas</button></div>
                <div class="notif-list" id="notifList"><div class="empty-notif">Carregando...</div></div>
            </div>`;
        headerIcons.insertBefore(wrapper, headerIcons.lastElementChild);
    }
}

async function carregarNotificacoes() {
    try {
        const res = await fetch(`${API_BASE_URL}/notificacoes`);
        const dados = await res.json();
        if (Array.isArray(dados)) {
            notificacoes = dados;
            atualizarBadge();
            if (document.getElementById('notifDropdown')?.classList.contains('active')) renderNotificationList();
        }
    } catch (e) { console.error("Erro notificacoes:", e); }
}

function showToast(message, type = 'success') {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    let icon = type === 'error' ? 'fa-times-circle' : (type === 'info' ? 'fa-info-circle' : 'fa-check-circle');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.animation = 'fadeOut 0.5s forwards'; setTimeout(() => toast.remove(), 500); }, 3500);
}

function toggleProfileMenu(e) {
    if(e) e.stopPropagation();
    const menu = document.getElementById('profileMenu');
    const notif = document.getElementById('notifDropdown');
    if(notif) notif.classList.remove('active');
    if(menu) menu.classList.toggle('active');
}

function openConfirmModal(message, callback) {
    let modal = document.getElementById('modalConfirmacaoGlobal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modalConfirmacaoGlobal';
        modal.className = 'modal-overlay';
        modal.style.zIndex = '10000';
        modal.innerHTML = `
            <div class="modal-box" style="max-width: 400px; text-align: center; padding: 35px 30px; border-radius: 20px;">
                <div class="icon-alert-container"><i class="fa-solid fa-triangle-exclamation" style="font-size: 2.5rem; color: #EF4444;"></i></div>
                <h3 style="margin: 0 0 10px 0; font-size: 1.4rem; font-weight: 700; color: inherit;">Tem certeza?</h3>
                <p id="msgConfirmacaoGlobal" style="color: #6B7280; margin-bottom: 25px; font-size: 1rem; line-height: 1.5;">...</p>
                <div class="modal-buttons-container">
                    <button class="btn-modal btn-modal-cancel" id="btnCancelarConfirmacao"><i class="fa-solid fa-xmark"></i> Cancelar</button>
                    <button class="btn-modal btn-modal-confirm" id="btnAcaoConfirmar"><i class="fa-solid fa-check"></i> Sim</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        document.getElementById('btnCancelarConfirmacao').onclick = () => document.getElementById('modalConfirmacaoGlobal').style.display = 'none';
    }
    const pMsg = document.getElementById('msgConfirmacaoGlobal');
    pMsg.innerText = message;
    pMsg.style.color = document.body.classList.contains('dark-mode') ? '#9CA3AF' : '#6B7280';
    const btnOld = document.getElementById('btnAcaoConfirmar');
    const btnNew = btnOld.cloneNode(true);
    btnOld.parentNode.replaceChild(btnNew, btnOld);
    btnNew.onclick = function() { modal.style.display = 'none'; callback(); };
    modal.style.display = 'flex';
}

function fazerLogout() {
    openConfirmModal("Deseja realmente sair do sistema?", () => {
        sessionStorage.removeItem("usuarioLogado");
        window.location.href = "login.html";
    });
}

function openSuccessModal(message, callback) {
    let modal = document.getElementById('modalSucessoGlobal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modalSucessoGlobal';
        modal.className = 'modal-overlay';
        modal.style.zIndex = '10000';
        modal.innerHTML = `
            <div class="modal-box" style="max-width: 350px; text-align: center; padding: 40px 30px; border-radius: 20px;">
                <div style="margin-bottom: 20px;"><i class="fa-solid fa-circle-check" style="font-size: 4rem; color: #48BB78; animation: popIn 0.5s;"></i></div>
                <h3 style="margin: 0 0 10px 0; font-size: 1.4rem; color: inherit; font-weight: 700;">Sucesso!</h3>
                <p id="msgSucessoGlobal" style="color: #6B7280; margin-bottom: 30px; font-size: 1rem; line-height: 1.5;">...</p>
                <div class="modal-buttons-container">
                    <button class="btn-modal btn-modal-confirm" id="btnOkSucesso" style="background-color: #48BB78; width: 100%; justify-content: center;">OK, Entendi</button>
                </div>
            </div><style>@keyframes popIn { 0% { transform: scale(0); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }</style>`;
        document.body.appendChild(modal);
    }
    const pMsg = document.getElementById('msgSucessoGlobal');
    pMsg.innerText = message;
    pMsg.style.color = document.body.classList.contains('dark-mode') ? '#9CA3AF' : '#6B7280';
    document.getElementById('btnOkSucesso').onclick = () => { modal.style.display = 'none'; if (callback) callback(); };
    modal.style.display = 'flex';
}

function criarBotaoTema() {
    const btn = document.createElement('button');
    btn.id = 'btnThemeToggle';
    btn.className = 'theme-toggle-btn';
    btn.onclick = toggleTheme;
    const isDark = document.body.classList.contains('dark-mode');
    btn.innerHTML = `<i id="themeIcon" class="fa-solid ${isDark ? 'fa-sun' : 'fa-moon'}"></i>`;
    document.body.appendChild(btn);
}

function toggleTheme() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    const icon = document.getElementById('themeIcon');
    if(icon) icon.className = isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

function toggleNotificationMenu(e) {
    if(e) e.stopPropagation();
    const profile = document.getElementById('profileMenu');
    if(profile) profile.classList.remove('active');
    const menu = document.getElementById('notifDropdown');
    if (menu) {
        menu.classList.toggle('active');
        if (menu.classList.contains('active')) renderNotificationList();
    }
}

function renderNotificationList() {
    const list = document.getElementById('notifList');
    if (!list) return;
    list.innerHTML = "";
    if (!notificacoes || notificacoes.length === 0) {
        list.innerHTML = `<div class="empty-notif">Nenhuma notificação.</div>`;
        return;
    }
    notificacoes.forEach(n => {
        const item = document.createElement('div');
        item.className = `notif-item ${!n.lida ? 'unread' : ''}`;
        let iconHtml = `<div class="notif-icon-box" style="background:#EDF2F7"><i class="fa-solid fa-bell"></i></div>`;
        if (n.tipo === 'criacao') iconHtml = `<div class="notif-icon-box bg-create"><i class="fa-solid fa-ticket"></i></div>`;
        if (n.tipo === 'reabertura') iconHtml = `<div class="notif-icon-box bg-reopen"><i class="fa-solid fa-rotate-left"></i></div>`;
        let dataStr = new Date(n.data_criacao).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
        item.innerHTML = `${iconHtml}<div class="notif-content"><p>${n.mensagem}</p><small>${dataStr}</small></div>`;
        item.onclick = () => lerNotificacaoIndividual(item, n.id); 
        list.appendChild(item);
    });
}

async function lerNotificacaoIndividual(element, notifId) {
    if (element.classList.contains('unread')) {
        element.classList.remove('unread');
        const index = notificacoes.findIndex(n => n.id === notifId);
        if (index !== -1) notificacoes[index].lida = true;
        atualizarBadge();
        try { await fetch(`${API_BASE_URL}/notificacoes/${notifId}/ler`, { method: 'PUT' }); } catch (e) {}
    }
}

function atualizarBadge() {
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    naoLidas = notificacoes.filter(n => !n.lida).length;
    badge.style.display = naoLidas > 0 ? 'flex' : 'none';
    badge.innerText = naoLidas > 9 ? '9+' : naoLidas;
}

// CORREÇÃO: Função atualizada para marcarTodasLidas e adicionado o feedback visual (Toast)
async function marcarTodasLidas() {
    try {
        const res = await fetch(`${API_BASE_URL}/notificacoes/ler`, { method: 'PUT' });
        if(res.ok) {
            notificacoes.forEach(n => n.lida = true);
            atualizarBadge();
            renderNotificationList();
            showToast("Notificações marcadas como lidas!", "success");
        }
    } catch (e) {
        console.error("Erro ao marcar todas como lidas:", e);
        showToast("Erro ao marcar notificações.", "error");
    }
}

document.addEventListener('click', function(event) {
    const notif = document.getElementById('notifDropdown');
    const profile = document.getElementById('profileMenu');
    if (notif?.classList.contains('active') && !event.target.closest('.notification-wrapper')) notif.classList.remove('active');
    if (profile?.classList.contains('active') && !event.target.closest('.user-info')) profile.classList.remove('active');
});