# 🚀 Sistema de Chamados TI (Kari-Kari)

Um sistema completo de Help Desk e Service Desk construído do zero para gerenciar demandas de TI. Possui interface de usuário para abertura de tickets e um painel Kanban em tempo real para a equipe técnica.

## ✨ Funcionalidades

- **Portal do Usuário:** Abertura de chamados com anexo de imagens/PDFs.
- **Visualização Filtrada:** Usuários comuns só veem seus próprios chamados.
- **Painel Kanban (TI):** Gestão visual dos chamados (Pendente, Atribuído, Andamento, Concluído).
- **Tempo Real:** Atualização instantânea da tela usando WebSockets (`Socket.io`).
- **SLA e Cronômetro:** Cálculo automático do tempo de atendimento.
- **Regras de Negócio Inteligentes:**
  - Bloqueio de reabertura após 7 dias ou virada de mês.
  - Incidentes assumem risco "Baixo" automaticamente.
  - O relógio pausa e retoma de forma inteligente.
- **Modo Escuro (Dark Mode):** Suporte nativo com salvamento no LocalStorage.
- **Notificações:** Alertas visuais e popups do Windows para a equipe de TI.

## 🛠️ Tecnologias Utilizadas

- **Frontend:** HTML5, CSS3, Vanilla JavaScript.
- **Backend:** Node.js, Express.
- **Tempo Real:** Socket.io.
- **Banco de Dados:** PostgreSQL (`pg`).
- **Ícones:** FontAwesome.

## ⚙️ Como executar localmente

1. Clone o repositório:
   ```bash
   git clone [https://github.com/samuelkarikari421-art/Site_abertura_de_chamados.git](https://github.com/samuelkarikari421-art/Site_abertura_de_chamados.git)