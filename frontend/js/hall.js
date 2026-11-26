/* Saúde+ · tela inicial: login + hospital 3D interativo. Tudo funciona sem o 3D (menu de setores e formulário). */
import { SETORES } from "./setores.js";

const $ = id => document.getElementById(id);
const SP = window.SP;
const mq = q => matchMedia(q).matches;
const reduzido = mq("(prefers-reduced-motion: reduce)");
const celular = mq("(max-width: 820px)");
const ler = (st, k) => { try { return st.getItem(k); } catch { return null; } };
const gravar = (st, k, v) => { try { v == null ? st.removeItem(k) : st.setItem(k, v); } catch { /* modo privado */ } };

let perfil = null, hospital = null, setorAtual = null;
let destino = new URLSearchParams(location.search).get("setor") || ler(sessionStorage, "sp.destino");

// ---------- acesso ----------
const pode = (s, p = perfil) => s.publico || (p && (p.tipo === "admin" || (s.perfis || []).includes(p.tipo)));
const nomePerfil = t => (SP.PERFIS[t] || {}).nome || t;
const quemAcessa = s => s.publico ? "Acesso público." : "Acesso: " + ["admin", ...(s.perfis || [])].map(nomePerfil).join(", ") + ".";
const inicioDe = p => (SP.PERFIS[p.tipo] || SP.PERFIS.atendimento).inicio;
const porModulo = { atendimento: "recepcao", triagem: "triagem", medico: "consultorio", medicacoes: "medicacao", almoxarifado: "almoxarifado", admin: "admin", tv: "tv" };
if (destino && porModulo[destino]) destino = porModulo[destino];

async function conferirSessao() {
  const s = SP.sessao();
  if (!s) return mostrarLogado(null);
  try {
    const r = await fetch("/api/me?sonda=1", { credentials: "same-origin", cache: "no-store" });
    if (!r.ok) throw 0;
    const u = await r.json(); SP.salvarSessao(u); mostrarLogado(u);
  } catch { SP.limparSessao(); mostrarLogado(null); }
}
function mostrarLogado(u) {
  perfil = u;
  $("logado").hidden = !u; $("entrar-bloco").hidden = !!u;
  if (u) { $("logado-nome").textContent = u.nome; $("logado-perfil").textContent = "Perfil: " + nomePerfil(u.tipo) + ". Toque em um setor do hospital ou vá direto ao seu."; $("logado-ir").href = inicioDe(u); $("alca-texto").textContent = "Conectado · " + nomePerfil(u.tipo); }
  if (setorAtual) mostrarSetor(setorAtual);
}

// ---------- login ----------
const erro = $("erro");
const mostrarErro = m => { erro.textContent = m; erro.classList.toggle("visivel", !!m); };
if (new URLSearchParams(location.search).has("expirou")) mostrarErro("Sua sessão expirou. Entre novamente.");
$("ver").onclick = e => { const i = $("senha"); i.type = i.type === "password" ? "text" : "password"; e.target.textContent = i.type === "password" ? "ver" : "ocultar"; e.target.setAttribute("aria-label", i.type === "password" ? "Mostrar senha" : "Ocultar senha"); };
$("form").addEventListener("submit", async e => {
  e.preventDefault(); mostrarErro("");
  const usuario = $("usuario").value.trim(), senha = $("senha").value;
  if (!usuario || !senha) return mostrarErro("Informe usuário e senha.");
  const b = $("entrar"); b.disabled = true; b.textContent = "Entrando…";
  try {
    const u = await SP.API.post("/login", { usuario, senha });
    SP.salvarSessao(u);
    const alvo = SETORES.find(s => s.id === destino);
    gravar(sessionStorage, "sp.destino", null);
    location.href = alvo && pode(alvo, u) ? alvo.href : inicioDe(u);
  } catch (err) { mostrarErro(err.message); b.disabled = false; b.textContent = "Entrar"; $("senha").select(); }
});
$("logado-sair").onclick = async () => { try { await SP.API.post("/logout"); } catch { /* ignora */ } SP.limparSessao(); mostrarLogado(null); };

// ---------- painel recolhível (celular) ----------
function painel(aberto) {
  $("painel").dataset.aberto = aberto ? "1" : "0"; $("alca").setAttribute("aria-expanded", aberto ? "true" : "false");
  document.body.classList.toggle("painel-aberto", !!aberto);
}
$("alca").onclick = () => painel($("painel").dataset.aberto !== "1");
$("form").addEventListener("focusin", () => painel(true));

// ---------- setores: menu, pontos 3D e cartão ----------
$("menu-lista").innerHTML = SETORES.map(s => '<button type="button" class="chip chip-setor" data-setor="' + s.id + '" style="--c:' + s.cor + '"><i></i>' + SP.esc(s.nome) + "</button>").join("");
$("pontos").innerHTML = SETORES.map(s => '<button type="button" class="hs" data-setor="' + s.id + '" style="--c:' + s.cor + '" aria-label="' + SP.esc(s.nome) + '"><i></i><span>' + SP.esc(s.nome) + "</span></button>").join("");
const pontos = Object.fromEntries([...document.querySelectorAll(".hs")].map(b => [b.dataset.setor, b]));
document.addEventListener("click", e => { const b = e.target.closest("[data-setor]"); if (b) selecionar(b.dataset.setor); });
for (const b of document.querySelectorAll("[data-setor]")) {
  const on = v => () => hospital && hospital.destacar(b.dataset.setor, v || setorAtual === b.dataset.setor);
  b.addEventListener("pointerenter", on(true)); b.addEventListener("pointerleave", on(false));
  b.addEventListener("focus", on(true)); b.addEventListener("blur", on(false));
}

function selecionar(id) {
  const s = SETORES.find(x => x.id === id); if (!s) return;
  if (setorAtual && setorAtual !== id && hospital) hospital.destacar(setorAtual, false);
  setorAtual = id; mostrarSetor(id);
  document.querySelectorAll("[data-setor]").forEach(b => b.classList.toggle("ativo", b.dataset.setor === id));
  if (hospital) { hospital.focar(id); hospital.destacar(id, true); }
  if (celular) painel(false);
}
function mostrarSetor(id) {
  const s = SETORES.find(x => x.id === id);
  $("setor").hidden = false; document.body.classList.add("com-setor");
  $("setor-cor").style.background = s.cor; $("setor-nome").textContent = s.nome; $("setor-desc").textContent = s.desc;
  const b = $("setor-abrir"); b.disabled = false;
  if (pode(s)) { $("setor-acesso").textContent = s.publico ? "Acesso público (sem dados de pacientes)." : "Seu perfil tem acesso."; b.textContent = "Abrir " + s.nome; }
  else if (perfil) { $("setor-acesso").textContent = "Seu perfil (" + nomePerfil(perfil.tipo) + ") não tem acesso. " + quemAcessa(s); b.textContent = "Sem acesso"; b.disabled = true; }
  else { $("setor-acesso").textContent = quemAcessa(s); b.textContent = "Entrar para acessar"; }
}
$("setor-abrir").onclick = () => {
  const s = SETORES.find(x => x.id === setorAtual);
  if (pode(s)) { if (s.publico) window.open(s.href, "_blank", "noopener"); else location.href = s.href; return; }
  destino = s.id; gravar(sessionStorage, "sp.destino", s.id);
  $("sub").textContent = "Entre para abrir " + s.nome + ". " + quemAcessa(s);
  painel(true); $("usuario").focus();
};
function visaoGeral() {
  if (setorAtual && hospital) hospital.destacar(setorAtual, false);
  setorAtual = null; $("setor").hidden = true; document.body.classList.remove("com-setor");
  document.querySelectorAll("[data-setor]").forEach(b => b.classList.remove("ativo"));
  hospital && hospital.visaoGeral();
}
$("setor-voltar").onclick = visaoGeral;
addEventListener("keydown", e => { if (e.key !== "Escape") return; if (document.body.classList.contains("em-intro")) hospital && hospital.pular(); else if (setorAtual) visaoGeral(); });

function projetar(lista) {
  for (const p of lista) {
    const b = pontos[p.id]; if (!b) continue;
    b.classList.toggle("oculto", !p.visivel);
    if (p.visivel) b.style.transform = "translate(" + p.x.toFixed(1) + "px," + p.y.toFixed(1) + "px)";
  }
}

// ---------- 3D: carregamento tardio, níveis de qualidade e modo leve ----------
function nivel() {
  const nucleos = navigator.hardwareConcurrency || 4, mem = navigator.deviceMemory || 4;
  if (navigator.connection && navigator.connection.saveData) return "baixo";
  if (nucleos <= 4 || mem <= 3) return "baixo";
  if (mq("(pointer: coarse)") || celular) return "medio";
  return "alto";
}
function webglOk() { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; } }

async function ligar3D(comIntro) {
  if (hospital || !webglOk()) return semTresD();
  let mod;
  try { mod = await import("./hospital3d.js"); } catch { return semTresD(); }
  const fazerIntro = comIntro && !reduzido;
  if (fazerIntro) { document.body.classList.add("em-intro"); $("pular").hidden = false; if (celular) painel(false); }
  hospital = mod.iniciarHospital({
    canvas: $("cena"), nivel: nivel(), intro: fazerIntro, reduzido,
    aoProjetar: projetar,
    aoFimIntro: () => { document.body.classList.remove("em-intro"); $("pular").hidden = true; if (setorAtual) hospital && hospital.focar(setorAtual); },
    aoFalhar: () => semTresD()
  });
  if (!hospital) return semTresD();
  document.body.classList.add("com-3d");
}
function semTresD() {
  if (hospital) { hospital.destruir(); hospital = null; }
  document.body.classList.remove("com-3d", "em-intro"); $("pular").hidden = true;
}
$("pular").onclick = () => hospital && hospital.pular();
$("leve").onclick = () => {
  const leve = ler(localStorage, "sp.leve") !== "1";
  gravar(localStorage, "sp.leve", leve ? "1" : null);
  $("leve").setAttribute("aria-pressed", String(leve));
  if (leve) semTresD(); else ligar3D(false);
};
addEventListener("pagehide", () => hospital && hospital.destruir());

// ---------- início ----------
conferirSessao();
painel(!celular);
const leve = ler(localStorage, "sp.leve") === "1";
$("leve").setAttribute("aria-pressed", String(leve));
if (destino && SETORES.some(s => s.id === destino)) selecionar(destino);
if (!leve) {
  const primeira = ler(sessionStorage, "sp.intro") !== "1";
  gravar(sessionStorage, "sp.intro", "1");
  const iniciar = () => ligar3D(primeira);
  if (document.readyState === "complete") iniciar(); else addEventListener("load", iniciar, { once: true });
}
