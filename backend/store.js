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
const LOCK_KEY = `${KEY}:lock`;
const LOCK_TTL_MS = 60_000;
const LOCK_WAIT_MS = 10_000;

// Treat hosted production services as production even when the provider does not set VERCEL.
function emProducao() {
  return process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
}

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

function modo() {
  if (redisConfig()) return "redis";
  if (emProducao()) return "temporario";
  if (process.env.DB_FILE) return "arquivo";
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
  if (!emProducao()) {
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
  const usuarios = emProducao()
    ? [adminInicial()]
    : USUARIOS_PADRAO.map(u => ({ ...u, senha: hashSenha(u.senha), criadoEm: new Date().toISOString() }));
  return {
    versao: 3,
    usuarios,
    sessoes: [],
    pacientes: [],
    tv: { atual: null, historico: [] },
    contadores: { normal: 0, preferencial: 0, dia: null }
  };
}

/** Garante a estrutura atual e remove as contas de demonstração ao migrar para produção. */
function normalizar(db) {
  if (!db || typeof db !== "object") return bancoVazio();
  if (db.versao !== 2 && db.versao !== 3) {
    const novo = bancoVazio();
    const nomesDemo = new Set(USUARIOS_PADRAO.map(u => u.usuario));
    const antigos = (Array.isArray(db.usuarios) ? db.usuarios : [])
      .filter(u => !emProducao() || !nomesDemo.has(String(u?.usuario || "").toLowerCase()));
    for (const u of antigos) {
      if (!u || !u.usuario || novo.usuarios.some(x => x.usuario === u.usuario)) continue;
      const tipo = ["admin", "atendimento", "triagem", "medico", "enfermagem"].includes(u.tipo) ? u.tipo : "atendimento";
      novo.usuarios.push({ usuario: u.usuario, senha: hashSenha(u.senha || "123"), tipo, nome: u.usuario, criadoEm: new Date().toISOString() });
    }
    return novo;
  }
  if (db.versao === 2) {
    if (emProducao()) {
      const nomesDemo = new Set(USUARIOS_PADRAO.map(u => u.usuario));
      db.usuarios = (Array.isArray(db.usuarios) ? db.usuarios : [])
        .filter(u => !nomesDemo.has(String(u?.usuario || "").toLowerCase()));
      db.sessoes = (Array.isArray(db.sessoes) ? db.sessoes : [])
        .filter(s => !nomesDemo.has(String(s?.usuario || "").toLowerCase()));
    }
    db.versao = 3;
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
    body: JSON.stringify(cmd),
    signal: AbortSignal.timeout(10_000)
  });
  if (!r.ok) throw new Error("Banco Redis respondeu " + r.status);
  const j = await r.json();
  if (j.error) throw new Error("Banco Redis: " + j.error);
  return j.result;
}

function lerSemente() {
  try { return JSON.parse(fs.readFileSync(SEED_FILE, "utf8")); } catch { return null; }
}

async function adquirirLockRedis() {
  const token = crypto.randomBytes(24).toString("hex");
  const limite = Date.now() + LOCK_WAIT_MS;
  while (Date.now() < limite) {
    const resultado = await redis(["SET", LOCK_KEY, token, "NX", "PX", LOCK_TTL_MS]);
    if (resultado === "OK") return token;
    await new Promise(resolve => setTimeout(resolve, 75));
  }
  throw new Error("Banco ocupado; a gravação não foi feita. Tente novamente.");
}

async function liberarLockRedis(token) {
  const script = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";
  try { await redis(["EVAL", script, 1, LOCK_KEY, token]); } catch { /* a expiração automática libera o lock */ }
}

async function lerRedisComLock() {
  const bruto = await redis(["GET", KEY]);
  if (bruto) return normalizar(JSON.parse(bruto));
  const inicial = emProducao() ? bancoVazio() : normalizar(lerSemente());
  await redis(["SET", KEY, JSON.stringify(inicial)]);
  return inicial;
}

async function ler() {
  const armazenamento = modo();
  if (emProducao() && armazenamento !== "redis") {
    throw new Error("Redis persistente obrigatório em produção. Configure o banco antes de usar a API.");
  }
  if (armazenamento === "redis") {
    const bruto = await redis(["GET", KEY]);
    if (bruto) return normalizar(JSON.parse(bruto));
    const token = await adquirirLockRedis();
    try { return await lerRedisComLock(); }
    finally { await liberarLockRedis(token); }
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

// Fila local mais lock no Redis: evita sobrescritas entre processos diferentes da Vercel.
let fila = Promise.resolve();
function alterar(fn) {
  const tarefa = fila.then(async () => {
    if (modo() === "redis") {
      const token = await adquirirLockRedis();
      try {
        const db = await lerRedisComLock();
        const resultado = await fn(db);
        await gravar(db);
        return resultado;
      } finally {
        await liberarLockRedis(token);
      }
    }
    const db = await ler();
    const resultado = await fn(db);
    await gravar(db);
    return resultado;
  });
  fila = tarefa.catch(() => {});
  return tarefa;
}

module.exports = { ler, alterar, modo, hashSenha, senhaConfere, bancoVazio, normalizar };
