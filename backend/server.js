require('dotenv').config();
const express = require('express');
const { Pool } = require('pg'); 
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path'); 
const http = require('http'); 
const { Server } = require("socket.io"); 
const notifier = require('node-notifier');

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

// ==========================================
// MÁQUINA DE SLA: CÁLCULO DE HORAS ÚTEIS
// ==========================================
// Expediente: Seg a Sex (08:00 - 17:00) | Sáb (08:00 - 12:00) | Dom (Pausa)
function calcularTempoUtil(dataInicio, dataFim) {
    if (!dataInicio || !dataFim) return 0;
    let tempoGasto = 0;
    let atual = new Date(dataInicio);
    const fim = new Date(dataFim);

    while (atual < fim) {
        const diaSemana = atual.getDay(); // 0=Domingo, 1=Segunda ... 6=Sábado
        const hora = atual.getHours();

        // Se for Domingo, salta direto para a meia-noite de Segunda-feira
        if (diaSemana === 0) { 
            atual.setHours(24, 0, 0, 0);
            continue;
        }

        const horaInicioExpediente = 8;
        const horaFimExpediente = (diaSemana === 6) ? 12 : 17; // Sáb = 12h, Seg-Sex = 17h

        // Se o chamado foi aberto antes das 08h, empurra o início do relógio para as 08h
        if (hora < horaInicioExpediente) { 
            atual.setHours(horaInicioExpediente, 0, 0, 0);
            if (atual >= fim) break;
        }

        // Se passar da hora limite, o relógio para e salta para o dia seguinte
        if (hora >= horaFimExpediente) { 
            atual.setHours(24, 0, 0, 0);
            continue;
        }

        // Calcula até que horas o relógio deve rodar no dia de "hoje"
        let limiteHoje = new Date(atual);
        limiteHoje.setHours(horaFimExpediente, 0, 0, 0);

        if (fim <= limiteHoje) {
            tempoGasto += fim - atual; // O fim aconteceu hoje
            break;
        } else {
            tempoGasto += limiteHoje - atual; // Soma as horas de hoje e o loop continua amanhã
            atual = limiteHoje;
        }
    }
    return tempoGasto; // Retorna os milissegundos totais limpos!
}

// --- MIDDLEWARES ---
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' })); 
app.use(express.static(path.join(__dirname, '../frontend'))); 
app.use('/updates', express.static(path.join(__dirname, 'updates')));

// ================= WEBSOCKETS (Salas e Chat) =================
io.on('connection', (socket) => { 
    console.log('Cliente conectado ao Socket.io'); 

    socket.on('entrar_chamado', (chamado_id) => {
        socket.join(`chamado_${chamado_id}`);
        console.log(`Utilizador entrou na sala do chamado ${chamado_id}`);
    });

    socket.on('sair_chamado', (chamado_id) => {
        socket.leave(`chamado_${chamado_id}`);
        console.log(`Utilizador saiu da sala do chamado ${chamado_id}`);
    });

    socket.on('enviar_mensagem', async (dados) => {
        const { chamado_id, remetente_nome, remetente_email, mensagem } = dados;

        try {
            const resultChamado = await pool.query('SELECT status FROM chamados WHERE id = $1', [chamado_id]);
            
            if (resultChamado.rows.length === 0) {
                return socket.emit('erro_chat', { mensagem: 'Chamado não encontrado.' });
            }

            const statusAtual = resultChamado.rows[0].status.toLowerCase().trim();

            if (!statusAtual.includes('andamento')) {
                return socket.emit('erro_chat', { 
                    mensagem: 'Mensagens só podem ser enviadas quando o chamado estiver "Em Andamento".' 
                });
            }

            const novaMensagem = {
                chamado_id,
                remetente_nome,
                remetente_email,
                mensagem,
                data_envio: new Date()
            };

            io.to(`chamado_${chamado_id}`).emit('nova_mensagem', novaMensagem);

            notifier.notify({
                title: `Nova Mensagem - Chamado #${chamado_id}`,
                message: `${remetente_nome} diz: ${mensagem}`,
                sound: true,
                wait: false
            });

            await pool.query(
                `INSERT INTO mensagens_chamados (chamado_id, remetente_nome, remetente_email, mensagem) 
                 VALUES ($1, $2, $3, $4)`,
                [chamado_id, remetente_nome, remetente_email, mensagem]
            );

        } catch (error) {
            console.error("Erro ao processar mensagem do chat:", error);
            socket.emit('erro_chat', { mensagem: 'Erro interno ao processar a mensagem.' });
        }
    });
});

// ================= ROTAS (Notificações, Utilizadores, Chamados) =================
app.get('/api/notificacoes', async (req, res) => { try { const { rows } = await pool.query("SELECT * FROM notificacoes ORDER BY data_criacao DESC LIMIT 20"); res.json(rows); } catch (err) { res.status(500).json({ error: err.message }); } });
app.put('/api/notificacoes/:id/ler', async (req, res) => { try { await pool.query("UPDATE notificacoes SET lida = TRUE WHERE id = $1", [req.params.id]); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); } });
app.put('/api/notificacoes/ler', async (req, res) => { try { await pool.query("UPDATE notificacoes SET lida = TRUE WHERE lida = FALSE"); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); } });

app.post('/api/login', async (req, res) => { const { email, senha } = req.body; try { const { rows } = await pool.query('SELECT * FROM usuarios WHERE email = $1 AND senha = $2', [email, senha]); if (rows.length > 0) { const user = rows[0]; delete user.senha; if (user.recebe_notificacao === null) user.recebe_notificacao = true; res.json({ success: true, user: user }); } else { res.status(401).json({ success: false, message: 'Credenciais inválidas' }); } } catch (err) { res.status(500).json({ error: 'Erro no servidor' }); } });
app.put('/api/usuarios/:id/notificacoes', async (req, res) => { const { id } = req.params; const { recebe_notificacao } = req.body; try { await pool.query('UPDATE usuarios SET recebe_notificacao = $1 WHERE id = $2', [recebe_notificacao, id]); res.json({ success: true, message: 'Preferência atualizada.' }); } catch (err) { res.status(500).json({ error: err.message }); } });
app.get('/api/usuarios', async (req, res) => { try { const { rows } = await pool.query('SELECT id, nome, email, setor, role, nivel_tec, foto, recebe_notificacao FROM usuarios ORDER BY id DESC'); res.json(rows); } catch (err) { res.status(500).json({ error: err.message }); } });
app.post('/api/usuarios', async (req, res) => { const { nome, email, senha, setor, role, nivel_tec, foto } = req.body; try { const { rows } = await pool.query('INSERT INTO usuarios (nome, email, senha, setor, role, nivel_tec, foto) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *', [nome, email, senha, setor, role, nivel_tec, foto]); res.json(rows[0]); } catch (err) { res.status(500).json({ error: err.message }); } });
app.put('/api/usuarios/:id', async (req, res) => { const { nome, email, senha, setor, role, nivel_tec, foto } = req.body; const id = req.params.id; try { if (senha && senha.trim() !== "") { await pool.query('UPDATE usuarios SET nome=$1, email=$2, senha=$3, setor=$4, role=$5, nivel_tec=$6, foto=$7 WHERE id=$8', [nome, email, senha, setor, role, nivel_tec, foto, id]); } else { await pool.query('UPDATE usuarios SET nome=$1, email=$2, setor=$3, role=$4, nivel_tec=$5, foto=$6 WHERE id=$7', [nome, email, setor, role, nivel_tec, foto, id]); } res.json({ message: 'Utilizador atualizado!' }); } catch (err) { res.status(500).json({ error: err.message }); } });
app.delete('/api/usuarios/:id', async (req, res) => { try { await pool.query('DELETE FROM usuarios WHERE id = $1', [req.params.id]); res.json({ message: 'Utilizador removido' }); } catch (err) { res.status(500).json({ error: err.message }); } });

app.get('/api/chamados', async (req, res) => { try { const { rows } = await pool.query('SELECT * FROM chamados ORDER BY id DESC'); res.json(rows); } catch (err) { res.status(500).json({ error: err.message }); } });

app.get('/api/chamados/:id/mensagens', async (req, res) => { 
    try { 
        const { rows } = await pool.query(
            "SELECT * FROM mensagens_chamados WHERE chamado_id = $1 ORDER BY data_envio ASC LIMIT 50", 
            [req.params.id]
        ); 
        res.json(rows); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    } 
});

// CRIAÇÃO DE CHAMADO COM NOTIFICAÇÃO E ABERTURA
app.post('/api/chamados', async (req, res) => { 
    const { titulo, descricao, tipo, origem, setor, prioridade, nivel, risco_critico, causa, criador_email, solicitante_nome, anexo } = req.body; 
    const isIncidente = tipo && (tipo.toLowerCase().includes('incidente') || tipo.toLowerCase().includes('ocorrência')); 
    
    // Regra: Data de Abertura é SEMPRE agora. O timer do SLA só liga direto se for Incidente.
    const relogioInicio = isIncidente ? 'NOW()' : 'NULL'; 
    
    try { 
        const { rows } = await pool.query(`INSERT INTO chamados (titulo, descricao, tipo, origem, setor, prioridade, nivel, risco_critico, causa, status, criador_email, solicitante_nome, data_abertura, reaberturas, anexo, timer_acumulado, timer_inicio) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pendente', $10, $11, NOW(), 0, $12, 0, ${relogioInicio}) RETURNING *`, [titulo, descricao, tipo, origem, setor, prioridade, nivel, risco_critico, causa, criador_email, solicitante_nome, anexo] ); 
        const novoId = rows[0].id; 
        const msg = `Novo chamado #${novoId}: ${titulo}`; 
        
        // 1. INSERE E RETORNA O ID GERADO PELO BANCO
        const resultNotif = await pool.query(
            "INSERT INTO notificacoes (mensagem, tipo, chamado_id, data_criacao) VALUES ($1, 'criacao', $2, NOW()) RETURNING id, data_criacao", 
            [msg, novoId]
        ); 
        const notifGerada = resultNotif.rows[0];
        
        // 2. ENVIA PARA O FRONTEND COM O ID CORRETO
        io.emit('nova_notificacao', { 
            id: notifGerada.id, 
            mensagem: msg, 
            chamado_id: novoId, 
            tipo: 'criacao', 
            data_criacao: notifGerada.data_criacao 
        }); 

        io.emit('atualizar_kanban'); 
        io.emit('novo_chamado'); 

        notifier.notify({
            title: `Novo Chamado do Setor: ${setor}`,
            message: titulo,
            sound: true
        });

        res.json(rows[0]); 
    } catch (err) { 
        console.error(err); 
        res.status(500).json({ error: err.message }); 
    } 
});

// EDIÇÃO DO CHAMADO (MÁQUINA DO TEMPO INTEGRADA)
app.put('/api/chamados/:id', async (req, res) => { 
    const { id } = req.params; 
    const novosDados = req.body; 
    
    try { 
        const { rows } = await pool.query('SELECT status, timer_acumulado, timer_inicio, tipo, titulo, criador_email, data_atendimento FROM chamados WHERE id = $1', [id]); 
        if (rows.length === 0) return res.status(404).json({ message: "Chamado não encontrado" }); 
        
        const atual = rows[0]; 
        const tipoStr = (atual.tipo || '').toLowerCase();
        const isDuvidaSolicitacao = tipoStr.includes('dúvida') || tipoStr.includes('solicitação');
        
        if (!atual.data_atendimento && (novosDados.dev_responsavel || novosDados.status === 'em andamento')) { 
            novosDados.data_atendimento = new Date(); 
            if (!atual.timer_inicio && (!novosDados.status || novosDados.status !== 'concluido')) { 
                novosDados.timer_inicio = new Date(); 
            } 
        } 
        
        if (novosDados.status && novosDados.status !== atual.status) { 
            io.emit('mudanca_status', { chamado_id: id, titulo: atual.titulo, novo_status: novosDados.status, criador_email: atual.criador_email }); 
            const msgNotif = `Status do chamado #${id} alterado para: ${novosDados.status.toUpperCase()}`; 
            await pool.query("INSERT INTO notificacoes (mensagem, tipo, chamado_id, data_criacao) VALUES ($1, 'status', $2, NOW())", [msgNotif, id]); 
        } 
        
        if (novosDados.timer_acumulado === undefined) novosDados.timer_acumulado = atual.timer_acumulado; 
        
        // --- CÁLCULO DE SLA E EXPEDIENTE ---
        const agora = new Date();

        if (novosDados.status === 'pendente' && atual.status !== 'pendente') {
            if (isDuvidaSolicitacao) {
                // REGRA ATIVADA: Dúvida/Solicitação volta à estaca zero!
                novosDados.timer_acumulado = 0;
                novosDados.timer_inicio = null; 
            } else {
                // Incidente: Pausa o SLA calculando o tempo útil rodado
                if (atual.timer_inicio) {
                    const diffUtil = calcularTempoUtil(atual.timer_inicio, agora);
                    novosDados.timer_acumulado = (Number(atual.timer_acumulado) || 0) + diffUtil;
                    novosDados.timer_inicio = null;
                }
            }
        } 
        else if (novosDados.status === 'concluido' && atual.status !== 'concluido') { 
            novosDados.data_conclusao = agora; 
            if (atual.timer_inicio) {
                const diffUtil = calcularTempoUtil(atual.timer_inicio, agora);
                novosDados.timer_acumulado = (Number(atual.timer_acumulado) || 0) + diffUtil;
            }
            novosDados.timer_inicio = null; 
        } 
        else if (novosDados.status && novosDados.status !== 'concluido' && atual.status === 'concluido') { 
            novosDados.data_conclusao = null; 
            if (novosDados.status !== 'pendente') {
                novosDados.timer_inicio = agora; 
            }
        } 
        else if (novosDados.status === 'em andamento' && atual.status === 'pendente') {
            if (!atual.timer_inicio) {
                novosDados.timer_inicio = agora; // Play no relógio!
            }
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
            
            // 1. INSERE E RETORNA O ID GERADO PELO BANCO
            const resultNotif = await pool.query(
                "INSERT INTO notificacoes (mensagem, tipo, chamado_id, data_criacao) VALUES ($1, 'reabertura', $2, NOW()) RETURNING id, data_criacao", 
                [msg, id]
            ); 
            const notifGerada = resultNotif.rows[0];

            // 2. ENVIA PARA O FRONTEND COM O ID CORRETO
            io.emit('nova_notificacao', { 
                id: notifGerada.id, 
                mensagem: msg, 
                chamado_id: id, 
                tipo: 'reabertura', 
                data_criacao: notifGerada.data_criacao 
            }); 
        } 
        
        io.emit('atualizar_kanban'); 
        io.emit('chamado_atualizado'); 

        res.json({ message: 'Atualizado com regras de SLA útil' }); 
    } catch (err) { 
        console.error("Erro no PUT:", err); 
        res.status(500).json({ error: err.message }); 
    } 
});

// ==========================================
// ROTA: EVOLUIR CHAMADO PARA PROJETO
// ==========================================
app.put('/api/chamados/:id/converter-projeto', async (req, res) => {
    const { id } = req.params;
    const { autor_nome } = req.body;
  
    try {
        const chamadoResult = await pool.query("SELECT * FROM chamados WHERE id = $1", [id]);
        const chamado = chamadoResult.rows[0];
  
        if (!chamado) return res.status(404).json({ error: "Chamado não encontrado" });
  
        const tituloProjeto = `[PROJ] ${chamado.titulo}`;
        const descProjeto = chamado.descricao || 'Projeto evoluído a partir do suporte.';
        const solicitanteNome = chamado.solicitante_nome || chamado.criador_email || 'Não informado';
  
        await pool.query(
            `INSERT INTO projetos 
             (titulo, descricao, chamado_origem_id, solicitante, setor, status, tipo, progresso) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [tituloProjeto, descProjeto, id, solicitanteNome, chamado.setor || 'TI', 'backlog', 'Novo Desenvolvimento', 0]
        );
  
        await pool.query("UPDATE chamados SET tipo = 'Projeto' WHERE id = $1", [id]);
  
        const mensagemSistema = `🚀 Sistema: Este chamado foi evoluído para a esteira de PROJETOS por ${autor_nome || 'um Administrador'}. Acompanhe pelo painel de Gestão de Projetos.`;
        
        await pool.query(
            "INSERT INTO mensagens_chamados (chamado_id, remetente_nome, remetente_email, mensagem, data_envio) VALUES ($1, $2, $3, $4, NOW())",
            [id, 'Sistema', 'sistema@karikari.com.br', mensagemSistema] 
        );
  
        io.emit('chamado_atualizado'); 
        io.emit('atualizar_kanban');   
        io.emit('atualizar_projetos'); 
  
        res.status(200).json({ message: "Projeto gerado com sucesso!" });
    } catch (error) {
        console.error("Erro na integração de projeto:", error);
        res.status(500).json({ error: "Erro interno do servidor ao gerar projeto" });
    }
});

app.delete('/api/chamados/:id', async (req, res) => { 
    try { 
        await pool.query('DELETE FROM chamados WHERE id = $1', [req.params.id]); 
        io.emit('atualizar_kanban'); 
        io.emit('chamado_excluido'); 
        res.json({ message: 'Deletado' }); 
    } catch (err) { res.status(500).json({ error: err.message }); } 
});

// ==========================================
// ROTAS DE GESTÃO DE PROJETOS
// ==========================================
app.get('/api/projetos', async (req, res) => {
    try {
        const { rows } = await pool.query("SELECT * FROM projetos ORDER BY id DESC");
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/projetos/:id', async (req, res) => {
    try {
        const { rows } = await pool.query("SELECT * FROM projetos WHERE id = $1", [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: "Projeto não encontrado" });
        res.json(rows[0]);
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

app.post('/api/projetos', async (req, res) => {
    const { titulo, descricao, status, responsavel, progresso, prazo, chamado_origem_id, tipo, prioridade, equipe, data_inicio, estimativa, complexidade, tecnologia, impacto_negocio, observacoes, anexo, sem_prazo, solicitante, setor, validador } = req.body;
    const prazoFinal = sem_prazo ? null : (prazo || null);

    try {
        const { rows } = await pool.query(
            `INSERT INTO projetos (titulo, descricao, status, responsavel, progresso, prazo, chamado_origem_id, tipo, prioridade, equipe, data_inicio, estimativa, complexidade, tecnologia, impacto_negocio, observacoes, anexo, sem_prazo, solicitante, setor, validador) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21) RETURNING *`,
            [titulo, descricao, status || 'backlog', responsavel, progresso || 0, prazoFinal, chamado_origem_id || null, tipo, prioridade, equipe, data_inicio || null, estimativa, complexidade, tecnologia, impacto_negocio, observacoes, anexo, sem_prazo || false, solicitante, setor, validador]
        );
        io.emit('atualizar_projetos'); res.json(rows[0]);
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

app.put('/api/projetos/:id', async (req, res) => {
    const { id } = req.params; const campos = req.body;
    
    try {
        const { rows: rowsAtual } = await pool.query("SELECT * FROM projetos WHERE id = $1", [id]);
        if (rowsAtual.length === 0) return res.status(404).json({ message: "Projeto não encontrado" });
        const projetoAtual = rowsAtual[0]; const projetoMesclado = { ...projetoAtual, ...campos };

        if (campos.sem_prazo === true) { campos.prazo = null; projetoMesclado.prazo = null; }
        if (projetoMesclado.prioridade === 'Crítica' && projetoMesclado.sem_prazo) return res.status(400).json({ error: "ALERTA: Projetos com prioridade Crítica DEVEM ter um prazo definido." });

        if (campos.status && campos.status !== 'backlog' && projetoAtual.status === 'backlog') {
            const faltantes = [];
            if (!projetoMesclado.responsavel) faltantes.push("Responsável");
            if (!projetoMesclado.data_inicio) faltantes.push("Data de Início");
            if (!projetoMesclado.prazo && !projetoMesclado.sem_prazo) faltantes.push("Data Prevista (Fim)");
            if (!projetoMesclado.estimativa) faltantes.push("Estimativa de Tempo");
            if (!projetoMesclado.complexidade) faltantes.push("Complexidade");
            if (faltantes.length > 0) return res.status(400).json({ error: "Preenchimento obrigatório pendente para iniciar o projeto.", faltantes });
        }

        if (campos.status === 'concluido' && projetoAtual.status !== 'concluido') {
            const checkWBS = await pool.query(`SELECT count(*) FROM projetos_atividades pa JOIN projetos_etapas pe ON pa.etapa_id = pe.id WHERE pe.projeto_id = $1 AND pa.concluida = false`, [id]);
            if (parseInt(checkWBS.rows[0].count) > 0) return res.status(400).json({ error: "Bloqueio de Qualidade: O projeto possui atividades pendentes no Plano de Execução." });
        }

        let sets = [], values = [];
        Object.keys(campos).forEach(key => { sets.push(`${key}=$${values.length + 1}`); values.push(campos[key]); });
        if (values.length === 0) return res.status(400).json({ message: "Nada a atualizar" });
        
        values.push(id);
        await pool.query(`UPDATE projetos SET ${sets.join(', ')} WHERE id=$${values.length}`, values);
        
        io.emit('atualizar_projetos'); res.json({ message: 'Projeto atualizado!' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/projetos/:id', async (req, res) => {
    const { id } = req.params;
    const apagarChamado = req.query.apagarChamado === 'true';
    
    try { 
        const projetoResult = await pool.query("SELECT chamado_origem_id FROM projetos WHERE id = $1", [id]);
        let chamadoId = null;

        if (projetoResult.rows.length > 0 && projetoResult.rows[0].chamado_origem_id) {
            chamadoId = projetoResult.rows[0].chamado_origem_id;
        }

        await pool.query("DELETE FROM projetos_atividades WHERE etapa_id IN (SELECT id FROM projetos_etapas WHERE projeto_id = $1)", [id]);
        await pool.query("DELETE FROM projetos_etapas WHERE projeto_id = $1", [id]);
        await pool.query("DELETE FROM projetos WHERE id = $1", [id]); 
        
        if (chamadoId) {
            if (apagarChamado) {
                await pool.query("DELETE FROM mensagens_chamados WHERE chamado_id = $1", [chamadoId]);
                await pool.query("DELETE FROM notificacoes WHERE chamado_id = $1", [chamadoId]);
                await pool.query("DELETE FROM chamados WHERE id = $1", [chamadoId]);
                io.emit('chamado_excluido');
            } else {
                await pool.query("UPDATE chamados SET tipo = 'Tarefa/Solicitação' WHERE id = $1", [chamadoId]);
                const msgSistema = `⚠️ Sistema: O projeto vinculado a esta solicitação foi cancelado. A demanda retornou para a fila normal.`;
                await pool.query("INSERT INTO mensagens_chamados (chamado_id, remetente_nome, remetente_email, mensagem, data_envio) VALUES ($1, $2, $3, $4, NOW())", [chamadoId, 'Sistema', 'sistema@karikari.com.br', msgSistema] );
                io.emit('chamado_atualizado');
            }
            io.emit('atualizar_kanban');
        }

        io.emit('atualizar_projetos'); res.json({ message: 'Exclusão processada.' }); 
    } catch (err) { console.error("Erro ao deletar:", err); res.status(500).json({ error: err.message }); }
});

// ==========================================
// ROTAS WBS (ETAPAS E ATIVIDADES)
// ==========================================
app.get('/api/projetos/:id/wbs', async (req, res) => {
    try {
        const { rows: etapas } = await pool.query("SELECT * FROM projetos_etapas WHERE projeto_id = $1 ORDER BY id ASC", [req.params.id]);
        let totalAtividadesProjeto = 0; let totalConcluidasProjeto = 0;

        for (let etapa of etapas) {
            const { rows: atividades } = await pool.query("SELECT * FROM projetos_atividades WHERE etapa_id = $1 ORDER BY id ASC", [etapa.id]);
            etapa.atividades = atividades;
            const concluidas = atividades.filter(a => a.concluida).length;
            etapa.progresso = atividades.length ? Math.round((concluidas / atividades.length) * 100) : 0;
            totalAtividadesProjeto += atividades.length; totalConcluidasProjeto += concluidas;
        }

        const progressoGeral = totalAtividadesProjeto ? Math.round((totalConcluidasProjeto / totalAtividadesProjeto) * 100) : 0;
        res.json({ etapas, progressoGeral, totalAtividadesProjeto, pendentes: totalAtividadesProjeto - totalConcluidasProjeto });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/projetos/:id/etapas', async (req, res) => {
    const { nome, responsavel } = req.body;
    try {
        const { rows } = await pool.query("INSERT INTO projetos_etapas (projeto_id, nome, responsavel) VALUES ($1, $2, $3) RETURNING *", [req.params.id, nome, responsavel]);
        io.emit('atualizar_projetos'); res.json(rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/etapas/:id/atividades', async (req, res) => {
    const { titulo, responsavel } = req.body;
    try {
        const { rows } = await pool.query("INSERT INTO projetos_atividades (etapa_id, titulo, responsavel) VALUES ($1, $2, $3) RETURNING *", [req.params.id, titulo, responsavel]);
        io.emit('atualizar_projetos'); res.json(rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/atividades/:id/toggle', async (req, res) => {
    const { concluida } = req.body;
    const dataConclusao = concluida ? 'NOW()' : 'NULL';
    try {
        await pool.query(`UPDATE projetos_atividades SET concluida = $1, data_conclusao = ${dataConclusao} WHERE id = $2`, [concluida, req.params.id]);
        io.emit('atualizar_projetos'); res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/etapas/:id', async (req, res) => {
    const { nome, responsavel } = req.body;
    try { await pool.query("UPDATE projetos_etapas SET nome = $1, responsavel = $2 WHERE id = $3", [nome, responsavel, req.params.id]); io.emit('atualizar_projetos'); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/etapas/:id', async (req, res) => {
    try { await pool.query("DELETE FROM projetos_etapas WHERE id = $1", [req.params.id]); io.emit('atualizar_projetos'); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/atividades/:id', async (req, res) => {
    const { titulo, responsavel } = req.body;
    try { await pool.query("UPDATE projetos_atividades SET titulo = $1, responsavel = $2 WHERE id = $3", [titulo, responsavel, req.params.id]); io.emit('atualizar_projetos'); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/atividades/:id', async (req, res) => {
    try { await pool.query("DELETE FROM projetos_atividades WHERE id = $1", [req.params.id]); io.emit('atualizar_projetos'); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

server.listen(port, '0.0.0.0', () => { console.log(`🚀 Servidor a rodar na porta ${port}`); });