# Sumaúma — Pronto atendimento (ambiente demonstrativo)

> **Ambiente demonstrativo — não destinado a atendimento real.** Use apenas nomes inventados. O sistema não pede CPF, telefone, endereço nem data de nascimento: cada paciente recebe um código fictício `SIM-0000` e uma idade aproximada.

Fluxo: **Recepção → Triagem (classificação de risco) → Consultório → Sala de medicação**, com **painel de chamadas na TV** (só senha e local, som opcional), **almoxarifado** fictício e **painel administrativo** (equipe, auditoria, modo apresentação).

## Tela inicial: hospital 3D
Na primeira visita de cada sessão há uma abertura de ~6 s (fachada → portas automáticas → hall → recepção) com botão **Pular** (ou Esc). Depois, cada setor tem um ponto clicável e um menu convencional; a câmera vai até o setor e o botão abre o módulo **somente se o perfil logado tiver permissão** (o servidor confere de novo). O login fica sempre acessível. Sem WebGL, com "reduzir movimento", **Modo leve** ou aparelho fraco, a tela usa uma versão simplificada ou ilustração 2D.

## Acesso administrativo
**Ctrl+Shift+M** (ou Alt+Shift+A, ou o botão de chave/“Administrador”) abre a janela de acesso: com sessão de admin, mostra o seletor de setores (troca auditada); sem ela, leva ao login real. O atalho não concede nenhum privilégio.

Se o login do admin falhar no Render, abra `/api/health`: o campo `admin` diz se a variável está ausente ou curta (sem mostrar valores) e o log de inicialização mostra `[config] administrador: configurado` ou o motivo. A senha digitada no login **não cria conta**: ela precisa ser igual a `SENTINELA_ADMIN_PASSWORD`.

## Acesso
Não existem contas de demonstração. O administrador vem **somente** das variáveis de ambiente:

| Variável | Regra |
|---|---|
| `SENTINELA_ADMIN_USER` | 3–40 caracteres (`a-z 0-9 . _ -`) |
| `SENTINELA_ADMIN_PASSWORD` | mínimo 16 caracteres; trocar a senha aqui e reiniciar faz a rotação e encerra as sessões desse admin |

Em produção (`NODE_ENV=production`, Render ou Vercel) o servidor **recusa iniciar o banco** sem essas variáveis (`/api/health` responde 503). No computador, sem as variáveis, é gerada uma senha aleatória em `backend/data/credenciais-locais.txt` (fora do Git). A equipe é criada pelo admin no painel (senhas de 12+ caracteres). Bancos antigos são migrados: contas de demonstração conhecidas são removidas, senhas sem hash ficam bloqueadas, sessões antigas são revogadas e CPF/telefone/nascimento são apagados.

## Rodar no computador
```bash
npm ci
npm start          # http://localhost:3000
npm test           # regras, migração, permissões, CSRF, privacidade da TV, estoque, demo
```

## Publicar
**Render (Web Service):** build `npm ci`, start `npm start`, health check `/api/health`. Defina `SENTINELA_ADMIN_USER` e `SENTINELA_ADMIN_PASSWORD` em *Environment*. O disco do Render é **efêmero**: sem persistência os dados somem a cada deploy/reinício. Para manter, use Redis (`KV_REST_API_URL` + `KV_REST_API_TOKEN` ou `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) ou um disco persistente com `DB_FILE=/caminho/no/disco/db.json`.

**Vercel:** conecte Upstash Redis (Storage) e defina as mesmas variáveis do admin. Sem Redis a API fica indisponível (503) de propósito.

## Segurança
Sessão em cookie `HttpOnly` + `SameSite=Strict` (+ `Secure` em produção), token guardado só como hash, expiração de 10 h e logout; CSRF exige o cabeçalho `X-Saude-Plus`; limite de tentativas de login; senhas com scrypt; autorização por perfil em toda rota; CSP e cabeçalhos de segurança; limite de 50 kB por requisição; auditoria de logins, trocas de setor e ações administrativas; ações destrutivas exigem confirmação digitada; arquivos internos não são servidos. A troca de setor do admin só existe dentro de uma sessão de admin válida e fica registrada.

## Estrutura
```
api/index.js            função da Vercel (mesmo app)
backend/app.js          rotas /api, autenticação, auditoria, estoque, demo
backend/store.js        Redis ou arquivo, migração e admin por variável de ambiente
backend/demo.js         cenário fictício (pacientes e estoque)
backend/triagem.js      classificação de risco (didática, inspirada em Manchester) e ordem da fila
frontend/index.html     tela inicial (login + hospital 3D: js/hall.js, js/hospital3d.js, js/setores.js)
frontend/*.html         módulos; js/app.js com sessão, cabeçalho e faixa de simulação
```
A classificação de risco é **material didático**, sem validade clínica.
