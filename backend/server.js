require('dotenv').config();
const express = require('express');
const { Pool } = require('pg'); 
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path'); 
const http = require('http'); 
const { Server } = require("socket.io"); 

const app = express();
const port = process.env.PORT || 3000;

// --- CONFIGURAÇÃO DO SERVIDOR COM SOCKET.IO ---
const server = http.createServer(app); 
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST", "PUT", "DELETE"] }
});

// --- BANCO DE DADOS ---
const pool = new Pool({
    user: process.env.DB_USER || 'chamadouser',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'chamadosti',
    password: process.env.DB_PASS || 'Dark421#',
    port: process.env.DB_PORT || 5432,
});

// --- MIDDLEWARES ---
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' })); 

// 1. SERVIR FRONTEND
app.use(express.static(path.join(__dirname, '../frontend'))); 

// 2. SERVIR UPDATES
app.use('/updates', express.static(path.join(__dirname, 'updates')));

// ================= EVENTOS SOCKET =================
io.on('connection', (socket) => { console.log('Cliente conectado ao Socket.io'); });

// ================= ROTAS =================

// --- NOTIFICAÇÕES (Listar e Marcar como Lida) ---
app.get('/api/notificacoes', async (req, res) => {
    try { const { rows } = await pool.query("SELECT * FROM notificacoes ORDER BY data_criacao DESC LIMIT 20"); res.json(rows); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/notificacoes/:id/ler', async (req, res) => {
    try { await pool.query("UPDATE notificacoes SET lida = TRUE WHERE id = $1", [req.params.id]); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/notificacoes/ler', async (req, res) => {
    try { await pool.query("UPDATE notificacoes SET lida = TRUE WHERE lida = FALSE"); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- USUÁRIOS (Login e CRUD) ---
app.post('/api/login', async (req, res) => {
    const { email, senha } = req.body;
    try {
        const { rows } = await pool.query('SELECT * FROM usuarios WHERE email = $1 AND senha = $2', [email, senha]);
        if (rows.length > 0) { 
            const user = rows[0]; 
            delete user.senha; 
            if (user.recebe_notificacao === null) user.recebe_notificacao = true;
            res.json({ success: true, user: user }); 
        } else { 
            res.status(401).json({ success: false, message: 'Credenciais inválidas' }); 
        }
    } catch (err) { res.status(500).json({ error: 'Erro no servidor' }); }
});

app.put('/api/usuarios/:id/notificacoes', async (req, res) => {
    const { id } = req.params;
    const { recebe_notificacao } = req.body; 
    try {
        await pool.query('UPDATE usuarios SET recebe_notificacao = $1 WHERE id = $2', [recebe_notificacao, id]);
        res.json({ success: true, message: 'Preferência atualizada.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/usuarios', async (req, res) => {
    try { const { rows } = await pool.query('SELECT id, nome, email, setor, role, nivel_tec, foto, recebe_notificacao FROM usuarios ORDER BY id DESC'); res.json(rows); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/usuarios', async (req, res) => {
    const { nome, email, senha, setor, role, nivel_tec, foto } = req.body;
    try { const { rows } = await pool.query('INSERT INTO usuarios (nome, email, senha, setor, role, nivel_tec, foto) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *', [nome, email, senha, setor, role, nivel_tec, foto]); res.json(rows[0]); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/usuarios/:id', async (req, res) => {
    const { nome, email, senha, setor, role, nivel_tec, foto } = req.body;
    const id = req.params.id;
    try {
        if (senha && senha.trim() !== "") {
            await pool.query('UPDATE usuarios SET nome=$1, email=$2, senha=$3, setor=$4, role=$5, nivel_tec=$6, foto=$7 WHERE id=$8', [nome, email, senha, setor, role, nivel_tec, foto, id]);
        } else {
            await pool.query('UPDATE usuarios SET nome=$1, email=$2, setor=$3, role=$4, nivel_tec=$5, foto=$6 WHERE id=$7', [nome, email, setor, role, nivel_tec, foto, id]);
        }
        res.json({ message: 'Usuário atualizado!' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/usuarios/:id', async (req, res) => {
    try { await pool.query('DELETE FROM usuarios WHERE id = $1', [req.params.id]); res.json({ message: 'Usuário removido' }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- CHAMADOS (CRUD Principal) ---
app.get('/api/chamados', async (req, res) => {
    try { const { rows } = await pool.query('SELECT * FROM chamados ORDER BY id DESC'); res.json(rows); } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- CRIAÇÃO DO CHAMADO (MARCO ZERO CONDICIONAL) ---
app.post('/api/chamados', async (req, res) => {
    console.log(">>> [POST] Criando chamado:", req.body.titulo);
    const { titulo, descricao, tipo, origem, setor, prioridade, nivel, risco_critico, causa, criador_email, solicitante_nome, anexo } = req.body;
    
    const isIncidente = tipo && (tipo.toLowerCase().includes('incidente') || tipo.toLowerCase().includes('ocorrência'));
    const relogioInicio = isIncidente ? 'NOW()' : 'NULL';

    try {
        const { rows } = await pool.query(
            `INSERT INTO chamados (titulo, descricao, tipo, origem, setor, prioridade, nivel, risco_critico, causa, status, criador_email, solicitante_nome, data_abertura, reaberturas, anexo, timer_acumulado, timer_inicio) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pendente', $10, $11, NOW(), 0, $12, 0, ${relogioInicio}) RETURNING *`,
            [titulo, descricao, tipo, origem, setor, prioridade, nivel, risco_critico, causa, criador_email, solicitante_nome, anexo]
        );
        const novoId = rows[0].id;
        
        const msg = `Novo chamado #${novoId}: ${titulo}`;
        await pool.query("INSERT INTO notificacoes (mensagem, tipo, chamado_id, data_criacao) VALUES ($1, 'criacao', $2, NOW())", [msg, novoId]);
        
        io.emit('nova_notificacao', { mensagem: msg, chamado_id: novoId, tipo: 'criacao', data_criacao: new Date() });
        io.emit('atualizar_kanban'); 
        res.json(rows[0]);
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// --- ROTA DE EDIÇÃO (TOUCH TIME E FINALIZAÇÃO) ---
app.put('/api/chamados/:id', async (req, res) => {
    const { id } = req.params;
    const novosDados = req.body;

    try {
        const { rows } = await pool.query('SELECT status, timer_acumulado, timer_inicio, titulo, criador_email, data_atendimento FROM chamados WHERE id = $1', [id]);
        if (rows.length === 0) return res.status(404).json({ message: "Chamado não encontrado" });
        const atual = rows[0];

        // 2. REGRA DO TOUCH TIME: Técnico assumiu a bronca
        if (!atual.data_atendimento && (novosDados.dev_responsavel || novosDados.status === 'em andamento')) {
            novosDados.data_atendimento = new Date();
            
            if (!atual.timer_inicio && (!novosDados.status || novosDados.status !== 'concluido')) {
                novosDados.timer_inicio = new Date();
            }
        }
        
        // Emite notificação SOMENTE se o status veio no request e ele for diferente do atual
        if (novosDados.status && novosDados.status !== atual.status) {
            io.emit('mudanca_status', { chamado_id: id, titulo: atual.titulo, novo_status: novosDados.status, criador_email: atual.criador_email });
            const msgNotif = `Status do chamado #${id} alterado para: ${novosDados.status.toUpperCase()}`;
            await pool.query("INSERT INTO notificacoes (mensagem, tipo, chamado_id, data_criacao) VALUES ($1, 'status', $2, NOW())", [msgNotif, id]);
        }

        // 3. REGRA DE FINALIZAÇÃO DO RELÓGIO E DATA DE CONCLUSÃO
        if (novosDados.timer_acumulado === undefined) novosDados.timer_acumulado = atual.timer_acumulado;
        
        if (novosDados.status === 'concluido' && atual.status !== 'concluido') {
            novosDados.data_conclusao = new Date(); // Salva a data de encerramento
            const agora = new Date();
            
            const diff = atual.timer_inicio ? (agora - new Date(atual.timer_inicio)) : 0;
            novosDados.timer_acumulado = (Number(atual.timer_acumulado) || 0) + diff;
            novosDados.timer_inicio = null; 
        }
        // BUG FIX AQUI: Só apaga a data de encerramento se novosDados.status for explicitamente enviado e não for 'concluido'
        else if (novosDados.status && novosDados.status !== 'concluido' && atual.status === 'concluido') {
            novosDados.data_conclusao = null; // Apaga a data de encerramento (Reabertura)
            novosDados.timer_inicio = new Date(); 
        }

        const campos = ['titulo', 'descricao', 'tipo', 'origem', 'setor', 'prioridade', 'status', 'dev_responsavel', 'solucao', 'nivel', 'risco_critico', 'causa', 'data_conclusao', 'reaberturas', 'anexo', 'timer_acumulado', 'timer_inicio', 'data_atendimento'];
        let sets = [], values = [];
        
        campos.forEach(c => {
            if (novosDados[c] !== undefined) {
                sets.push(`${c}=$${values.length + 1}`);
                values.push(novosDados[c]);
            }
        });

        if (values.length === 0) return res.status(400).json({ message: "Nada a atualizar" });
        
        values.push(id);
        await pool.query(`UPDATE chamados SET ${sets.join(', ')} WHERE id=$${values.length}`, values);

        if (novosDados.status === 'pendente' && novosDados.reaberturas > 0 && atual.status === 'concluido') {
            const msg = `Chamado #${id} foi REABERTO!`;
            await pool.query("INSERT INTO notificacoes (mensagem, tipo, chamado_id, data_criacao) VALUES ($1, 'reabertura', $2, NOW())", [msg, id]);
            io.emit('nova_notificacao', { mensagem: msg, chamado_id: id, tipo: 'reabertura', data_criacao: new Date() });
        }

        io.emit('atualizar_kanban');
        res.json({ message: 'Atualizado' });

    } catch (err) { 
        console.error("Erro no PUT:", err); 
        res.status(500).json({ error: err.message }); 
    }
});

app.delete('/api/chamados/:id', async (req, res) => {
    try { await pool.query('DELETE FROM chamados WHERE id = $1', [req.params.id]); io.emit('atualizar_kanban'); res.json({ message: 'Deletado' }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- INICIALIZAÇÃO ---
server.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${port}`);
    console.log(`   Link Update: http://192.168.100.132:${port}/updates`);
});