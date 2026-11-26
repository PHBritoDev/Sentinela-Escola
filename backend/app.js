/**
 * Sumaúma · Sentinela — API do pronto atendimento.
 * Fluxo de um paciente (um único registro, do cadastro à alta):
 *   aguardando_triagem → aguardando_medico → em_atendimento → aguardando_medicacao → finalizado
 *   (ou "desistiu" a qualquer momento antes da alta).
 * Usado tanto pelo servidor local (backend/server.js) quanto pela função da Vercel (api/index.js).
 */
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const store = require("./store");
const { RISCOS, SINTOMAS, classificarRisco, compararFila } = require("./triagem");
const { texto, textoLongo } = require("./validacao");
const { cenarioDemo, ESTOQUE_INICIAL } = require("./demo");

const TIPOS = ["admin", "atendimento", "triagem", "medico", "enfermagem"];
const SESSAO_HORAS = 10;
const COOKIE = "sp_sessao";
const AVISO = "Ambiente demonstrativo — não destinado a atendimento real";
const MEDICAMENTOS = [
  "Dipirona 500 mg", "Dipirona 1 g (injetável)", "Paracetamol 750 mg", "Ibuprofeno 600 mg", "Cetoprofeno 100 mg",
  "Amoxicilina 500 mg", "Azitromicina 500 mg", "Cefalexina 500 mg", "Loratadina 10 mg", "Dexclorfeniramina 2 mg",
  "Omeprazol 20 mg", "Ondansetrona 8 mg", "Buscopan composto", "Dimenidrinato (Dramin)", "Soro fisiológico 0,9% 500 ml",
  "Soro de reidratação oral", "Salbutamol (inalação)", "Prednisolona 20 mg", "Captopril 25 mg", "AAS 100 mg"
];

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1); // Render/Vercel ficam atrás de proxy: IP real para o limite de tentativas
app.use(express.json({ limit: "50kb" }));

// ---------- cabeçalhos de segurança ----------
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net", // telas antigas têm <script> inline; todo texto dinâmico é escapado
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"
].join("; ");
app.use((req, res, next) => {
  res.set({
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin"
  });
  if (store.producao()) res.set("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  if (req.path.startsWith("/api/")) res.set("Cache-Control", "no-store");
  next();
});

// CSRF: toda requisição que altera dados precisa do cabeçalho X-Saude-Plus (formulários de outro site não conseguem
// enviá-lo sem CORS, e a API não libera CORS). Somado ao cookie SameSite=Strict.
app.use("/api", (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.get("X-Saude-Plus") !== "1") return res.status(403).json({ erro: "Requisição recusada (proteção CSRF)." });
  next();
});

// ---------- utilidades ----------
const agoraISO = () => new Date().toISOString();
const novoId = () => crypto.randomUUID();
const erro = (res, status, mensagem) => res.status(status).json({ erro: mensagem });

/** Envolve rotas assíncronas: qualquer falha vira JSON com mensagem legível (nunca uma página em branco). */
const rota = fn => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e && e.status) return erro(res, e.status, e.message);
    if (/SENTINELA_ADMIN|Redis persistente/.test(String(e && e.message))) {
      console.error("[config]", e.message);
      return erro(res, 503, "Servidor sem configuração de administrador ou banco. Verifique as variáveis de ambiente no painel da hospedagem.");
    }
    console.error("[api]", req.method, req.url, e);
    erro(res, 500, "Erro interno no servidor. Tente novamente em instantes.");
  }
};
const falha = (status, message) => Object.assign(new Error(message), { status });

function publicoUsuario(u) {
  return { usuario: u.usuario, tipo: u.tipo, nome: u.nome || u.usuario, criadoEm: u.criadoEm || null };
}

function resumoPaciente(p) {
  return { ...p };
}

/** Senha do painel: N001 (normal) / P001 (preferencial). Reinicia a cada dia. */
function proximaSenha(db, preferencial) {
  const hoje = new Date().toISOString().slice(0, 10);
  if (db.contadores.dia !== hoje) db.contadores = { normal: 0, preferencial: 0, dia: hoje };
  const chave = preferencial ? "preferencial" : "normal";
  db.contadores[chave] += 1;
  return (preferencial ? "P" : "N") + String(db.contadores[chave]).padStart(3, "0");
}

// ---------- autenticação (cookie HttpOnly; o token nunca fica acessível ao JavaScript) ----------
const hashToken = t => crypto.createHash("sha256").update(String(t)).digest("hex");

function cookies(req) {
  const out = {};
  for (const parte of String(req.headers.cookie || "").split(";")) {
    const i = parte.indexOf("="); if (i < 0) continue;
    try { out[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim()); } catch { /* cookie malformado */ }
  }
  return out;
}
function tokenDe(req) { return cookies(req)[COOKIE] || ""; }

function definirCookie(res, token, maxAgeS) {
  const partes = [COOKIE + "=" + (token || ""), "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=" + maxAgeS];
  if (store.producao()) partes.push("Secure");
  res.append("Set-Cookie", partes.join("; "));
}

function sessaoValida(db, token) {
  if (!token) return null;
  const h = hashToken(token);
  const s = db.sessoes.find(x => x.hash === h);
  if (!s || new Date(s.expira) < new Date()) return null;
  const u = db.usuarios.find(x => x.usuario === s.usuario);
  return u ? publicoUsuario(u) : null;
}

/** Registro de auditoria (sem senhas, tokens ou dados clínicos). */
function auditar(db, req, acao, detalhe = "") {
  db.auditoria.unshift({ em: agoraISO(), por: req.usuario?.usuario || "anônimo", perfil: req.usuario?.tipo || "-", acao, detalhe: texto(detalhe, 160) });
  db.auditoria = db.auditoria.slice(0, 400);
}

/** Exige login; se "tipos" for informado, exige também um desses perfis (o admin sempre passa). */
function exigir(...tipos) {
  return async (req, res, next) => {
    try {
      const db = await store.ler();
      const u = sessaoValida(db, tokenDe(req));
      if (!u) return erro(res, 401, "Sessão expirada. Faça login novamente.");
      if (tipos.length && u.tipo !== "admin" && !tipos.includes(u.tipo)) return erro(res, 403, "Seu perfil não tem acesso a esta função.");
      req.usuario = u;
      next();
    } catch (e) {
      console.error("[auth]", e.message);
      erro(res, 503, "Serviço indisponível: configuração ou banco ausente.");
    }
  };
}

// Limite de tentativas de login por IP e por usuário (memória do processo; reinicia com o serviço).
const tentativas = new Map();
const JANELA_MS = 15 * 60e3, MAX_FALHAS = 5;
function bloqueado(chave) {
  const t = tentativas.get(chave); if (!t) return false;
  if (Date.now() - t.inicio > JANELA_MS) { tentativas.delete(chave); return false; }
  return t.falhas >= MAX_FALHAS;
}
function falhou(chave) {
  const t = tentativas.get(chave);
  if (!t || Date.now() - t.inicio > JANELA_MS) tentativas.set(chave, { inicio: Date.now(), falhas: 1 }); else t.falhas++;
  if (tentativas.size > 5000) tentativas.clear();
}

app.post("/api/login", rota(async (req, res) => {
  const usuario = texto(req.body?.usuario, 60).toLowerCase(), senha = String(req.body?.senha || "").slice(0, 200);
  if (!usuario || !senha) return erro(res, 400, "Informe usuário e senha.");
  const chaves = ["ip:" + req.ip, "u:" + usuario];
  if (chaves.some(bloqueado)) return erro(res, 429, "Muitas tentativas. Aguarde alguns minutos e tente novamente.");
  const resultado = await store.alterar(db => {
    const u = db.usuarios.find(x => x.usuario.toLowerCase() === usuario);
    if (!u || !(store.senhaConfere(senha, u.senha) || (senha.trim() !== senha && store.senhaConfere(senha.trim(), u.senha)))) { auditar(db, req, "login recusado", usuario); return null; }
    const token = crypto.randomBytes(32).toString("base64url");
    const agora = new Date();
    db.sessoes = db.sessoes.filter(s => new Date(s.expira) > agora).slice(-300);
    db.sessoes.push({ hash: hashToken(token), usuario: u.usuario, criadaEm: agora.toISOString(), expira: new Date(agora.getTime() + SESSAO_HORAS * 3600e3).toISOString() });
    req.usuario = publicoUsuario(u); auditar(db, req, "login");
    return { token, usuario: publicoUsuario(u) };
  });
  if (!resultado) {
    chaves.forEach(falhou);
    await new Promise(r => setTimeout(r, 600)); // atraso fixo: encarece tentativas em sequência
    return erro(res, 401, "Usuário ou senha incorretos.");
  }
  chaves.forEach(c => tentativas.delete(c));
  definirCookie(res, resultado.token, SESSAO_HORAS * 3600);
  res.json({ ...resultado.usuario, aviso: AVISO });
}));

app.post("/api/logout", rota(async (req, res) => {
  const token = tokenDe(req);
  if (token) await store.alterar(db => {
    const h = hashToken(token), s = db.sessoes.find(x => x.hash === h);
    if (s) { req.usuario = { usuario: s.usuario }; auditar(db, req, "logout"); }
    db.sessoes = db.sessoes.filter(x => x.hash !== h);
  });
  definirCookie(res, "", 0);
  res.json({ ok: true });
}));

app.get("/api/me", exigir(), (req, res) => res.json({ ...req.usuario, aviso: AVISO }));

// Admin troca de setor sem digitar senha a cada clique — só dentro da própria sessão de admin, e fica auditado.
app.post("/api/admin/setor", exigir("admin"), rota(async (req, res) => {
  const setor = texto(req.body?.setor, 20);
  if (!["admin", "atendimento", "triagem", "medico", "medicacoes", "almoxarifado", "tv"].includes(setor)) return erro(res, 400, "Setor inválido.");
  await store.alterar(db => auditar(db, req, "abriu setor", setor));
  res.json({ ok: true });
}));

// ---------- usuários (admin) ----------
app.get("/api/usuarios", exigir("admin"), rota(async (req, res) => {
  const db = await store.ler();
  res.json(db.usuarios.map(publicoUsuario));
}));

app.post("/api/usuarios", exigir("admin"), rota(async (req, res) => {
  const usuario = texto(req.body?.usuario, 40).toLowerCase();
  const nome = texto(req.body?.nome, 80);
  const senha = String(req.body?.senha || "");
  const tipo = texto(req.body?.tipo, 20).toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(usuario)) return erro(res, 400, "Usuário deve ter 3 a 40 caracteres (letras, números, ponto, hífen).");
  if (senha.length < 8) return erro(res, 400, "A senha precisa de pelo menos 8 caracteres.");
  if (!TIPOS.includes(tipo)) return erro(res, 400, "Perfil inválido.");
  const novo = await store.alterar(db => {
    if (db.usuarios.some(u => u.usuario.toLowerCase() === usuario)) throw falha(409, "Esse usuário já existe.");
    const u = { usuario, nome: nome || usuario, tipo, senha: store.hashSenha(senha), criadoEm: agoraISO() };
    db.usuarios.push(u); auditar(db, req, "criou usuário", usuario + " (" + tipo + ")");
    return publicoUsuario(u);
  });
  res.status(201).json(novo);
}));

app.delete("/api/usuarios/:usuario", exigir("admin"), rota(async (req, res) => {
  const alvo = String(req.params.usuario).toLowerCase();
  if (alvo === req.usuario.usuario.toLowerCase()) return erro(res, 400, "Você não pode excluir o próprio usuário.");
  if (alvo === store.credenciaisAdmin().usuario) return erro(res, 400, "O administrador da plataforma é definido pelos segredos do servidor.");
  await store.alterar(db => {
    const antes = db.usuarios.length;
    db.usuarios = db.usuarios.filter(u => u.usuario.toLowerCase() !== alvo);
    if (db.usuarios.length === antes) throw falha(404, "Usuário não encontrado.");
    if (!db.usuarios.some(u => u.tipo === "admin")) throw falha(400, "O sistema precisa de pelo menos um administrador.");
    db.sessoes = db.sessoes.filter(s => s.usuario.toLowerCase() !== alvo);
    auditar(db, req, "excluiu usuário", alvo);
  });
  res.json({ ok: true });
}));

// ---------- referências ----------
app.get("/api/referencias", (req, res) => {
  res.json({
    riscos: RISCOS,
    sintomas: Object.entries(SINTOMAS).map(([id, s]) => ({ id, ...s })),
    medicamentos: MEDICAMENTOS
  });
});

// Prévia da cor de risco enquanto a enfermagem preenche a triagem (mesma regra usada ao salvar).
app.post("/api/triagem/previa", exigir("triagem"), (req, res) => {
  res.json(classificarRisco(req.body || {}));
});

// ---------- pacientes ----------
app.get("/api/pacientes", exigir(), rota(async (req, res) => {
  const db = await store.ler();
  let lista = db.pacientes;
  const status = String(req.query.status || "").split(",").filter(Boolean);
  if (status.length) lista = lista.filter(p => status.includes(p.status));
  if (req.query.hoje === "1") {
    const hoje = new Date().toISOString().slice(0, 10);
    lista = lista.filter(p => String(p.criadoEm).slice(0, 10) === hoje || !["finalizado", "desistiu"].includes(p.status));
  }
  if (req.query.fila === "medico") lista = [...lista].sort(compararFila);
  else lista = [...lista].sort((a, b) => (b.preferencial - a.preferencial) || new Date(a.criadoEm) - new Date(b.criadoEm));
  res.json(lista.map(resumoPaciente));
}));

app.post("/api/pacientes", exigir("atendimento"), rota(async (req, res) => {
  // Modo escolar: sem CPF, telefone ou nascimento. Só nome inventado, idade aproximada e código fictício SIM-0000.
  const nome = texto(req.body?.nome, 100);
  const idadeTxt = req.body?.idade;
  const anos = idadeTxt === "" || idadeTxt == null ? null : Number(idadeTxt);
  const convenio = texto(req.body?.convenio, 60) || "Particular";
  const motivoPreferencial = texto(req.body?.motivoPreferencial, 40);
  if (nome.length < 3) return erro(res, 400, "Informe o nome (fictício) do paciente.");
  if (anos !== null && (!Number.isInteger(anos) || anos < 0 || anos > 120)) return erro(res, 400, "Idade inválida (0 a 120 anos).");
  const preferencial = !!motivoPreferencial || (anos !== null && anos >= 60);
  const paciente = await store.alterar(db => {
    const ativo = db.pacientes.find(p => p.nome.toLowerCase() === nome.toLowerCase() && !["finalizado", "desistiu"].includes(p.status));
    if (ativo && !req.body?.confirmarDuplicado) throw falha(409, "Já existe um paciente ativo com esse nome (senha " + ativo.senha + "). Confirme para cadastrar mesmo assim.");
    db.contadores.simulacao = (db.contadores.simulacao || 0) + 1;
    const p = {
      id: novoId(), codigo: "SIM-" + String(db.contadores.simulacao).padStart(4, "0"), senha: proximaSenha(db, preferencial), nome, idade: anos,
      convenio, preferencial, motivoPreferencial: motivoPreferencial || (preferencial ? "Idoso (60+)" : ""),
      status: "aguardando_triagem", criadoEm: agoraISO(), cadastradoPor: req.usuario.usuario,
      triagem: null, consulta: null, medicacao: null, historico: [{ em: agoraISO(), evento: "Cadastro na recepção", por: req.usuario.nome }]
    };
    db.pacientes.push(p);
    return p;
  });
  res.status(201).json(resumoPaciente(paciente));
}));

async function alterarPaciente(id, fn) {
  return store.alterar(db => {
    const p = db.pacientes.find(x => x.id === id);
    if (!p) throw falha(404, "Paciente não encontrado.");
    const r = fn(p, db);
    return r === undefined ? resumoPaciente(p) : r;
  });
}

app.post("/api/pacientes/:id/triagem", exigir("triagem"), rota(async (req, res) => {
  const b = req.body || {};
  if (!SINTOMAS[b.sintoma]) return erro(res, 400, "Selecione a queixa principal.");
  const temp = b.temperatura === "" || b.temperatura == null ? null : Number(String(b.temperatura).replace(",", "."));
  if (temp !== null && (!Number.isFinite(temp) || temp < 30 || temp > 45)) return erro(res, 400, "Temperatura fora da faixa (30 a 45 °C).");
  const sat = b.saturacao === "" || b.saturacao == null ? null : Number(b.saturacao);
  if (sat !== null && (!Number.isFinite(sat) || sat < 50 || sat > 100)) return erro(res, 400, "Saturação fora da faixa (50 a 100%).");
  const fc = b.frequencia === "" || b.frequencia == null ? null : Number(b.frequencia);
  if (fc !== null && (!Number.isFinite(fc) || fc < 20 || fc > 250)) return erro(res, 400, "Frequência cardíaca fora da faixa.");
  const pressao = texto(b.pressao, 9);
  if (pressao && !/^\d{2,3}(\s*[x/]\s*\d{2,3})?$/i.test(pressao)) return erro(res, 400, "Pressão no formato 120/80.");
  const dor = b.dor === "" || b.dor == null ? null : Math.max(0, Math.min(10, Number(b.dor) || 0));
  const dados = { sintoma: b.sintoma, temperatura: temp, saturacao: sat, frequencia: fc, pressao, dor };
  const classe = classificarRisco(dados);
  const paciente = await alterarPaciente(req.params.id, p => {
    if (!["aguardando_triagem", "aguardando_medico"].includes(p.status)) throw falha(409, "Este paciente já passou da triagem.");
    p.triagem = {
      ...dados, sintomaNome: SINTOMAS[b.sintoma].nome, alergia: texto(b.alergia, 200) || "Nega alergias",
      observacao: textoLongo(b.observacao, 800), peso: texto(b.peso, 6), risco: classe.risco, motivos: classe.motivos,
      por: req.usuario.nome, em: agoraISO()
    };
    p.status = "aguardando_medico";
    p.historico.push({ em: agoraISO(), evento: "Triagem · " + RISCOS[classe.risco].nome, por: req.usuario.nome });
  });
  res.json(paciente);
}));

app.post("/api/pacientes/:id/iniciar", exigir("medico"), rota(async (req, res) => {
  const paciente = await alterarPaciente(req.params.id, p => {
    if (p.status === "em_atendimento" && p.medico && p.medico !== req.usuario.nome) throw falha(409, "Paciente já está com " + p.medico + ".");
    if (!["aguardando_medico", "em_atendimento"].includes(p.status)) throw falha(409, "Paciente não está aguardando médico.");
    if (p.status !== "em_atendimento") p.historico.push({ em: agoraISO(), evento: "Início da consulta", por: req.usuario.nome });
    p.status = "em_atendimento";
    p.medico = req.usuario.nome;
    p.consultorio = texto(req.body?.consultorio, 10) || p.consultorio || "01";
  });
  res.json(paciente);
}));

app.post("/api/pacientes/:id/consulta", exigir("medico"), rota(async (req, res) => {
  const b = req.body || {};
  const diagnostico = texto(b.diagnostico, 200);
  const desfecho = ["alta", "medicacao", "observacao", "encaminhamento"].includes(b.desfecho) ? b.desfecho : "alta";
  const medicacoes = (Array.isArray(b.medicacoes) ? b.medicacoes : []).slice(0, 10)
    .map(m => ({ nome: texto(m?.nome, 80), posologia: texto(m?.posologia, 120), via: texto(m?.via, 30) }))
    .filter(m => m.nome);
  if (diagnostico.length < 3) return erro(res, 400, "Descreva a hipótese diagnóstica.");
  if (desfecho === "medicacao" && !medicacoes.length) return erro(res, 400, "Prescreva ao menos uma medicação para enviar à sala de medicação.");
  const paciente = await alterarPaciente(req.params.id, p => {
    if (!["aguardando_medico", "em_atendimento"].includes(p.status)) throw falha(409, "Este paciente não está em consulta.");
    p.consulta = { diagnostico, medicacoes, orientacoes: textoLongo(b.orientacoes, 1000), desfecho, medico: req.usuario.nome, em: agoraISO() };
    p.medico = req.usuario.nome;
    p.status = desfecho === "medicacao" ? "aguardando_medicacao" : "finalizado";
    if (p.status === "finalizado") p.finalizadoEm = agoraISO();
    const rotulo = { alta: "Alta médica", medicacao: "Encaminhado à medicação", observacao: "Em observação", encaminhamento: "Encaminhado a outro serviço" }[desfecho];
    p.historico.push({ em: agoraISO(), evento: "Consulta · " + rotulo, por: req.usuario.nome });
  });
  res.json(paciente);
}));

app.post("/api/pacientes/:id/medicacao", exigir("enfermagem", "medico"), rota(async (req, res) => {
  const paciente = await alterarPaciente(req.params.id, p => {
    if (p.status !== "aguardando_medicacao") throw falha(409, "Não há medicação pendente para este paciente.");
    p.medicacao = { por: req.usuario.nome, em: agoraISO(), observacao: textoLongo(req.body?.observacao, 500) };
    p.status = "finalizado";
    p.finalizadoEm = agoraISO();
    p.historico.push({ em: agoraISO(), evento: "Medicação administrada · alta", por: req.usuario.nome });
  });
  res.json(paciente);
}));

app.post("/api/pacientes/:id/desistencia", exigir("atendimento", "triagem", "medico"), rota(async (req, res) => {
  const paciente = await alterarPaciente(req.params.id, p => {
    if (["finalizado", "desistiu"].includes(p.status)) throw falha(409, "Atendimento já encerrado.");
    p.status = "desistiu";
    p.finalizadoEm = agoraISO();
    p.historico.push({ em: agoraISO(), evento: "Saiu sem atendimento", por: req.usuario.nome });
  });
  res.json(paciente);
}));

// ---------- painel da TV ----------
const LOCAIS = { guiche: "GUICHÊ", triagem: "TRIAGEM", consultorio: "CONSULTÓRIO", medicacao: "MEDICAÇÃO" };

app.post("/api/tv/chamar", exigir("atendimento", "triagem", "medico", "enfermagem"), rota(async (req, res) => {
  const local = Object.keys(LOCAIS).includes(req.body?.local) ? req.body.local : "guiche";
  const numero = texto(req.body?.numero, 6) || "01";
  const chamada = await store.alterar(db => {
    const p = db.pacientes.find(x => x.id === req.body?.pacienteId);
    if (!p) throw falha(404, "Paciente não encontrado.");
    if (["finalizado", "desistiu"].includes(p.status)) throw falha(409, "Este atendimento já foi encerrado.");
    // A TV é pública: guarda só senha, local e horário (sem nome, risco ou qualquer dado do paciente).
    const c = { id: novoId(), pacienteId: p.id, senha: p.senha, local, localNome: LOCAIS[local], numero: numero.padStart(2, "0"), em: agoraISO() };
    db.tv.atual = c;
    db.tv.historico = [c, ...db.tv.historico.filter(h => h.pacienteId !== p.id || h.local !== local)].slice(0, 12);
    p.chamadas = (p.chamadas || 0) + 1;
    p.historico.push({ em: agoraISO(), evento: "Chamado na TV · " + LOCAIS[local] + " " + c.numero, por: req.usuario.nome });
    return { ...c, paciente: p.nome };
  });
  res.status(201).json(chamada);
}));

// Pública: a TV da sala de espera não faz login.
app.get("/api/tv/chamada", rota(async (req, res) => {
  const db = await store.ler();
  res.set("Cache-Control", "no-store");
  const publico = c => c && { id: c.id, senha: c.senha, local: c.local, localNome: c.localNome, numero: c.numero, em: c.em };
  res.json({ atual: publico(db.tv.atual), historico: db.tv.historico.slice(0, 6).map(publico), aviso: AVISO });
}));

// ---------- painel administrativo ----------
app.get("/api/estatisticas", exigir(), rota(async (req, res) => {
  const db = await store.ler();
  const hoje = new Date().toISOString().slice(0, 10);
  const doDia = db.pacientes.filter(p => String(p.criadoEm).slice(0, 10) === hoje);
  const porStatus = {}, porRisco = {};
  for (const p of db.pacientes) porStatus[p.status] = (porStatus[p.status] || 0) + 1;
  for (const p of doDia) if (p.triagem) porRisco[p.triagem.risco] = (porRisco[p.triagem.risco] || 0) + 1;
  const finalizados = doDia.filter(p => p.finalizadoEm);
  const tempoMedio = finalizados.length ? Math.round(finalizados.reduce((s, p) => s + (new Date(p.finalizadoEm) - new Date(p.criadoEm)), 0) / finalizados.length / 60000) : null;
  res.json({ hoje: doDia.length, porStatus, porRisco, tempoMedioMin: tempoMedio, armazenamento: store.modo() });
}));

app.post("/api/admin/limpar", exigir("admin"), rota(async (req, res) => {
  if (req.body?.confirmar !== "LIMPAR") return erro(res, 400, "Confirmação ausente: digite LIMPAR para apagar os atendimentos.");
  await store.alterar(db => {
    db.pacientes = [];
    db.tv = { atual: null, historico: [] };
    db.contadores = { ...db.contadores, normal: 0, preferencial: 0, dia: null };
    auditar(db, req, "encerrou o dia (apagou atendimentos)");
  });
  res.json({ ok: true });
}));

// Cenário de demonstração: pacientes fictícios marcados demo=true, removíveis sem tocar nos demais.
app.post("/api/admin/demo", exigir("admin"), rota(async (req, res) => {
  if (req.body?.confirmar !== "DEMO") return erro(res, 400, "Confirmação ausente.");
  const n = await store.alterar(db => {
    db.pacientes = db.pacientes.filter(p => !p.demo);
    const codigo = () => { db.contadores.simulacao = (db.contadores.simulacao || 0) + 1; return "SIM-" + String(db.contadores.simulacao).padStart(4, "0"); };
    const lista = cenarioDemo(new Date(), codigo, pref => proximaSenha(db, pref), novoId);
    db.pacientes.push(...lista);
    if (!db.estoque.length) db.estoque = ESTOQUE_INICIAL.map(e => ({ id: novoId(), ...e, atualizadoEm: agoraISO() }));
    auditar(db, req, "carregou cenário de demonstração", lista.length + " pacientes fictícios");
    return lista.length;
  });
  res.status(201).json({ ok: true, pacientes: n });
}));

app.delete("/api/admin/demo", exigir("admin"), rota(async (req, res) => {
  const n = await store.alterar(db => {
    const antes = db.pacientes.length;
    db.pacientes = db.pacientes.filter(p => !p.demo);
    const ids = new Set(db.pacientes.map(p => p.id));
    if (db.tv.atual && !ids.has(db.tv.atual.pacienteId)) db.tv.atual = null;
    db.tv.historico = db.tv.historico.filter(h => ids.has(h.pacienteId));
    auditar(db, req, "removeu cenário de demonstração");
    return antes - db.pacientes.length;
  });
  res.json({ ok: true, removidos: n });
}));

app.get("/api/admin/auditoria", exigir("admin"), rota(async (req, res) => {
  const db = await store.ler();
  res.json(db.auditoria.slice(0, 150));
}));

// ---------- almoxarifado (estoque fictício) ----------
app.get("/api/estoque", exigir("enfermagem", "medico"), rota(async (req, res) => {
  const db = await store.ler();
  res.json([...db.estoque].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
}));

app.post("/api/estoque", exigir("enfermagem"), rota(async (req, res) => {
  const nome = texto(req.body?.nome, 80), categoria = texto(req.body?.categoria, 40) || "Geral", unidade = texto(req.body?.unidade, 20) || "un";
  const quantidade = Number(req.body?.quantidade ?? 0), minimo = Number(req.body?.minimo ?? 10);
  if (nome.length < 2) return erro(res, 400, "Informe o nome do item.");
  if (!Number.isInteger(quantidade) || quantidade < 0 || quantidade > 100000) return erro(res, 400, "Quantidade inválida.");
  if (!Number.isInteger(minimo) || minimo < 0 || minimo > 100000) return erro(res, 400, "Estoque mínimo inválido.");
  const item = await store.alterar(db => {
    if (db.estoque.some(e => e.nome.toLowerCase() === nome.toLowerCase())) throw falha(409, "Item já cadastrado.");
    const e = { id: novoId(), nome, categoria, unidade, quantidade, minimo, atualizadoEm: agoraISO() };
    db.estoque.push(e); auditar(db, req, "cadastrou item de estoque", nome);
    return e;
  });
  res.status(201).json(item);
}));

app.post("/api/estoque/:id/movimento", exigir("enfermagem"), rota(async (req, res) => {
  const tipo = req.body?.tipo === "saida" ? "saida" : req.body?.tipo === "entrada" ? "entrada" : null;
  const qtd = Number(req.body?.quantidade);
  if (!tipo) return erro(res, 400, "Movimento inválido.");
  if (!Number.isInteger(qtd) || qtd < 1 || qtd > 10000) return erro(res, 400, "Quantidade inválida.");
  const item = await store.alterar(db => {
    const e = db.estoque.find(x => x.id === req.params.id);
    if (!e) throw falha(404, "Item não encontrado.");
    if (tipo === "saida" && qtd > e.quantidade) throw falha(409, "Saída maior que o estoque disponível.");
    e.quantidade += tipo === "entrada" ? qtd : -qtd; e.atualizadoEm = agoraISO();
    auditar(db, req, tipo === "entrada" ? "entrada de estoque" : "saída de estoque", e.nome + " · " + qtd);
    return e;
  });
  res.json(item);
}));

app.get("/api/health", rota(async (req, res) => {
  const m = store.modo();
  const persistente = m === "redis" || !store.producao() || !!process.env.DB_FILE;
  let ok = true, admin = "configurado";
  try { store.credenciaisAdmin(); } catch (e) { admin = /PASSWORD/.test(e.message) ? "senha ausente ou com menos de 8 caracteres" : "usuário ausente ou inválido"; }
  try { await store.ler(); } catch (e) { ok = false; }
  res.status(ok ? 200 : 503).json({ ok, servico: "Sumaúma", armazenamento: m, persistente, admin });
}));

app.use("/api", (req, res) => erro(res, 404, "Rota da API não encontrada."));

// Arquivos do site (no computador; na Vercel quem serve é a própria plataforma).
app.use(express.static(path.join(__dirname, "../frontend"), { extensions: ["html"], dotfiles: "deny", index: "index.html" }));

module.exports = app;
