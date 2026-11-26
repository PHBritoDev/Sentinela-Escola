/**
 * Cenário de demonstração (dados 100% sintéticos): nomes inventados, idades aproximadas, código SIM-0000.
 * Serve para apresentar o fluxo sem digitar nada. Todos os registros levam demo=true e podem ser removidos sem afetar
 * os demais. Nada aqui é orientação clínica: as condutas são exemplos educacionais.
 */
const { RISCOS, SINTOMAS, classificarRisco } = require("./triagem");

const NOMES = ["Lia Monteverde", "Caio Brandão Lume", "Teodora Vaz Ilha", "Benício Arraial", "Maru Quintela", "Otávio Seixas Rio", "Nina Corá", "Ravi Tambor"];

function cenarioDemo(agora, codigo, senha, novoId) {
  const min = m => new Date(agora.getTime() - m * 60000).toISOString();
  const base = (i, idade, criadoMin) => {
    const pref = idade >= 60;
    return {
      id: novoId(), codigo: codigo(), senha: senha(pref), nome: NOMES[i] + " (fictício)", idade, convenio: i % 2 ? "Particular" : "Convênio escolar",
      preferencial: pref, motivoPreferencial: pref ? "Idoso (60+)" : "", status: "aguardando_triagem", criadoEm: min(criadoMin), cadastradoPor: "demonstração",
      triagem: null, consulta: null, medicacao: null, demo: true, historico: [{ em: min(criadoMin), evento: "Cadastro na recepção", por: "Demonstração" }]
    };
  };
  const triar = (p, dados, aposMin) => {
    const c = classificarRisco(dados);
    p.triagem = { ...dados, sintomaNome: SINTOMAS[dados.sintoma].nome, alergia: "Nega alergias", observacao: "Registro de demonstração.", peso: "", risco: c.risco, motivos: c.motivos, por: "Demonstração", em: min(aposMin) };
    p.status = "aguardando_medico";
    p.historico.push({ em: min(aposMin), evento: "Triagem · " + RISCOS[c.risco].nome, por: "Demonstração" });
  };
  const lista = [];
  // 1–2 aguardando triagem
  lista.push(base(0, 34, 6), base(1, 67, 3));
  // 3–5 aguardando médico (cores diferentes para mostrar a ordenação por gravidade)
  let p = base(2, 29, 38); triar(p, { sintoma: "febre", temperatura: 38.9, saturacao: 97, frequencia: 104, pressao: "120/80", dor: 4 }, 30); lista.push(p);
  p = base(3, 72, 25); triar(p, { sintoma: "falta_ar_moderada", temperatura: 36.8, saturacao: 92, frequencia: 112, pressao: "140/90", dor: 3 }, 20); lista.push(p);
  p = base(4, 19, 50); triar(p, { sintoma: "tosse", temperatura: 37.2, saturacao: 98, frequencia: 84, pressao: "118/76", dor: 1 }, 41); lista.push(p);
  // 6 em consulta
  p = base(5, 45, 70); triar(p, { sintoma: "dor_abdominal", temperatura: 37.4, saturacao: 98, frequencia: 92, pressao: "125/82", dor: 6 }, 60);
  p.status = "em_atendimento"; p.medico = "Plantão (demonstração)"; p.consultorio = "02"; p.historico.push({ em: min(12), evento: "Início da consulta", por: "Demonstração" }); lista.push(p);
  // 7 aguardando medicação
  p = base(6, 8, 95); triar(p, { sintoma: "vomito", temperatura: 37.9, saturacao: 99, frequencia: 110, pressao: "", dor: 3 }, 85);
  p.consulta = { diagnostico: "Exemplo didático: gastroenterite", medicacoes: [{ nome: "Soro de reidratação oral", posologia: "Exemplo educacional", via: "Oral" }], orientacoes: "Conteúdo de simulação escolar.", desfecho: "medicacao", medico: "Plantão (demonstração)", em: min(30) };
  p.status = "aguardando_medicacao"; p.historico.push({ em: min(30), evento: "Consulta · Encaminhado à medicação", por: "Demonstração" }); lista.push(p);
  // 8 alta (para os indicadores de tempo)
  p = base(7, 52, 140); triar(p, { sintoma: "dor_leve", temperatura: 36.6, saturacao: 99, frequencia: 76, pressao: "122/80", dor: 2 }, 128);
  p.consulta = { diagnostico: "Exemplo didático: cefaleia leve", medicacoes: [], orientacoes: "Conteúdo de simulação escolar.", desfecho: "alta", medico: "Plantão (demonstração)", em: min(70) };
  p.status = "finalizado"; p.finalizadoEm = min(70); p.historico.push({ em: min(70), evento: "Consulta · Alta médica", por: "Demonstração" }); lista.push(p);
  return lista;
}

const ESTOQUE_INICIAL = [
  { nome: "Luvas de procedimento (M)", categoria: "EPI", unidade: "cx", quantidade: 18, minimo: 6 },
  { nome: "Máscara cirúrgica", categoria: "EPI", unidade: "cx", quantidade: 4, minimo: 8 },
  { nome: "Seringa 5 ml", categoria: "Material", unidade: "un", quantidade: 140, minimo: 50 },
  { nome: "Gaze estéril", categoria: "Curativo", unidade: "pct", quantidade: 0, minimo: 20 },
  { nome: "Soro fisiológico 0,9% 500 ml", categoria: "Soluções", unidade: "fr", quantidade: 32, minimo: 20 },
  { nome: "Termômetro digital", categoria: "Equipamento", unidade: "un", quantidade: 6, minimo: 3 }
];

module.exports = { cenarioDemo, ESTOQUE_INICIAL };
