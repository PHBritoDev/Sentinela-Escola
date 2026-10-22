/** Validações e utilidades sem dependências (testadas em backend/validacao.test.js). */
function somenteDigitos(v) {
  return String(v || "").replace(/\D/g, "");
}

/** CPF válido pelos dígitos verificadores (rejeita sequências repetidas como 111.111.111-11). */
function cpfValido(cpf) {
  const d = somenteDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const t of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < t; i++) soma += Number(d[i]) * (t + 1 - i);
    const dv = ((soma * 10) % 11) % 10;
    if (dv !== Number(d[t])) return false;
  }
  return true;
}

function formatarCpf(cpf) {
  const d = somenteDigitos(cpf);
  return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : d;
}

function texto(v, max = 200) {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function textoLongo(v, max = 1000) {
  return String(v ?? "").trim().slice(0, max);
}

function idade(nascimento, agora = new Date()) {
  if (!nascimento) return null;
  const n = new Date(nascimento);
  if (Number.isNaN(n.getTime())) return null;
  let a = agora.getFullYear() - n.getFullYear();
  const m = agora.getMonth() - n.getMonth();
  if (m < 0 || (m === 0 && agora.getDate() < n.getDate())) a--;
  return a;
}

module.exports = { somenteDigitos, cpfValido, formatarCpf, texto, textoLongo, idade };
