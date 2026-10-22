# Saúde+ · Sentinela — Pronto atendimento

Sistema escolar de pronto atendimento: **Recepção → Triagem (classificação de risco) → Consultório → Sala de medicação**, com **painel de chamadas na TV** (som e voz) e **painel administrativo**.

As credenciais listadas abaixo são somente para desenvolvimento local. A Vercel não cria essas contas de demonstração.

## Como usar

| Perfil | Usuário | Senha | Tela |
|---|---|---|---|
| Recepção | `atendimento` | `123` | Cadastra paciente, gera a senha (N001 / P001 preferencial), chama no guichê |
| Triagem | `triagem` | `123` | Sinais vitais, escala de dor, alergias → cor de risco automática |
| Médico | `medico` | `123` | Fila por gravidade, ficha com alertas, prescrição e desfecho |
| Medicação | `enfermagem` | `123` | Prescrições pendentes, registra a administração e a alta |
| Administração | `admin` | `admin123` | Indicadores do dia, equipe (criar/excluir usuários), encerrar o dia |

A TV fica em **/tv.html** (sem login). Na primeira vez, toque na tela para liberar o som; a tecla **F** coloca em tela cheia.

### Classificação de risco (inspirada no Protocolo de Manchester)
🔴 Emergência (imediato) · 🟠 Muito urgente (10 min) · 🟡 Urgente (60 min) · 🟢 Pouco urgente (120 min) · 🔵 Não urgente (240 min).
A regra fica em `backend/triagem.js`: queixa + temperatura, saturação, frequência cardíaca, pressão e dor. Cada sinal só pode **subir** a cor.

## Rodar no computador

```bash
npm install
npm start          # http://localhost:3000
npm test           # testes automáticos (regras + fluxo completo da API)
```
No computador os dados ficam em `backend/data/db.local.json` (criado sozinho). `backend/db.json` é só a semente com os usuários de demonstração.

## Publicar na Vercel (importante para salvar os pacientes)

Na Vercel o disco das funções **não guarda arquivos** e cada acesso pode cair num servidor diferente — por isso, antes, o paciente "sumia" e a TV não recebia a chamada. Agora o sistema usa um banco Redis:

1. No projeto da Vercel, abra **Storage → Create Database → Upstash (Redis)** e conecte ao projeto.
2. A Vercel cria sozinha as variáveis `KV_REST_API_URL` e `KV_REST_API_TOKEN` (também aceitamos `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`).
3. Em **Settings → Environment Variables**, configure `SENTINELA_ADMIN_USER` (3–40 caracteres) e `SENTINELA_ADMIN_PASSWORD` (mínimo de 16 caracteres) para Production. Use uma senha única e guarde-a fora do repositório.
4. Faça um novo deploy. Na Vercel, a API retorna erro de prontidão (`GET /api/health`, HTTP 503) até o Redis estar conectado e as credenciais iniciais do administrador serem configuradas.

Na primeira inicialização de um banco vazio, somente o administrador configurado é criado. Contas de demonstração não são copiadas para a Vercel; novas senhas de equipe devem ter pelo menos 12 caracteres. Não use dados reais de pacientes até a instituição avaliar privacidade, controle de acesso, retenção e requisitos legais aplicáveis. Este projeto não declara conformidade regulatória nem substitui avaliação clínica.

## Estrutura

```
api/index.js          função da Vercel (usa o mesmo app)
backend/app.js        rotas da API (/api/...)
backend/store.js      armazenamento: Redis (Vercel) ou arquivo (computador)
backend/triagem.js    classificação de risco e ordem da fila
backend/validacao.js  CPF, idade, textos
frontend/             telas (HTML + css/style.css + js/app.js)
```

Segurança: senhas guardadas com hash (scrypt), sessão com token, cada perfil só acessa suas funções e todo texto exibido é escapado (sem injeção de HTML).
