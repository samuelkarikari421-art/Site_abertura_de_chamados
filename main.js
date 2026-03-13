const { app, BrowserWindow, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const path = require('path');
const { fork } = require('child_process');

// 1. OBRIGATÓRIO PARA NOTIFICAÇÕES NO WINDOWS
if (process.platform === 'win32') {
    app.setAppUserModelId("com.karikari.helpdesk");
}

// 2. PERMISSÃO PARA IP INSEGURO (Notificações HTML5)
app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', 'http://192.168.100.132:3000');

// LOGS
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
log.info('App Kari-Kari iniciando...');

let mainWindow;
let serverProcess;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280, height: 800, minWidth: 1024, minHeight: 768,
        title: "Kari-Kari Helpdesk",
        icon: path.join(__dirname, 'frontend/Imagens/logo.png'), 
        autoHideMenuBar: true, 
        webPreferences: {
            nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, webSecurity: false 
        }
    });

    // 3. APROVAÇÃO AUTOMÁTICA DE PERMISSÕES
    mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
        if (permission === 'notifications') callback(true);
        else callback(false);
    });

    mainWindow.loadFile(path.join(__dirname, 'frontend/login.html'));

    mainWindow.on('closed', function () { mainWindow = null; });
}

function startServer() {
    const serverPath = path.join(__dirname, 'backend/server.js');
    // Inicia o backend na porta 3000
    serverProcess = fork(serverPath, [], { env: { ...process.env, PORT: 3000 } });
    console.log("Servidor Backend iniciado pelo Electron.");
}

// ================= AUTO-UPDATE (REDE LOCAL) =================

// Configura para buscar atualizações na pasta do servidor
autoUpdater.setFeedURL({
    provider: 'generic',
    url: 'http://192.168.100.132:3000/updates'
});

autoUpdater.autoDownload = false; // Pergunta antes de baixar

autoUpdater.on('update-available', (info) => {
    dialog.showMessageBox({
        type: 'info',
        title: 'Nova Versão Encontrada',
        message: `A versão ${info.version} está disponível. Deseja baixar agora?`,
        buttons: ['Sim', 'Não']
    }).then((result) => {
        if (result.response === 0) {
            autoUpdater.downloadUpdate();
        }
    });
});

autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox({
        type: 'question',
        title: 'Instalar Atualização',
        message: 'Download concluído. O sistema será reiniciado para atualizar.',
        buttons: ['Reiniciar Agora']
    }).then(() => {
        // Importante: Matar o servidor backend antes de reiniciar
        if (serverProcess) serverProcess.kill();
        autoUpdater.quitAndInstall();
    });
});

autoUpdater.on('error', (err) => {
    log.error('Erro no Auto-Updater: ' + err);
});

// ================= CICLO DE VIDA =================
app.whenReady().then(() => {
    startServer(); 
    createWindow();

    // Verifica updates após 5s se estiver em produção
    setTimeout(() => {
        if (app.isPackaged) {
            autoUpdater.checkForUpdates();
        }
    }, 5000);
});

app.on('window-all-closed', function () {
    if (serverProcess) serverProcess.kill(); 
    if (process.platform !== 'darwin') app.quit();
});