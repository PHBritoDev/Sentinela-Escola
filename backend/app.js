/**
 * Saúde+ · Sentinela — API do pronto atendimento.
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
const { cpfValido, formatarCpf, texto, textoLongo, idade, somenteDigitos } = require("./validacao");

const TIPOS = ["admin", "atendimento", "triagem", "medico", "enfermagem"];
const SESSAO_HORAS = 12;
const MEDICAMENTOS = [
  "Dipirona 500 mg", "Dipirona 1 g (injetável)", "Paracetamol 750 mg", "Ibuprofeno 600 mg", "Cetoprofeno 100 mg",
  "Amoxicilina 500 mg", "Azitromicina 500 mg", "Cefalexina 500 mg", "Loratadina 10 mg", "Dexclorfeniramina 2 mg",
  "Omeprazol 20 mg", "Ondansetrona 8 mg", "Buscopan composto", "Dimenidrinato (Dramin)", "Soro fisiológico 0,9% 500 ml",
  "Soro de reidratação oral", "Salbutamol (inalação)", "Prednisolona 20 mg", "Captopril 25 mg", "AAS 100 mg"
];

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "200kb" }));

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
    console.error("[api]", req.method, req.url, e);
    erro(res, 500, "Erro interno no servidor. Tente novamente em instantes.");
  }
};
const falha = (status, message) => Object.assign(new Error(message), { status });

function publicoUsuario(u) {
  return { usuario: u.usuario, tipo: u.tipo, nome: u.nome || u.usuario, criadoEm: u.criadoEm || null };
}

function resumoPaciente(p) {
  return { ...p, idade: idade(p.nascimento) };
}

/** Senha do painel: N001 (normal) / P001 (preferencial). Reinicia a cada dia. */
function proximaSenha(db, preferencial) {
  const hoje = new Date().toISOString().slice(0, 10);
  if (db.contadores.dia !== hoje) db.contadores = { normal: 0, preferencial: 0, dia: hoje };
  const chave = preferencial ? "preferencial" : "normal";
  db.contadores[chave] += 1;
  return (preferencial ? "P" : "N") + String(db.contadores[chave]).padStart(3, "0");
}

// ---------- autenticação ----------
function tokenDe(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

function sessaoValida(db, token) {
  if (!token) return null;
  const s = db.sessoes.find(x => x.token === token);
  if (!s || new Date(s.expira) < new Date()) return null;
  const u = db.usuarios.find(x => x.usuario === s.usuario);
  return u ? publicoUsuario(u) : null;
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
      console.error("[auth]", e);
      erro(res, 500, "Não foi possível verificar a sessão.");
    }
  };
}

app.post("/api/login", rota(async (req, res) => {
  const usuario = texto(req.body?.usuario, 60), senha = String(req.body?.senha || "");
  if (!usuario || !senha) return erro(res, 400, "Informe usuário e senha.");
  const resultado = await store.alterar(db => {
    const u = db.usuarios.find(x => x.usuario.toLowerCase() === usuario.toLowerCase());
    if (!u || !store.senhaConfere(senha, u.senha)) return null;
    if (!String(u.senha).startsWith("scrypt$")) u.senha = store.hashSenha(senha);
    const token = crypto.randomBytes(24).toString("hex");
    const agora = new Date();
    db.sessoes = db.sessoes.filter(s => new Date(s.expira) > agora).slice(-200);
    db.sessoes.push({ token, usuario: u.usuario, criadaEm: agora.toISOString(), expira: new Date(agora.getTime() + SESSAO_HORAS * 3600e3).toISOString() });
    return { token, ...publicoUsuario(u) };
  });
  if (!resultado) return erro(res, 401, "Usuário ou senha incorretos.");
  res.json(resultado);
}));

app.post("/api/logout", rota(async (req, res) => {
  const token = tokenDe(req);
  if (token) await store.alterar(db => { db.sessoes = db.sessoes.filter(s => s.token !== token); });
  res.json({ ok: true });
}));

app.get("/api/me", exigir(), (req, res) => res.json(req.usuario));

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
  if (senha.length < 3) return erro(res, 400, "A senha precisa de pelo menos 3 caracteres.");
  if (!TIPOS.includes(tipo)) return erro(res, 400, "Perfil inválido.");
  const novo = await store.alterar(db => {
    if (db.usuarios.some(u => u.usuario.toLowerCase() === usuario)) throw falha(409, "Esse usuário já existe.");
    const u = { usuario, nome: nome || usuario, tipo, senha: store.hashSenha(senha), criadoEm: agoraISO() };
    db.usuarios.push(u);
    return publicoUsuario(u);
  });
  res.status(201).json(novo);
}));

app.delete("/api/usuarios/:usuario", exigir("admin"), rota(async (req, res) => {
  const alvo = String(req.params.usuario).toLowerCase();
  if (alvo === req.usuario.usuario.toLowerCase()) return erro(res, 400, "Você não pode excluir o próprio usuário.");
  await store.alterar(db => {
    const antes = db.usuarios.length;
    db.usuarios = db.usuarios.filter(u => u.usuario.toLowerCase() !== alvo);
    if (db.usuarios.length === antes) throw falha(404, "Usuário não encontrado.");
    if (!db.usuarios.some(u => u.tipo === "admin")) throw falha(400, "O sistema precisa de pelo menos um administrador.");
    db.sessoes = db.sessoes.filter(s => s.usuario.toLowerCase() !== alvo);
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
  const nome = texto(req.body?.nome, 100);
  const cpf = somenteDigitos(req.body?.cpf);
  const nascimento = texto(req.body?.nascimento, 10);
  const telefone = texto(req.body?.telefone, 20);
  const convenio = texto(req.body?.convenio, 60) || "Particular";
  const motivoPreferencial = texto(req.body?.motivoPreferencial, 40);
  if (nome.length < 3) return erro(res, 400, "Informe o nome completo do paciente.");
  if (!cpfValido(cpf)) return erro(res, 400, "CPF inválido. Confira os números digitados.");
  if (nascimento && (Number.isNaN(new Date(nascimento).getTime()) || new Date(nascimento) > new Date())) return erro(res, 400, "Data de nascimento inválida.");
  const anos = idade(nascimento);
  const preferencial = !!motivoPreferencial || (anos !== null && anos >= 60);
  const paciente = await store.alterar(db => {
    const ativo = db.pacientes.find(p => p.cpf === formatarCpf(cpf) && !["finalizado", "desistiu"].includes(p.status));
    if (ativo) throw falha(409, "Este CPF já está em atendimento (senha " + ativo.senha + ").");
    const p = {
      id: novoId(), senha: proximaSenha(db, preferencial), nome, cpf: formatarCpf(cpf), nascimento: nascimento || null, telefone,
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
    const c = {
      id: novoId(), pacienteId: p.id, paciente: p.nome, senha: p.senha, risco: p.triagem?.risco || null,
      local, localNome: LOCAIS[local], numero: numero.padStart(2, "0"), por: req.usuario.nome, em: agoraISO()
    };
    db.tv.atual = c;
    db.tv.historico = [c, ...db.tv.historico.filter(h => h.pacienteId !== p.id || h.local !== local)].slice(0, 12);
    p.chamadas = (p.chamadas || 0) + 1;
    p.historico.push({ em: agoraISO(), evento: "Chamado na TV · " + LOCAIS[local] + " " + c.numero, por: req.usuario.nome });
    return c;
  });
  res.status(201).json(chamada);
}));

// Pública: a TV da sala de espera não faz login.
app.get("/api/tv/chamada", rota(async (req, res) => {
  const db = await store.ler();
  res.set("Cache-Control", "no-store");
  res.json({ atual: db.tv.atual, historico: db.tv.historico.slice(0, 6) });
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
  await store.alterar(db => {
    db.pacientes = [];
    db.tv = { atual: null, historico: [] };
    db.contadores = { normal: 0, preferencial: 0, dia: null };
  });
  res.json({ ok: true });
}));

app.get("/api/health", rota(async (req, res) => {
  const m = store.modo();
  let ok = true;
  try { await store.ler(); } catch (e) { ok = false; }
  res.json({ ok, servico: "Saúde+ Sentinela", armazenamento: m, persistente: m !== "temporario" });
}));

app.use("/api", (req, res) => erro(res, 404, "Rota da API não encontrada."));

// Arquivos do site (no computador; na Vercel quem serve é a própria plataforma).
app.use(express.static(path.join(__dirname, "../frontend"), { extensions: ["html"] }));

module.exports = app;
