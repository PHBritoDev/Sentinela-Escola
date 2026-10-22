/**
 * Armazenamento do sistema.
 *
 * Por que isto existe: na Vercel o disco das funções é somente leitura e cada requisição pode cair em uma
 * instância diferente. Gravar em backend/db.json "funcionava" no computador, mas lá o paciente sumia e a TV
 * nunca recebia a chamada. Agora há três modos:
 *   - "redis": Upstash Redis / Vercel KV (variáveis KV_REST_API_URL + KV_REST_API_TOKEN ou
 *     UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN). Persistente e compartilhado — use este no deploy.
 *   - "arquivo": backend/data/db.local.json, quando roda no computador (npm start). backend/db.json é só a
 *     semente inicial (usuários de demonstração) e não é alterado pelo sistema.
 *   - Na Vercel, Redis é obrigatório. Sem o banco, a API falha fechada em vez de gravar dados temporários.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SEED_FILE = path.join(__dirname, "db.json");
const KEY = process.env.SENTINELA_DB_KEY || "sentinela:db";

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

function modo() {
  if (redisConfig()) return "redis";
  if (process.env.DB_FILE) return "arquivo";
  if (process.env.VERCEL) return "temporario";
  return "arquivo";
}

function arquivoAtual() {
  if (process.env.DB_FILE) return process.env.DB_FILE;
  return modo() === "temporario" ? "/tmp/sentinela-db.json" : path.join(__dirname, "data", "db.local.json");
}

// ---------- senhas ----------
function hashSenha(senha) {
  const sal = crypto.randomBytes(12).toString("hex");
  const hash = crypto.scryptSync(String(senha), sal, 32).toString("hex");
  return "scrypt$" + sal + "$" + hash;
}

function senhaConfere(digitada, armazenada) {
  if (!armazenada) return false;
  if (!String(armazenada).startsWith("scrypt$")) return String(digitada) === String(armazenada);
  const [, sal, hash] = String(armazenada).split("$");
  const teste = crypto.scryptSync(String(digitada), sal, 32);
  const ok = Buffer.from(hash, "hex");
  return ok.length === teste.length && crypto.timingSafeEqual(ok, teste);
}

// ---------- formato do banco ----------
const USUARIOS_PADRAO = [
  { usuario: "admin", senha: "admin123", tipo: "admin", nome: "Administração" },
  { usuario: "atendimento", senha: "123", tipo: "atendimento", nome: "Recepção" },
  { usuario: "triagem", senha: "123", tipo: "triagem", nome: "Enfermagem da Triagem" },
  { usuario: "medico", senha: "123", tipo: "medico", nome: "Dr(a). Plantão" },
  { usuario: "enfermagem", senha: "123", tipo: "enfermagem", nome: "Sala de Medicação" }
];

function adminInicial() {
  if (!process.env.VERCEL) {
    const admin = USUARIOS_PADRAO.find(u => u.tipo === "admin");
    return { ...admin, senha: hashSenha(admin.senha), criadoEm: new Date().toISOString() };
  }

  const usuario = String(process.env.SENTINELA_ADMIN_USER || "").trim().toLowerCase();
  const senha = String(process.env.SENTINELA_ADMIN_PASSWORD || "");
  if (!/^[a-z0-9._-]{3,40}$/.test(usuario)) {
    throw new Error("Configure SENTINELA_ADMIN_USER (3 a 40 caracteres) antes da inicialização.");
  }
  if (senha.length < 16) {
    throw new Error("Configure SENTINELA_ADMIN_PASSWORD com pelo menos 16 caracteres antes da inicialização.");
  }
  return { usuario, senha: hashSenha(senha), tipo: "admin", nome: "Administração", criadoEm: new Date().toISOString() };
}

function bancoVazio() {
  const usuarios = process.env.VERCEL
    ? [adminInicial()]
    : USUARIOS_PADRAO.map(u => ({ ...u, senha: hashSenha(u.senha), criadoEm: new Date().toISOString() }));
  return {
    versao: 2,
    usuarios,
    sessoes: [],
    pacientes: [],
    tv: { atual: null, historico: [] },
    contadores: { normal: 0, preferencial: 0, dia: null }
  };
}

/** Garante a estrutura atual (aceita o db.json antigo do projeto e migra os usuários). */
function normalizar(db) {
  if (!db || typeof db !== "object") return bancoVazio();
  if (db.versao !== 2) {
    const novo = bancoVazio();
    const nomesDemo = new Set(USUARIOS_PADRAO.map(u => u.usuario));
    const antigos = (Array.isArray(db.usuarios) ? db.usuarios : [])
      .filter(u => !process.env.VERCEL || !nomesDemo.has(String(u?.usuario || "").toLowerCase()));
    for (const u of antigos) {
      if (!u || !u.usuario || novo.usuarios.some(x => x.usuario === u.usuario)) continue;
      const tipo = ["admin", "atendimento", "triagem", "medico", "enfermagem"].includes(u.tipo) ? u.tipo : "atendimento";
      novo.usuarios.push({ usuario: u.usuario, senha: hashSenha(u.senha || "123"), tipo, nome: u.usuario, criadoEm: new Date().toISOString() });
    }
    return novo;
  }
  db.usuarios = Array.isArray(db.usuarios) ? db.usuarios : [];
  db.sessoes = Array.isArray(db.sessoes) ? db.sessoes : [];
  db.pacientes = Array.isArray(db.pacientes) ? db.pacientes : [];
  db.tv = db.tv && typeof db.tv === "object" ? db.tv : { atual: null, historico: [] };
  db.tv.historico = Array.isArray(db.tv.historico) ? db.tv.historico : [];
  db.contadores = db.contadores || { normal: 0, preferencial: 0, dia: null };
  if (!db.usuarios.some(u => u.tipo === "admin")) db.usuarios.unshift(adminInicial());
  return db;
}

// ---------- leitura/escrita ----------
async function redis(cmd) {
  const cfg = redisConfig();
  const r = await fetch(cfg.url, {
    method: "POST",
    headers: { Authorization: "Bearer " + cfg.token, "Content-Type": "application/json" },
    body: JSON.stringify(cmd)
  });
  if (!r.ok) throw new Error("Banco Redis respondeu " + r.status);
  const j = await r.json();
  if (j.error) throw new Error("Banco Redis: " + j.error);
  return j.result;
}

function lerSemente() {
  try { return JSON.parse(fs.readFileSync(SEED_FILE, "utf8")); } catch { return null; }
}

async function ler() {
  const armazenamento = modo();
  if (process.env.VERCEL && armazenamento !== "redis") {
    throw new Error("Redis persistente obrigatório na Vercel. Conecte o banco antes de usar a API.");
  }
  if (armazenamento === "redis") {
    const bruto = await redis(["GET", KEY]);
    if (bruto) return normalizar(JSON.parse(bruto));
    const inicial = process.env.VERCEL ? bancoVazio() : normalizar(lerSemente());
    await redis(["SET", KEY, JSON.stringify(inicial)]);
    return inicial;
  }
  const arq = arquivoAtual();
  if (fs.existsSync(arq)) {
    try { return normalizar(JSON.parse(fs.readFileSync(arq, "utf8"))); } catch { /* arquivo corrompido: recomeça */ }
  }
  const inicial = normalizar(arq === SEED_FILE ? null : lerSemente());
  await gravar(inicial);
  return inicial;
}

async function gravar(db) {
  if (modo() === "redis") { await redis(["SET", KEY, JSON.stringify(db)]); return; }
  const arq = arquivoAtual(), tmp = arq + ".tmp";
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, arq);
}

// Fila simples: uma alteração por vez dentro da mesma instância (evita perder gravações simultâneas).
let fila = Promise.resolve();
function alterar(fn) {
  const tarefa = fila.then(async () => {
    const db = await ler();
    const resultado = await fn(db);
    await gravar(db);
    return resultado;
  });
  fila = tarefa.catch(() => {});
  return tarefa;
}

module.exports = { ler, alterar, modo, hashSenha, senhaConfere, bancoVazio, normalizar };
