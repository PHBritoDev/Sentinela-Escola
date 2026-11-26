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
  if (!armazenada || !String(armazenada).startsWith("scrypt$")) return false; // texto puro nunca autentica
  const [, sal, hash] = String(armazenada).split("$");
  const teste = crypto.scryptSync(String(digitada), sal, 32);
  const ok = Buffer.from(hash, "hex");
  return ok.length === teste.length && crypto.timingSafeEqual(ok, teste);
}

// ---------- formato do banco ----------
// Produção = Render, Vercel ou NODE_ENV=production. Em produção NUNCA existem contas de demonstração nem senha padrão:
// o administrador vem de SENTINELA_ADMIN_USER / SENTINELA_ADMIN_PASSWORD (segredos da plataforma) e, sem eles, a API
// falha fechada. No computador, sem as variáveis, é gerada uma senha aleatória gravada em backend/data/ (fora do Git).
const PERFIS = ["admin", "atendimento", "triagem", "medico", "enfermagem"];
const DEMO_LEGADO = { admin: "admin123", atendimento: "123", triagem: "123", medico: "123", enfermagem: "123" };
const VERSAO = 3;
let conferido = null;

function producao() {
  return process.env.NODE_ENV === "production" || !!process.env.RENDER || !!process.env.VERCEL;
}

function credenciaisAdmin() {
  const usuario = String(process.env.SENTINELA_ADMIN_USER || "").trim().toLowerCase();
  // remove espaços/quebras de linha nas pontas (comum ao colar no painel da plataforma)
  const senha = String(process.env.SENTINELA_ADMIN_PASSWORD || "").trim();
  if (usuario || senha || producao()) {
    if (!/^[a-z0-9._-]{3,40}$/.test(usuario)) throw new Error("Configure SENTINELA_ADMIN_USER (3 a 40 caracteres: letras, números, ponto, hífen).");
    if (senha.length < 8) throw new Error("Configure SENTINELA_ADMIN_PASSWORD com pelo menos 8 caracteres.");
    return { usuario, senha, origem: "ambiente" };
  }
  // Desenvolvimento local sem variáveis: senha aleatória, gravada só no disco local (nunca em log, Git ou resposta da API).
  const arq = path.join(__dirname, "data", "credenciais-locais.txt");
  try {
    const [u, s] = fs.readFileSync(arq, "utf8").trim().split("\n").map(l => l.split("=").slice(1).join("="));
    if (u && s && s.length >= 16) return { usuario: u, senha: s, origem: "local" };
  } catch { /* gera abaixo */ }
  const nova = { usuario: "admin", senha: crypto.randomBytes(18).toString("base64url"), origem: "local" };
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, "usuario=" + nova.usuario + "\nsenha=" + nova.senha + "\n", { mode: 0o600 });
  return nova;
}

function adminInicial() {
  const c = credenciaisAdmin();
  return { usuario: c.usuario, senha: hashSenha(c.senha), tipo: "admin", nome: "Administração", criadoEm: new Date().toISOString() };
}

function bancoVazio() {
  return {
    versao: VERSAO,
    usuarios: [adminInicial()],
    sessoes: [],
    pacientes: [],
    tv: { atual: null, historico: [] },
    contadores: { normal: 0, preferencial: 0, dia: null, simulacao: 0 },
    estoque: [],
    auditoria: []
  };
}

/** Conta de demonstração antiga ainda com a senha pública conhecida? (precisa sair de qualquer banco existente) */
function contaDemoInsegura(u) {
  const nome = String(u?.usuario || "").toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(DEMO_LEGADO, nome)) return false;
  const s = String(u.senha || "");
  return s === DEMO_LEGADO[nome] || senhaConfere(DEMO_LEGADO[nome], s);
}

/** Garante a estrutura atual, migra bancos antigos e remove contas/sessões inseguras. */
function normalizar(db) {
  if (!db || typeof db !== "object") return bancoVazio();
  const antigo = db.versao !== VERSAO;
  db.usuarios = (Array.isArray(db.usuarios) ? db.usuarios : []).filter(u => u && u.usuario && !contaDemoInsegura(u));
  for (const u of db.usuarios) {
    if (!PERFIS.includes(u.tipo)) u.tipo = "atendimento";
    if (!String(u.senha || "").startsWith("scrypt$")) u.senha = null; // senha em texto puro: conta bloqueada até o admin redefinir
  }
  db.sessoes = antigo ? [] : (Array.isArray(db.sessoes) ? db.sessoes : []); // migração revoga todas as sessões antigas
  db.pacientes = Array.isArray(db.pacientes) ? db.pacientes : [];
  db.tv = db.tv && typeof db.tv === "object" ? db.tv : { atual: null, historico: [] };
  db.tv.historico = Array.isArray(db.tv.historico) ? db.tv.historico : [];
  db.contadores = { normal: 0, preferencial: 0, dia: null, simulacao: 0, ...(db.contadores || {}) };
  db.estoque = Array.isArray(db.estoque) ? db.estoque : [];
  db.auditoria = Array.isArray(db.auditoria) ? db.auditoria : [];
  // Privacidade: nenhum CPF, telefone ou data de nascimento real; cada paciente recebe um código fictício SIM-0000.
  for (const p of db.pacientes) {
    if (!p.codigo) { db.contadores.simulacao += 1; p.codigo = "SIM-" + String(db.contadores.simulacao).padStart(4, "0"); }
    if (p.nascimento && p.idade == null) { const n = new Date(p.nascimento); if (!Number.isNaN(n.getTime())) p.idade = Math.max(0, new Date().getFullYear() - n.getFullYear()); }
    delete p.cpf; delete p.telefone; delete p.nascimento;
  }
  for (const c of [db.tv.atual, ...db.tv.historico]) if (c) delete c.paciente; // TV pública: só senha e local
  // Administrador da plataforma: sempre existe e a senha acompanha o segredo (girar o segredo = girar a senha).
  const c = credenciaisAdmin();
  const adm = db.usuarios.find(u => u.usuario.toLowerCase() === c.usuario);
  if (!adm) db.usuarios.unshift({ usuario: c.usuario, senha: hashSenha(c.senha), tipo: "admin", nome: "Administração", criadoEm: new Date().toISOString() });
  else {
    adm.tipo = "admin";
    const chave = adm.senha + "|" + c.senha; // scrypt é caro: confere só quando o hash ou o segredo mudam
    if (conferido !== chave) {
      if (!senhaConfere(c.senha, adm.senha)) { adm.senha = hashSenha(c.senha); db.sessoes = db.sessoes.filter(s => s.usuario !== adm.usuario); }
      conferido = adm.senha + "|" + c.senha;
    }
  }
  db.versao = VERSAO;
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
  const inicial = normalizar(lerSemente());
  await redis(["SET", KEY, JSON.stringify(inicial)]);
  return inicial;
}

async function ler() {
  const armazenamento = modo();
  if (process.env.VERCEL && armazenamento !== "redis") {
    throw new Error("Redis persistente obrigatório na Vercel. Conecte o banco antes de usar a API.");
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

module.exports = { ler, alterar, modo, hashSenha, senhaConfere, bancoVazio, normalizar, producao, credenciaisAdmin, PERFIS };
