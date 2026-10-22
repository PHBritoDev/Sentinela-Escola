const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

process.env.DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sentinela-")), "db.json");
const app = require("./app");

let base, server;
test.before(async () => { server = app.listen(0); await new Promise(r => server.once("listening", r)); base = "http://127.0.0.1:" + server.address().port; });
test.after(() => server.close());

async function api(metodo, rota, corpo, token) {
  const r = await fetch(base + rota, { method: metodo, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
  return { status: r.status, dados: await r.json() };
}
const login = async (u, s = "123") => (await api("POST", "/api/login", { usuario: u, senha: s })).dados.token;

test("fluxo completo: recepção → triagem → médico → medicação → alta, com a TV recebendo as chamadas", async () => {
  assert.equal((await api("POST", "/api/login", { usuario: "medico", senha: "errada" })).status, 401);
  const rec = await login("atendimento"), tri = await login("triagem"), med = await login("medico"), enf = await login("enfermagem");
  assert.equal((await api("GET", "/api/pacientes")).status, 401, "API exige login");

  assert.equal((await api("POST", "/api/pacientes", { nome: "Ana", cpf: "111.111.111-11" }, rec)).status, 400);
  const cad = await api("POST", "/api/pacientes", { nome: "Ana Souza", cpf: "529.982.247-25", nascimento: "1950-03-02" }, rec);
  assert.equal(cad.status, 201);
  const p = cad.dados;
  assert.equal(p.status, "aguardando_triagem");
  assert.equal(p.preferencial, true, "60+ é preferencial");
  assert.match(p.senha, /^P\d{3}$/);
  assert.equal((await api("POST", "/api/pacientes", { nome: "Ana Souza", cpf: "52998224725" }, rec)).status, 409, "mesmo CPF não entra duas vezes");

  assert.equal((await api("POST", "/api/pacientes/" + p.id + "/triagem", { sintoma: "febre" }, rec)).status, 403, "recepção não faz triagem");
  const chamadaGuiche = await api("POST", "/api/tv/chamar", { pacienteId: p.id, local: "triagem", numero: "2" }, tri);
  assert.equal(chamadaGuiche.status, 201);
  let tv = (await api("GET", "/api/tv/chamada")).dados;
  assert.equal(tv.atual.paciente, "Ana Souza");
  assert.equal(tv.atual.localNome, "TRIAGEM");
  assert.equal(tv.atual.numero, "02");

  const t = await api("POST", "/api/pacientes/" + p.id + "/triagem", { sintoma: "febre", temperatura: "39,4", saturacao: 96, pressao: "130/85", alergia: "Dipirona" }, tri);
  assert.equal(t.status, 200);
  assert.equal(t.dados.status, "aguardando_medico");
  assert.equal(t.dados.triagem.risco, "laranja");

  const fila = (await api("GET", "/api/pacientes?status=aguardando_medico&fila=medico", null, med)).dados;
  assert.equal(fila[0].id, p.id);
  assert.equal((await api("POST", "/api/pacientes/" + p.id + "/iniciar", { consultorio: "3" }, med)).dados.status, "em_atendimento");
  await api("POST", "/api/tv/chamar", { pacienteId: p.id, local: "consultorio", numero: "3" }, med);
  tv = (await api("GET", "/api/tv/chamada")).dados;
  assert.equal(tv.atual.localNome, "CONSULTÓRIO");
  assert.equal(tv.historico.length, 2);

  assert.equal((await api("POST", "/api/pacientes/" + p.id + "/consulta", { diagnostico: "Gripe", desfecho: "medicacao" }, med)).status, 400, "medicação exige prescrição");
  const c = await api("POST", "/api/pacientes/" + p.id + "/consulta", { diagnostico: "Síndrome gripal", desfecho: "medicacao", medicacoes: [{ nome: "Paracetamol 750 mg", posologia: "1 cp agora" }] }, med);
  assert.equal(c.dados.status, "aguardando_medicacao");
  const m = await api("POST", "/api/pacientes/" + p.id + "/medicacao", {}, enf);
  assert.equal(m.dados.status, "finalizado");
  assert.ok(m.dados.historico.length >= 6);

  const nova = await api("POST", "/api/pacientes", { nome: "Ana Souza", cpf: "529.982.247-25" }, rec);
  assert.equal(nova.status, 201, "após a alta o mesmo CPF pode voltar");
});

test("admin gerencia usuários; outros perfis não", async () => {
  const adm = await login("admin", "admin123"), rec = await login("atendimento");
  assert.equal((await api("GET", "/api/usuarios", null, rec)).status, 403);
  assert.equal((await api("POST", "/api/usuarios", { usuario: "joana", nome: "Dra. Joana", senha: "abc123", tipo: "medico" }, adm)).status, 201);
  const usuarios = (await api("GET", "/api/usuarios", null, adm)).dados;
  assert.ok(usuarios.some(u => u.usuario === "joana"));
  assert.ok(usuarios.every(u => !("senha" in u)), "senhas nunca saem da API");
  assert.ok(await login("joana", "abc123"));
  assert.equal((await api("DELETE", "/api/usuarios/admin", null, adm)).status, 400);
  assert.equal((await api("DELETE", "/api/usuarios/joana", null, adm)).status, 200);
});

test("dados ficam salvos no arquivo entre leituras", async () => {
  const salvo = JSON.parse(fs.readFileSync(process.env.DB_FILE, "utf8"));
  assert.ok(salvo.pacientes.length >= 2);
  assert.ok(salvo.usuarios.every(u => u.senha.startsWith("scrypt$")), "senhas guardadas com hash");
});
