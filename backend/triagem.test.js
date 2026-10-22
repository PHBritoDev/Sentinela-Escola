const test = require("node:test");
const assert = require("node:assert/strict");
const { classificarRisco, compararFila } = require("./triagem");
const { cpfValido, formatarCpf, idade } = require("./validacao");

test("sintomas graves e sinais vitais críticos são vermelhos", () => {
  assert.equal(classificarRisco({ sintoma: "avc" }).risco, "vermelho");
  assert.equal(classificarRisco({ sintoma: "tosse", saturacao: 86 }).risco, "vermelho");
  assert.equal(classificarRisco({ sintoma: "febre", temperatura: 40.2 }).risco, "vermelho");
  assert.equal(classificarRisco({ sintoma: "dor_leve", pressao: "210/120" }).risco, "vermelho");
});

test("cada sinal sobe a cor e nunca a rebaixa", () => {
  assert.equal(classificarRisco({ sintoma: "resfriado" }).risco, "azul");
  assert.equal(classificarRisco({ sintoma: "resfriado", temperatura: 38.2 }).risco, "amarelo");
  assert.equal(classificarRisco({ sintoma: "resfriado", temperatura: "39,1" }).risco, "laranja");
  assert.equal(classificarRisco({ sintoma: "avc", temperatura: 36.5, dor: 0 }).risco, "vermelho");
  assert.equal(classificarRisco({ sintoma: "tosse", dor: 9 }).risco, "laranja");
  const r = classificarRisco({ sintoma: "febre", frequencia: 125 });
  assert.equal(r.risco, "laranja");
  assert.ok(r.motivos.length >= 2);
});

test("fila do médico: cor, depois preferencial, depois chegada", () => {
  const p = (risco, pref, min) => ({ preferencial: pref, triagem: { risco, em: new Date(2026, 0, 1, 10, min).toISOString() } });
  const fila = [p("verde", false, 1), p("amarelo", false, 5), p("verde", true, 9), p("vermelho", false, 20), p("amarelo", false, 2)].sort(compararFila);
  assert.deepEqual(fila.map(x => x.triagem.risco + (x.preferencial ? "*" : "") + x.triagem.em.slice(14, 16)), ["vermelho20", "amarelo02", "amarelo05", "verde*09", "verde01"]);
});

test("CPF validado pelos dígitos verificadores", () => {
  assert.equal(cpfValido("529.982.247-25"), true);
  assert.equal(cpfValido("52998224726"), false);
  assert.equal(cpfValido("111.111.111-11"), false);
  assert.equal(cpfValido("123"), false);
  assert.equal(formatarCpf("52998224725"), "529.982.247-25");
});

test("idade calculada pela data de nascimento", () => {
  assert.equal(idade("2000-06-15", new Date("2026-06-14")), 25);
  assert.equal(idade("2000-06-15", new Date("2026-06-15")), 26);
  assert.equal(idade(""), null);
});
