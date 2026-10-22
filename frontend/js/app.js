/* Saúde+ · funções compartilhadas por todas as telas (login, cabeçalho, API, avisos, formatação). */
(function () {
  "use strict";

  const CHAVE = "saudeplus.sessao";

  const PERFIS = {
    admin: { nome: "Administração", inicio: "admin.html" },
    atendimento: { nome: "Recepção", inicio: "atendimento.html" },
    triagem: { nome: "Triagem", inicio: "triagem.html" },
    medico: { nome: "Médico", inicio: "medico.html" },
    enfermagem: { nome: "Medicação", inicio: "medicacoes.html" }
  };

  const MODULOS = [
    { id: "admin", rotulo: "Painel", href: "admin.html", perfis: ["admin"] },
    { id: "atendimento", rotulo: "Recepção", href: "atendimento.html", perfis: ["admin", "atendimento"] },
    { id: "triagem", rotulo: "Triagem", href: "triagem.html", perfis: ["admin", "triagem"] },
    { id: "medico", rotulo: "Consultório", href: "medico.html", perfis: ["admin", "medico"] },
    { id: "medicacoes", rotulo: "Medicação", href: "medicacoes.html", perfis: ["admin", "medico", "enfermagem"] },
    { id: "tv", rotulo: "Painel da TV ↗", href: "tv.html", perfis: ["admin", "atendimento", "triagem", "medico", "enfermagem"], novaAba: true }
  ];

  const RISCOS = {
    vermelho: { nome: "Emergência", cor: "#dc2626", esperaMin: 0 },
    laranja: { nome: "Muito urgente", cor: "#ea580c", esperaMin: 10 },
    amarelo: { nome: "Urgente", cor: "#eab308", esperaMin: 60 },
    verde: { nome: "Pouco urgente", cor: "#16a34a", esperaMin: 120 },
    azul: { nome: "Não urgente", cor: "#2563eb", esperaMin: 240 }
  };

  const STATUS = {
    aguardando_triagem: "Aguardando triagem",
    aguardando_medico: "Aguardando médico",
    em_atendimento: "Em consulta",
    aguardando_medicacao: "Aguardando medicação",
    finalizado: "Alta",
    desistiu: "Desistiu"
  };

  const ICONES = {
    logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    tv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
    sair: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
    busca: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    megafone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>',
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    atualizar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>'
  };

  // ---------- sessão ----------
  function sessao() {
    try { return JSON.parse(localStorage.getItem(CHAVE) || "null"); } catch { return null; }
  }
  function salvarSessao(s) { localStorage.setItem(CHAVE, JSON.stringify(s)); }
  function limparSessao() { localStorage.removeItem(CHAVE); }

  // ---------- API ----------
  async function api(metodo, rota, corpo) {
    const s = sessao();
    let resposta;
    try {
      resposta = await fetch("/api" + rota, {
        method: metodo,
        headers: { "Content-Type": "application/json", ...(s && s.token ? { Authorization: "Bearer " + s.token } : {}) },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        cache: "no-store"
      });
    } catch {
      throw new Error("Sem conexão com o servidor. Verifique a internet e tente de novo.");
    }
    const dados = await resposta.json().catch(() => ({}));
    if (resposta.status === 401 && rota !== "/login") {
      limparSessao();
      location.href = "index.html?expirou=1";
      throw new Error(dados.erro || "Sessão expirada.");
    }
    if (!resposta.ok) throw new Error(dados.erro || "O servidor respondeu com erro " + resposta.status + ".");
    return dados;
  }
  const API = {
    get: r => api("GET", r),
    post: (r, c) => api("POST", r, c || {}),
    del: r => api("DELETE", r)
  };

  // ---------- segurança/formatação ----------
  function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function hora(iso) {
    return iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "--:--";
  }
  function minutosDesde(iso) { return iso ? Math.max(0, Math.floor((Date.now() - new Date(iso)) / 60000)) : 0; }
  function espera(iso) {
    const m = minutosDesde(iso);
    if (m < 1) return "agora";
    if (m < 60) return m + " min";
    return Math.floor(m / 60) + " h " + String(m % 60).padStart(2, "0");
  }
  function seloRisco(r) { return r ? '<span class="selo risco-' + r + '">' + RISCOS[r].nome + "</span>" : ""; }
  function seloStatus(s) { return '<span class="selo status-' + s + '">' + (STATUS[s] || s) + "</span>"; }
  function seloPref(p) { return p.preferencial ? '<span class="selo selo-pref" title="Atendimento preferencial">★ ' + esc(p.motivoPreferencial || "Preferencial") + "</span>" : ""; }
  function iniciais(nome) { return String(nome || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join("").toUpperCase(); }

  function mascaraCpf(input, aoValidar) {
    input.addEventListener("input", () => {
      const d = input.value.replace(/\D/g, "").slice(0, 11);
      input.value = d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
      if (aoValidar) aoValidar(d);
    });
  }
  function mascaraTelefone(input) {
    input.addEventListener("input", () => {
      const d = input.value.replace(/\D/g, "").slice(0, 11);
      input.value = d.length > 10 ? d.replace(/(\d{2})(\d{5})(\d{0,4})/, "($1) $2-$3") : d.replace(/(\d{2})(\d{0,4})(\d{0,4})/, (m, a, b, c) => "(" + a + (b ? ") " + b : "") + (c ? "-" + c : "")).replace(/^\($/, "");
    });
  }
  function cpfValido(cpf) {
    const d = String(cpf).replace(/\D/g, "");
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    for (const t of [9, 10]) {
      let s = 0;
      for (let i = 0; i < t; i++) s += Number(d[i]) * (t + 1 - i);
      if (((s * 10) % 11) % 10 !== Number(d[t])) return false;
    }
    return true;
  }

  // ---------- avisos ----------
  function toast(mensagem, tipo = "") {
    let caixa = document.querySelector(".toasts");
    if (!caixa) { caixa = document.createElement("div"); caixa.className = "toasts"; caixa.setAttribute("aria-live", "polite"); document.body.appendChild(caixa); }
    const t = document.createElement("div");
    t.className = "toast " + tipo;
    t.innerHTML = "<span></span><button class=\"x\" aria-label=\"Fechar\">×</button>";
    t.firstChild.textContent = mensagem;
    t.querySelector(".x").onclick = () => t.remove();
    caixa.appendChild(t);
    setTimeout(() => t.remove(), tipo === "erro" ? 7000 : 4200);
  }

  /** Executa uma ação de botão: desativa durante a chamada e mostra o erro em aviso. */
  async function acao(botao, fn) {
    const texto = botao ? botao.innerHTML : "";
    if (botao) { botao.disabled = true; botao.dataset.ocupado = "1"; }
    try { return await fn(); } catch (e) { toast(e.message, "erro"); return undefined; } finally {
      if (botao) { botao.disabled = false; delete botao.dataset.ocupado; botao.innerHTML = texto; }
    }
  }

  /** Repete fn a cada ms, pausando com a aba escondida. */
  function aCada(fn, ms) {
    let id = null;
    const ligar = () => { if (!id) id = setInterval(fn, ms); };
    const desligar = () => { clearInterval(id); id = null; };
    document.addEventListener("visibilitychange", () => { if (document.hidden) desligar(); else { fn(); ligar(); } });
    ligar();
  }

  // ---------- proteção das páginas + cabeçalho ----------
  function proteger(modulo) {
    const s = sessao();
    const def = MODULOS.find(m => m.id === modulo);
    if (!s || !s.token) { location.replace("index.html"); throw new Error("sem sessão"); }
    if (def && !def.perfis.includes(s.tipo)) { location.replace((PERFIS[s.tipo] || PERFIS.atendimento).inicio); throw new Error("sem acesso"); }
    montarTopo(modulo, s);
    // confere com o servidor (sessão pode ter expirado)
    API.get("/me").catch(() => {});
    return s;
  }

  function montarTopo(modulo, s) {
    const topo = document.createElement("header");
    topo.className = "topo";
    const links = MODULOS.filter(m => m.perfis.includes(s.tipo))
      .map(m => '<a href="' + m.href + '"' + (m.novaAba ? ' target="_blank" rel="noopener"' : "") + (m.id === modulo ? ' class="ativo" aria-current="page"' : "") + ">" + m.rotulo + "</a>").join("");
    topo.innerHTML =
      '<a class="marca" href="' + (PERFIS[s.tipo] || PERFIS.atendimento).inicio + '"><span class="marca-icone">' + ICONES.logo + "</span><span>Saúde+<small>Pronto atendimento</small></span></a>" +
      '<nav class="nav" aria-label="Módulos">' + links + "</nav>" +
      '<span class="relogio" id="relogio-topo"></span>' +
      '<div class="usuario-topo"><span class="avatar">' + esc(iniciais(s.nome)) + '</span><span class="quem"><b>' + esc(s.nome) + "</b><span>" + esc((PERFIS[s.tipo] || {}).nome || s.tipo) + "</span></span>" +
      '<button class="btn btn-fantasma btn-p" id="sair" title="Sair">' + ICONES.sair + "<span>Sair</span></button></div>";
    document.body.prepend(topo);
    const rel = topo.querySelector("#relogio-topo");
    const tic = () => { rel.textContent = new Date().toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); };
    tic(); setInterval(tic, 15000);
    topo.querySelector("#sair").onclick = async () => { try { await API.post("/logout"); } catch { /* ignora */ } limparSessao(); location.href = "index.html"; };
  }

  /** Chama um paciente na TV da sala de espera. */
  async function chamarNaTv(pacienteId, local, numero) {
    const c = await API.post("/tv/chamar", { pacienteId, local, numero });
    toast("📺 " + c.paciente + " chamado(a) na TV · " + c.localNome + " " + c.numero, "sucesso");
    return c;
  }

  let refs = null;
  async function referencias() {
    if (!refs) refs = await API.get("/referencias");
    return refs;
  }

  window.SP = { API, PERFIS, RISCOS, STATUS, ICONES, sessao, salvarSessao, limparSessao, esc, hora, espera, minutosDesde, seloRisco, seloStatus, seloPref, iniciais, mascaraCpf, mascaraTelefone, cpfValido, toast, acao, aCada, proteger, chamarNaTv, referencias };
})();
