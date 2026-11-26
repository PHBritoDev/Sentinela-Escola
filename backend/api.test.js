const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "sentinela-"));
process.env.DB_FILE = path.join(pasta, "db.json");
process.env.SENTINELA_ADMIN_USER = "diretoria";
process.env.SENTINELA_ADMIN_PASSWORD = "Senha-Somente-De-Teste-" + Date.now();
const ADM = [process.env.SENTINELA_ADMIN_USER, process.env.SENTINELA_ADMIN_PASSWORD];
const app = require("./app");

let base, server;
test.before(async () => { server = app.listen(0); await new Promise(r => server.once("listening", r)); base = "http://127.0.0.1:" + server.address().port; });
test.after(() => server.close());

/** Cliente com "pote" de cookie próprio, como um navegador. */
function cliente() {
  let cookie = "";
  const c = async (metodo, rota, corpo, extra = {}) => {
    const r = await fetch(base + rota, { method: metodo, headers: { "Content-Type": "application/json", "X-Saude-Plus": "1", ...(cookie ? { Cookie: cookie } : {}), ...extra }, body: corpo && metodo !== "GET" ? JSON.stringify(corpo) : undefined });
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = /Max-Age=0/.test(sc) ? "" : sc.split(";")[0];
    c.ultimoSetCookie = sc;
    let dados = null; try { dados = await r.json(); } catch { /* sem corpo */ }
    return { status: r.status, dados, headers: r.headers };
  };
  c.login = async (u, s) => { const r = await c("POST", "/api/login", { usuario: u, senha: s }); assert.equal(r.status, 200, "login " + u); return r; };
  return c;
}
const anon = cliente();
const adm = cliente();
const SENHA = "Equipe-Teste-Forte-9!";

test("login do admin vem do segredo; cookie HttpOnly e token fora do corpo", async () => {
  const r = await adm.login(...ADM);
  assert.equal(r.dados.tipo, "admin");
  assert.equal(r.dados.token, undefined);
  assert.match(adm.ultimoSetCookie, /HttpOnly/);
  assert.match(adm.ultimoSetCookie, /SameSite=Strict/);
  assert.match(r.dados.aviso, /Simulação escolar/);
  for (const [u, s] of [["admin", "admin123"], ["atendimento", "123"], ["medico", "123"]]) assert.equal((await anon("POST", "/api/login", { usuario: u, senha: s })).status, 401, "conta demo " + u + " não existe");
  for (const [u, t] of [["recep", "atendimento"], ["tria", "triagem"], ["doc", "medico"], ["enf", "enfermagem"]])
    assert.equal((await adm("POST", "/api/usuarios", { usuario: u, nome: "Equipe " + u, senha: SENHA, tipo: t })).status, 201);
});

test("CSRF: escrita sem o cabeçalho X-Saude-Plus é recusada", async () => {
  const r = await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuario: ADM[0], senha: ADM[1] }) });
  assert.equal(r.status, 403);
});

test("cabeçalhos de segurança e arquivos internos não servidos", async () => {
  const r = await fetch(base + "/");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  const html = await r.text();
  assert.doesNotMatch(html, /admin123|senha: ?"?123/i, "login sem credenciais de demonstração");
  for (const rota of ["/../backend/db.json", "/backend/db.json", "/.env", "/package.json", "/db.json"]) assert.notEqual((await fetch(base + rota)).status, 200, rota);
});

test("fluxo completo sem CPF, com código SIM e TV sem nome", async () => {
  const rec = cliente(), tri = cliente(), med = cliente(), enf = cliente();
  await rec.login("recep", SENHA); await tri.login("tria", SENHA); await med.login("doc", SENHA); await enf.login("enf", SENHA);
  assert.equal((await anon("GET", "/api/pacientes")).status, 401);
  assert.equal((await rec("POST", "/api/pacientes", { nome: "Al" })).status, 400);
  assert.equal((await rec("POST", "/api/pacientes", { nome: "Ana Fictícia", idade: 140 })).status, 400);
  const cad = await rec("POST", "/api/pacientes", { nome: "Ana Fictícia", idade: 67, cpf: "529.982.247-25", telefone: "11999999999" });
  assert.equal(cad.status, 201);
  const p = cad.dados;
  assert.match(p.codigo, /^SIM-\d{4}$/);
  assert.equal(p.cpf, undefined); assert.equal(p.telefone, undefined); assert.equal(p.nascimento, undefined);
  assert.equal(p.preferencial, true);
  assert.equal((await rec("POST", "/api/pacientes", { nome: "ana fictícia" })).status, 409, "nome ativo repetido pede confirmação");
  assert.equal((await rec("POST", "/api/pacientes", { nome: "ana fictícia", confirmarDuplicado: true })).status, 201);

  assert.equal((await rec("POST", "/api/pacientes/" + p.id + "/triagem", { sintoma: "febre" })).status, 403);
  const ch = await tri("POST", "/api/tv/chamar", { pacienteId: p.id, local: "triagem", numero: "2" });
  assert.equal(ch.status, 201);
  const tv = (await anon("GET", "/api/tv/chamada")).dados;
  assert.equal(tv.atual.localNome, "TRIAGEM"); assert.equal(tv.atual.numero, "02");
  assert.equal(JSON.stringify(tv).includes("Ana"), false, "TV pública não expõe nomes");
  assert.deepEqual(Object.keys(tv.atual).sort(), ["em", "id", "local", "localNome", "numero", "senha"]);

  const t = await tri("POST", "/api/pacientes/" + p.id + "/triagem", { sintoma: "febre", temperatura: "39,4", saturacao: 96, pressao: "130/85" });
  assert.equal(t.dados.status, "aguardando_medico");
  assert.equal((await tri("POST", "/api/pacientes/" + p.id + "/iniciar", {})).status, 403);
  assert.equal((await med("POST", "/api/pacientes/" + p.id + "/iniciar", { consultorio: "3" })).dados.status, "em_atendimento");
  const c = await med("POST", "/api/pacientes/" + p.id + "/consulta", { diagnostico: "Exemplo", desfecho: "medicacao", medicacoes: [{ nome: "Item didático", posologia: "exemplo" }] });
  assert.equal(c.dados.status, "aguardando_medicacao");
  assert.equal((await rec("POST", "/api/pacientes/" + p.id + "/medicacao", {})).status, 403);
  const m = await enf("POST", "/api/pacientes/" + p.id + "/medicacao", {});
  assert.equal(m.dados.status, "finalizado");
  assert.ok(m.dados.historico.length >= 4);
});

test("permissões: perfis não-admin não chegam a rotas de admin; logout encerra a sessão", async () => {
  const rec = cliente(); await rec.login("recep", SENHA);
  for (const [m, r] of [["GET", "/api/usuarios"], ["POST", "/api/admin/demo"], ["POST", "/api/admin/limpar"], ["GET", "/api/admin/auditoria"], ["POST", "/api/admin/setor"], ["GET", "/api/estoque"]])
    assert.equal((await rec(m, r, {})).status, 403, m + " " + r);
  for (const [m, r] of [["GET", "/api/usuarios"], ["GET", "/api/estatisticas"], ["POST", "/api/estoque"], ["GET", "/api/me"]]) assert.equal((await anon(m, r, {})).status, 401, m + " " + r);
  assert.equal((await rec("POST", "/api/logout")).status, 200);
  assert.equal((await rec("GET", "/api/me")).status, 401);
  assert.equal((await adm("DELETE", "/api/usuarios/" + ADM[0])).status, 400, "admin da plataforma não pode ser removido");
});

test("cenário demo: confirmação obrigatória, carrega e remove só os fictícios; auditoria registra", async () => {
  assert.equal((await adm("POST", "/api/admin/demo", {})).status, 400);
  const r = await adm("POST", "/api/admin/demo", { confirmar: "DEMO" });
  assert.equal(r.status, 201); assert.equal(r.dados.pacientes, 8);
  const lista = (await adm("GET", "/api/pacientes")).dados;
  assert.equal(lista.filter(p => p.demo).length, 8);
  assert.ok(lista.filter(p => p.demo).every(p => /fictício/.test(p.nome) && /^SIM-/.test(p.codigo)));
  const reais = lista.filter(p => !p.demo).length;
  assert.equal((await adm("DELETE", "/api/admin/demo")).dados.removidos, 8);
  assert.equal((await adm("GET", "/api/pacientes")).dados.length, reais);
  assert.equal((await adm("POST", "/api/admin/limpar", {})).status, 400, "limpar exige digitar LIMPAR");
  const aud = (await adm("GET", "/api/admin/auditoria")).dados;
  assert.ok(aud.some(a => /cenário/.test(a.acao)));
  assert.equal(JSON.stringify(aud).includes(SENHA), false);
  assert.equal((await adm("POST", "/api/admin/setor", { setor: "triagem" })).status, 200);
});

test("almoxarifado: cadastro, entrada e saída sem estoque negativo", async () => {
  const enf = cliente(); await enf.login("enf", SENHA);
  const it = await enf("POST", "/api/estoque", { nome: "Gaze de teste", quantidade: 5, minimo: 2 });
  assert.equal(it.status, 201);
  assert.equal((await enf("POST", "/api/estoque", { nome: "gaze de teste" })).status, 409);
  assert.equal((await enf("POST", "/api/estoque/" + it.dados.id + "/movimento", { tipo: "saida", quantidade: 9 })).status, 409);
  assert.equal((await enf("POST", "/api/estoque/" + it.dados.id + "/movimento", { tipo: "entrada", quantidade: 3 })).dados.quantidade, 8);
  const med = cliente(); await med.login("doc", SENHA);
  assert.equal((await med("GET", "/api/estoque")).status, 200);
  assert.equal((await med("POST", "/api/estoque", { nome: "X item" })).status, 403);
});

test("limite de tentativas de login", async () => {
  const c = cliente();
  let ultimo;
  for (let i = 0; i < 8; i++) ultimo = (await c("POST", "/api/login", { usuario: "tria", senha: "errada" + i })).status;
  assert.equal(ultimo, 429);
});

test("dados persistem no arquivo com senhas em hash e sessões só como hash", async () => {
  const salvo = JSON.parse(fs.readFileSync(process.env.DB_FILE, "utf8"));
  assert.ok(salvo.usuarios.every(u => String(u.senha).startsWith("scrypt$")));
  assert.ok(salvo.sessoes.every(s => s.hash && !s.token));
  assert.equal(JSON.stringify(salvo).includes(ADM[1]), false);
});
