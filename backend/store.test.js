const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const store = require("./store");

test("Vercel requires Redis and bootstraps only an explicitly configured administrator", async () => {
  const keys = [
    "VERCEL",
    "NODE_ENV",
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

    // Render production must also fail closed without persistent Redis and remove demo users.
    delete process.env.VERCEL;
    process.env.NODE_ENV = "production";
    await assert.rejects(store.ler(), /Redis persistente obrigatório/);
    const hosted = store.normalizar({
      versao: 2,
      usuarios: [
        { usuario: "admin", senha: "admin123", tipo: "admin" },
        { usuario: "atendimento", senha: "123", tipo: "atendimento" },
        { usuario: "profissional", senha: "outra", tipo: "medico" }
      ],
      sessoes: [],
      pacientes: [{ id: "preserve-patient" }],
      tv: { atual: null, historico: [] },
      contadores: { normal: 0, preferencial: 0, dia: null }
    });
    assert.deepEqual(hosted.usuarios.map(u => u.usuario), ["operador", "profissional"]);
    assert.equal(hosted.versao, 3);
    assert.equal(hosted.pacientes[0].id, "preserve-patient");
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("Redis lock serializes writes from separate Vercel function instances", async () => {
  const keys = ["VERCEL", "DB_FILE", "KV_REST_API_URL", "KV_REST_API_TOKEN", "SENTINELA_ADMIN_USER", "SENTINELA_ADMIN_PASSWORD"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const previousFetch = global.fetch;
  const redisData = new Map();
  let instanceNumber = 0;
  try {
    process.env.VERCEL = "1";
    delete process.env.DB_FILE;
    process.env.KV_REST_API_URL = "https://redis.test";
    process.env.KV_REST_API_TOKEN = "test-token";
    process.env.SENTINELA_ADMIN_USER = "operador";
    process.env.SENTINELA_ADMIN_PASSWORD = "SenhaForteDeTeste-123!";

    global.fetch = async (_url, options) => {
      await new Promise(resolve => setTimeout(resolve, 2));
      const command = JSON.parse(options.body);
      const now = Date.now();
      let result = null;
      if (command[0] === "GET") {
        const entry = redisData.get(command[1]);
        if (entry && (!entry.expires || entry.expires > now)) result = entry.value;
      } else if (command[0] === "SET" && command[3] === "NX" && command[4] === "PX") {
        const entry = redisData.get(command[1]);
        if (!entry || entry.expires <= now) {
          redisData.set(command[1], { value: command[2], expires: now + Number(command[5]) });
          result = "OK";
        }
      } else if (command[0] === "SET") {
        redisData.set(command[1], { value: command[2] });
        result = "OK";
      } else if (command[0] === "EVAL") {
        const entry = redisData.get(command[3]);
        if (entry?.value === command[4]) {
          redisData.delete(command[3]);
          result = 1;
        }
      }
      return { ok: true, json: async () => ({ result }) };
    };

    const source = fs.readFileSync(path.join(__dirname, "store.js"), "utf8");
    const createStoreInstance = () => {
      const filename = path.join(__dirname, `store-instance-${++instanceNumber}.js`);
      const loaded = new Module(filename, module);
      loaded.filename = filename;
      loaded.paths = Module._nodeModulePaths(__dirname);
      loaded._compile(source, filename);
      return loaded.exports;
    };
    const first = createStoreInstance();
    const second = createStoreInstance();
    await Promise.all([first.ler(), second.ler()]);

    await Promise.all([
      first.alterar(async db => {
        const current = db.contadores.normal;
        await new Promise(resolve => setTimeout(resolve, 20));
        db.contadores.normal = current + 1;
      }),
      second.alterar(async db => {
        const current = db.contadores.normal;
        await new Promise(resolve => setTimeout(resolve, 20));
        db.contadores.normal = current + 1;
      })
    ]);
    assert.equal((await first.ler()).contadores.normal, 2);
  } finally {
    global.fetch = previousFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
