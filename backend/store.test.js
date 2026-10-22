const test = require("node:test");
const assert = require("node:assert/strict");
const store = require("./store");

test("Vercel requires Redis and bootstraps only an explicitly configured administrator", async () => {
  const keys = [
    "VERCEL",
    "DB_FILE",
    "KV_REST_API_URL",
    "KV_REST_API_TOKEN",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "SENTINELA_ADMIN_USER",
    "SENTINELA_ADMIN_PASSWORD"
  ];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.VERCEL = "1";
    for (const key of keys.filter(k => k !== "VERCEL")) delete process.env[key];
    await assert.rejects(store.ler(), /Redis persistente obrigatório/);

    process.env.SENTINELA_ADMIN_USER = "operador";
    process.env.SENTINELA_ADMIN_PASSWORD = "SenhaForteDeTeste-123!";
    const db = store.bancoVazio();
    assert.deepEqual(db.usuarios.map(u => u.usuario), ["operador"]);
    assert.ok(db.usuarios[0].senha.startsWith("scrypt$"));
    assert.equal(store.senhaConfere(process.env.SENTINELA_ADMIN_PASSWORD, db.usuarios[0].senha), true);

    process.env.SENTINELA_ADMIN_PASSWORD = "curta";
    assert.throws(() => store.bancoVazio(), /pelo menos 16 caracteres/);

    process.env.SENTINELA_ADMIN_PASSWORD = "SenhaForteDeTeste-123!";
    const legado = store.normalizar({
      versao: 1,
      usuarios: [
        { usuario: "admin", senha: "admin123", tipo: "admin" },
        { usuario: "atendimento", senha: "123", tipo: "atendimento" },
        { usuario: "profissional", senha: "outra", tipo: "medico" }
      ]
    });
    assert.deepEqual(legado.usuarios.map(u => u.usuario), ["operador", "profissional"]);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
