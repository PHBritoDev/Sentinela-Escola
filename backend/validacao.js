/** Utilidades de texto sem dependências. (Modo escolar: o sistema não coleta nem valida CPF.) */
function somenteDigitos(v) {
  return String(v || "").replace(/\D/g, "");
}

function texto(v, max = 200) {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function textoLongo(v, max = 1000) {
  return String(v ?? "").trim().slice(0, max);
}

module.exports = { somenteDigitos, texto, textoLongo };
