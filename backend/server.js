const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();

app.use(express.json());
app.use(cors());

app.use(express.static(path.join(__dirname, "../frontend")));

// A página administrativa fica na raiz do repositório.
app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(__dirname, "../admin.html"));
});

const DB_FILE = path.join(__dirname, "db.json");

function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    return {
      usuarios: [],
      pacientes: [],
      triagens: [],
      consultas: []
    };
  }

  return JSON.parse(fs.readFileSync(DB_FILE));
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// USUÁRIOS: listar sem expor senhas
app.get("/usuarios", (req, res) => {
  try {
    const db = readDB();
    res.json((db.usuarios || []).map(({ usuario, tipo }) => ({ usuario, tipo })));
  } catch (error) {
    console.error("Erro ao listar usuários:", error);
    res.status(500).json({ erro: "Não foi possível listar os usuários." });
  }
});

// USUÁRIOS: cadastrar
app.post("/usuarios", (req, res) => {
  try {
    const usuario = String(req.body?.usuario || "").trim();
    const senha = String(req.body?.senha || "");
    const tipo = String(req.body?.tipo || "").trim().toLowerCase();
    const tiposPermitidos = ["atendimento", "triagem", "medico"];

    if (!usuario || !senha || !tiposPermitidos.includes(tipo)) {
      return res.status(400).json({
        erro: "Informe usuário, senha e um tipo válido (atendimento, triagem ou medico)."
      });
    }

    const db = readDB();
    db.usuarios = Array.isArray(db.usuarios) ? db.usuarios : [];

    if (db.usuarios.some(u => String(u.usuario).toLowerCase() === usuario.toLowerCase())) {
      return res.status(409).json({ erro: "Esse usuário já está cadastrado." });
    }

    const novoUsuario = { usuario, senha, tipo };
    db.usuarios.push(novoUsuario);
    writeDB(db);

    return res.status(201).json({ usuario: novoUsuario.usuario, tipo: novoUsuario.tipo });
  } catch (error) {
    console.error("Erro ao cadastrar usuário:", error);
    return res.status(500).json({ erro: "Não foi possível salvar o usuário." });
  }
});

// LOGIN
app.post("/login", (req, res) => {
  const db = readDB();

  const user = db.usuarios.find(u =>
    u.usuario === req.body.usuario &&
    u.senha === req.body.senha
  );

  if (!user) {
    return res.status(401).json({
      erro: "Login inválido"
    });
  }

  res.json({ usuario: user.usuario, tipo: user.tipo });
});

// ATENDIMENTO
app.post("/atendimento", (req, res) => {
  const db = readDB();

  const paciente = {
    id: Date.now(),
    nome: req.body.nome,
    cpf: req.body.cpf,
    tipo: req.body.tipo,
    status: "triagem",
    createdAt: new Date()
  };

  db.pacientes.push(paciente);
  writeDB(db);

  res.json(paciente);
});

// TRIAGEM
app.post("/triagem", (req, res) => {
  const db = readDB();

  let risco = req.body.risco;

  if (req.body.temperatura >= 39) {
    risco = "vermelho";
  } else if (req.body.temperatura >= 38) {
    risco = "amarelo";
  } else if (!risco) {
    risco = "verde";
  }

  const triagem = {
    id: Date.now(),
    nome: req.body.nome,
    sintoma: req.body.sintoma,
    temperatura: req.body.temperatura,
    alergia: req.body.alergia,
    observacao: req.body.observacao,
    risco,
    status: "aguardando_medico",
    createdAt: new Date()
  };

  db.triagens.push(triagem);
  writeDB(db);

  res.json(triagem);
});

// LISTAR PACIENTES NA FILA DE TRIAGEM
app.get("/pacientes", (req, res) => {
  try {
    const db = readDB();
    res.json(Array.isArray(db.pacientes) ? db.pacientes : []);
  } catch (error) {
    console.error("Erro ao listar pacientes:", error);
    res.status(500).json({ erro: "Não foi possível listar os pacientes." });
  }
});

// LISTAR TRIAGENS
app.get("/triagens", (req, res) => {
  const db = readDB();
  res.json(db.triagens);
});

// IMPLEMENTADO: rota com lista fixa de medicações
app.get("/lista-medicacoes", (req, res) => {
  res.json([
    "Dipirona",
    "Paracetamol",
    "Ibuprofeno",
    "Amoxicilina",
    "Azitromicina",
    "Loratadina",
    "Omeprazol",
    "Buscopan",
    "Dramin",
    "Soro fisiológico"
  ]);
});

// CONSULTA
app.post("/consulta", (req, res) => {
  const db = readDB();

  const consulta = {
    id: Date.now(),
    paciente: req.body.paciente,
    diagnostico: req.body.diagnostico,
    medicacao: req.body.medicacao,
    obs: req.body.obs,
    createdAt: new Date()
  };

  db.consultas.push(consulta);
  writeDB(db);

  res.json(consulta);
});

// MEDICAÇÕES
app.get("/medicacoes", (req, res) => {
  const db = readDB();
  res.json(db.consultas);
});

// Verificação simples para confirmar que a API está ativa.
app.get("/health", (req, res) => {
  res.json({ ok: true, servico: "Sentinela-Escola" });
});

// START

const PORT = process.env.PORT
|| 3000;
app.listen(PORT, () => {
  console.log(`Porta ${PORT}`);
});
