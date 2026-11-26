/* Sumaúma · funções compartilhadas por todas as telas (login, cabeçalho, API, avisos, formatação). */
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
  const AVISO = "Ambiente demonstrativo — não destinado a atendimento real";

  const MODULOS = [
    { id: "admin", rotulo: "Painel", href: "admin.html", perfis: ["admin"] },
    { id: "atendimento", rotulo: "Recepção", href: "atendimento.html", perfis: ["admin", "atendimento"] },
    { id: "triagem", rotulo: "Triagem", href: "triagem.html", perfis: ["admin", "triagem"] },
    { id: "medico", rotulo: "Consultório", href: "medico.html", perfis: ["admin", "medico"] },
    { id: "medicacoes", rotulo: "Medicação", href: "medicacoes.html", perfis: ["admin", "medico", "enfermagem"] },
    { id: "almoxarifado", rotulo: "Almoxarifado", href: "almoxarifado.html", perfis: ["admin", "medico", "enfermagem"] },
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
    logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c-3.6 0-6.5 2.4-6.5 5.4 0 2.3 1.7 4.2 4.1 4.9H14.4c2.4-.7 4.1-2.6 4.1-4.9C18.5 5.4 15.6 3 12 3z"/><path d="M12 21v-7.7M12 16.4l-2.8-2.1M12 18.4l2.9-2.4"/></svg>',
    tv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
    sair: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
    busca: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    megafone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>',
    chave: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.2-8.2M17 6l2 2M14.5 8.5l2 2"/></svg>',
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    atualizar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>'
  };

  // ---------- sessão ----------
  // O token fica num cookie HttpOnly (inacessível ao JavaScript). Aqui guardamos só o perfil público, como dica de interface:
  // quem decide o acesso é sempre o servidor.
  function sessao() {
    try { return JSON.parse(sessionStorage.getItem(CHAVE) || "null"); } catch { return null; }
  }
  function salvarSessao(s) { try { sessionStorage.setItem(CHAVE, JSON.stringify({ usuario: s.usuario, nome: s.nome, tipo: s.tipo })); } catch { /* modo privado */ } }
  function limparSessao() { try { sessionStorage.removeItem(CHAVE); localStorage.removeItem(CHAVE); } catch { /* ignora */ } }

  // ---------- API ----------
  async function api(metodo, rota, corpo) {
    let resposta;
    try {
      resposta = await fetch("/api" + rota, {
        method: metodo,
        headers: { "Content-Type": "application/json", "X-Saude-Plus": "1" },
        credentials: "same-origin",
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        cache: "no-store"
      });
    } catch {
      throw new Error("Sem conexão com o servidor. Verifique a internet e tente de novo.");
    }
    const dados = await resposta.json().catch(() => ({}));
    if (resposta.status === 401 && rota !== "/login" && rota !== "/me?sonda=1") {
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
    if (!s || !s.tipo) { location.replace("index.html?setor=" + encodeURIComponent(modulo || "")); throw new Error("sem sessão"); }
    if (def && !def.perfis.includes(s.tipo)) { location.replace((PERFIS[s.tipo] || PERFIS.atendimento).inicio); throw new Error("sem acesso"); }
    montarTopo(modulo, s);
    faixaSimulacao();
    // o servidor confirma a sessão (cookie) e o perfil; dados só chegam se ele autorizar
    API.get("/me").then(u => { if (u.tipo !== s.tipo) { salvarSessao(u); location.reload(); } }).catch(() => {});
    return s;
  }

  /** Identificação discreta de ambiente demonstrativo, no rodapé de cada tela. */
  function faixaSimulacao() {
    if (document.querySelector(".rodape-demo")) return;
    const f = document.createElement("footer");
    f.className = "rodape-demo"; f.setAttribute("role", "note");
    f.textContent = "Sumaúma · Unidade de ensino — dados fictícios; sem atendimento real.";
    document.body.appendChild(f);
  }

  // ---------- acesso administrativo (Ctrl+Shift+M ou botão) ----------
  // O atalho só abre esta janela: quem decide o acesso é o login real e o servidor.
  function acessoAdmin() {
    let d = document.getElementById("acesso-admin");
    if (!d) { d = document.createElement("dialog"); d.id = "acesso-admin"; d.className = "dialogo"; d.setAttribute("aria-labelledby", "acesso-admin-t"); document.body.appendChild(d); }
    const s = sessao();
    let corpo;
    if (s && s.tipo === "admin") {
      corpo = '<p>Conectado como <b>' + esc(s.nome) + '</b> (Administração). Escolha o setor; a troca fica registrada na auditoria.</p><div class="dialogo-setores">' +
        MODULOS.map(m => '<button type="button" class="btn btn-secundario" data-ir="' + m.id + '">' + esc(m.rotulo.replace(" ↗", "")) + "</button>").join("") + "</div>";
    } else if (s) {
      corpo = "<p>Você está conectado como <b>" + esc(s.nome) + "</b> (" + esc((PERFIS[s.tipo] || {}).nome || s.tipo) + "). Para administrar, saia e entre com uma conta de administrador.</p>" +
        '<div class="acoes"><button type="button" class="btn" data-trocar>Sair e entrar como administrador</button></div>';
    } else {
      corpo = '<p>Requer login com uma conta de administrador.</p><div class="acoes"><a class="btn" href="index.html?admin=1">Entrar como administrador</a></div>';
    }
    d.innerHTML = '<form method="dialog" class="dialogo-topo"><h2 id="acesso-admin-t">Acesso administrativo</h2><button class="btn btn-fantasma btn-p" aria-label="Fechar">✕</button></form>' + corpo;
    d.onclick = async e => {
      if (e.target === d) return d.close();
      const ir = e.target.closest("[data-ir]");
      if (ir) {
        const m = MODULOS.find(x => x.id === ir.dataset.ir);
        try { await API.post("/admin/setor", { setor: m.id }); } catch (err) { return toast(err.message, "erro"); }
        d.close(); if (m.novaAba) window.open(m.href, "_blank", "noopener"); else location.href = m.href;
      }
      if (e.target.closest("[data-trocar]")) { try { await API.post("/logout"); } catch { /* ignora */ } limparSessao(); location.href = "index.html?admin=1"; }
    };
    if (d.showModal) { if (!d.open) d.showModal(); } else d.setAttribute("open", "");
    const f = d.querySelector("[data-ir], .acoes .btn"); f && f.focus();
  }
  document.addEventListener("keydown", e => {
    const k = (e.key || "").toLowerCase();
    if (((e.ctrlKey || e.metaKey) && e.shiftKey && k === "m") || (e.altKey && e.shiftKey && k === "a")) { e.preventDefault(); acessoAdmin(); }
  });

  function montarTopo(modulo, s) {
    const topo = document.createElement("header");
    topo.className = "topo";
    const links = MODULOS.filter(m => m.perfis.includes(s.tipo))
      .map(m => '<a href="' + m.href + '"' + (m.novaAba ? ' target="_blank" rel="noopener"' : "") + (m.id === modulo ? ' class="ativo" aria-current="page"' : "") + ">" + m.rotulo + "</a>").join("");
    topo.innerHTML =
      '<a class="marca" href="' + (PERFIS[s.tipo] || PERFIS.atendimento).inicio + '"><span class="marca-icone">' + ICONES.logo + "</span><span>Sumaúma<small>Pronto atendimento</small></span></a>" +
      '<nav class="nav" aria-label="Módulos">' + links + "</nav>" +
      '<span class="relogio" id="relogio-topo"></span>' +
      (s.tipo === "admin" ? '<label class="setor-admin" title="Troca de setor (registrada na auditoria)"><span>Setor</span><select id="setor-admin" aria-label="Trocar de setor">' +
        MODULOS.filter(m => !m.novaAba).map(m => '<option value="' + m.id + '"' + (m.id === modulo ? " selected" : "") + ">" + m.rotulo + "</option>").join("") + "</select></label>" : "") +
      '<button type="button" class="btn btn-fantasma btn-p btn-admin" id="btn-admin" title="Acesso administrativo (Ctrl+Shift+M)" aria-label="Acesso administrativo">' + ICONES.chave + "</button>" +
      '<div class="usuario-topo"><span class="avatar">' + esc(iniciais(s.nome)) + '</span><span class="quem"><b>' + esc(s.nome) + "</b><span>" + esc((PERFIS[s.tipo] || {}).nome || s.tipo) + "</span></span>" +
      '<button class="btn btn-fantasma btn-p" id="sair" title="Sair">' + ICONES.sair + "<span>Sair</span></button></div>";
    document.body.prepend(topo);
    const rel = topo.querySelector("#relogio-topo");
    const tic = () => { rel.textContent = new Date().toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); };
    tic(); setInterval(tic, 15000);
    topo.querySelector("#btn-admin").onclick = acessoAdmin;
    const sel = topo.querySelector("#setor-admin");
    if (sel) sel.onchange = async () => {
      const m = MODULOS.find(x => x.id === sel.value);
      try { await API.post("/admin/setor", { setor: m.id }); location.href = m.href; } catch (e) { toast(e.message, "erro"); sel.value = modulo; }
    };
    topo.querySelector("#sair").onclick = async () => { try { await API.post("/logout"); } catch { /* ignora */ } limparSessao(); location.href = "index.html"; };
  }

  /** Chama um paciente na TV da sala de espera. */
  async function chamarNaTv(pacienteId, local, numero) {
    const c = await API.post("/tv/chamar", { pacienteId, local, numero });
    toast("📺 " + (c.paciente || c.senha) + " chamado(a) na TV · " + c.localNome + " " + c.numero, "sucesso");
    return c;
  }

  let refs = null;
  async function referencias() {
    if (!refs) refs = await API.get("/referencias");
    return refs;
  }

  window.SP = { API, PERFIS, RISCOS, STATUS, ICONES, sessao, salvarSessao, limparSessao, esc, hora, espera, minutosDesde, seloRisco, seloStatus, seloPref, iniciais, toast, faixaSimulacao, acessoAdmin, AVISO, MODULOS, acao, aCada, proteger, chamarNaTv, referencias };
})();
