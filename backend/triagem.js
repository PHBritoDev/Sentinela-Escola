/**
 * Classificação de risco inspirada no Protocolo de Manchester (versão didática).
 * Recebe os sinais vitais e o sintoma principal e devolve a cor, o motivo e o tempo-alvo de espera.
 * Função pura: testada em backend/triagem.test.js.
 */
const RISCOS = {
  vermelho: { ordem: 0, nome: "Emergência", esperaMin: 0 },
  laranja: { ordem: 1, nome: "Muito urgente", esperaMin: 10 },
  amarelo: { ordem: 2, nome: "Urgente", esperaMin: 60 },
  verde: { ordem: 3, nome: "Pouco urgente", esperaMin: 120 },
  azul: { ordem: 4, nome: "Não urgente", esperaMin: 240 }
};

const SINTOMAS = {
  infarto: { nome: "Dor no peito / suspeita de infarto", risco: "vermelho" },
  avc: { nome: "Suspeita de AVC", risco: "vermelho" },
  convulsao: { nome: "Convulsão", risco: "vermelho" },
  hemorragia: { nome: "Hemorragia", risco: "vermelho" },
  falta_ar_grave: { nome: "Falta de ar grave", risco: "vermelho" },
  inconsciente: { nome: "Desmaio / inconsciência", risco: "vermelho" },
  falta_ar_moderada: { nome: "Falta de ar moderada", risco: "laranja" },
  trauma: { nome: "Trauma / fratura", risco: "laranja" },
  febre: { nome: "Febre", risco: "amarelo" },
  vomito: { nome: "Vômito", risco: "amarelo" },
  diarreia: { nome: "Diarreia", risco: "amarelo" },
  dor_abdominal: { nome: "Dor abdominal", risco: "amarelo" },
  tosse: { nome: "Tosse", risco: "verde" },
  dor_leve: { nome: "Dor leve", risco: "verde" },
  resfriado: { nome: "Resfriado", risco: "azul" },
  coriza: { nome: "Coriza", risco: "azul" },
  receita: { nome: "Renovação de receita / exame", risco: "azul" }
};

function numero(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Lê "120/80" (ou só "120") e devolve a sistólica. */
function sistolica(pressao) {
  if (!pressao) return null;
  const m = String(pressao).match(/(\d{2,3})/);
  return m ? Number(m[1]) : null;
}

function pior(a, b) {
  return RISCOS[a].ordem <= RISCOS[b].ordem ? a : b;
}

function classificarRisco(dados = {}) {
  const motivos = [];
  let risco = "azul";
  const subir = (cor, motivo) => {
    if (RISCOS[cor].ordem < RISCOS[risco].ordem) risco = cor;
    if (RISCOS[cor].ordem <= 2) motivos.push(motivo);
  };

  const s = SINTOMAS[dados.sintoma];
  if (s) subir(s.risco, s.nome);

  const temp = numero(dados.temperatura);
  if (temp !== null) {
    if (temp >= 40 || temp < 35) subir("vermelho", "Temperatura " + temp + " °C");
    else if (temp >= 39) subir("laranja", "Febre alta (" + temp + " °C)");
    else if (temp >= 38) subir("amarelo", "Febre (" + temp + " °C)");
  }

  const sat = numero(dados.saturacao);
  if (sat !== null) {
    if (sat < 90) subir("vermelho", "Saturação " + sat + "%");
    else if (sat < 94) subir("laranja", "Saturação " + sat + "%");
  }

  const fc = numero(dados.frequencia);
  if (fc !== null) {
    if (fc > 140 || fc < 40) subir("vermelho", "Frequência cardíaca " + fc + " bpm");
    else if (fc > 120) subir("laranja", "Frequência cardíaca " + fc + " bpm");
    else if (fc > 100) subir("amarelo", "Frequência cardíaca " + fc + " bpm");
  }

  const pas = sistolica(dados.pressao);
  if (pas !== null) {
    if (pas >= 200 || pas < 80) subir("vermelho", "Pressão " + dados.pressao);
    else if (pas >= 180) subir("laranja", "Pressão " + dados.pressao);
    else if (pas >= 160) subir("amarelo", "Pressão " + dados.pressao);
  }

  const dor = numero(dados.dor);
  if (dor !== null) {
    if (dor >= 8) subir("laranja", "Dor intensa (" + dor + "/10)");
    else if (dor >= 5) subir("amarelo", "Dor moderada (" + dor + "/10)");
    else if (dor >= 3) subir("verde", "Dor leve");
  }

  return { risco, motivos, ...RISCOS[risco] };
}

/** Ordem da fila médica: cor de risco, depois prioridade legal (idoso, gestante, PcD), depois chegada. */
function compararFila(a, b) {
  const ra = RISCOS[a.triagem?.risco || "azul"].ordem, rb = RISCOS[b.triagem?.risco || "azul"].ordem;
  if (ra !== rb) return ra - rb;
  if (!!a.preferencial !== !!b.preferencial) return a.preferencial ? -1 : 1;
  return new Date(a.triagem?.em || a.criadoEm) - new Date(b.triagem?.em || b.criadoEm);
}

module.exports = { RISCOS, SINTOMAS, classificarRisco, compararFila, pior };
