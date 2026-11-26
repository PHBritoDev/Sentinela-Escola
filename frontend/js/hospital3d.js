/**
 * Saúde+ · hospital 3D da tela inicial (Three.js, sem modelos externos).
 * Fachada ao entardecer → aproximação na altura dos olhos → portas de vidro automáticas → hall → recepção.
 * Depois da entrada, a cena vira um mapa interativo: cada setor tem um ponto (botão HTML acessível) e a câmera viaja até ele.
 * Desempenho: geometria estática mesclada por material (~40 draw calls), DPR limitado, sombra só onde compensa e congelada,
 * renderização sob demanda (parada quando nada se move), pausa com a aba oculta e descarte completo ao sair.
 * Nada aqui mostra dados reais: o painel de chamadas na parede é ilustrativo.
 */
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

import { SETORES } from "./setores.js";
export { SETORES };

const VISAO = { pos: new THREE.Vector3(0.5, 2.35, -1.6), alvo: new THREE.Vector3(0, 1.35, -10.5) };
const INTRO = [
  [[-2.5, 8.2, 40], [0, 4.6, 0]],
  [[-5.5, 4.4, 24], [0, 4.0, 0]],
  [[-1.2, 1.8, 11.5], [0, 2.3, 0]],
  [[0, 1.66, 3.4], [0, 1.75, -5]],
  [[0.1, 1.68, -0.6], [0, 1.6, -9]],
  [[VISAO.pos.x, VISAO.pos.y, VISAO.pos.z], [VISAO.alvo.x, VISAO.alvo.y, VISAO.alvo.z]]
];

const suave = t => t * t * t * (t * (t * 6 - 15) + 10);
const senoide = t => 0.5 - 0.5 * Math.cos(Math.PI * t);
const lim = (v, a, b) => Math.min(b, Math.max(a, v));

export function iniciarHospital({ canvas, nivel = "medio", intro = true, reduzido = false, aoProjetar, aoFimIntro, aoFalhar }) {
  const T0 = performance.now();
  const alto = nivel === "alto", baixo = nivel === "baixo";
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !baixo, powerPreference: "high-performance", alpha: false });
  } catch (e) { aoFalhar && aoFalhar(e); return null; }
  const dprMax = alto ? 1.75 : baixo ? 1 : 1.35;
  let dpr = Math.min(window.devicePixelRatio || 1, dprMax);
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = !baixo;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const cena = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
  const descartaveis = new Set();
  const guardar = o => { descartaveis.add(o); return o; };

  // ---------- texturas procedurais (canvas) ----------
  const anis = Math.min(renderer.capabilities.getMaxAnisotropy(), alto ? 8 : 4);
  function textura(w, h, pintar, { repetir = true, srgb = true } = {}) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d"); pintar(g, w, h);
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repetir) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = anis;
    return guardar(t);
  }
  let semente = 7;
  const rnd = () => ((semente = (semente * 16807) % 2147483647) / 2147483647);
  const ruido = (g, w, h, n, a, cores) => { for (let i = 0; i < n; i++) { g.globalAlpha = a * (0.4 + rnd() * 0.6); g.fillStyle = cores[(rnd() * cores.length) | 0]; const s = rnd() * 2.2 + 0.6; g.fillRect(rnd() * w, rnd() * h, s, s); } g.globalAlpha = 1; };

  const texTerrazo = textura(512, 512, (g, w, h) => {
    g.fillStyle = "#e7e1d6"; g.fillRect(0, 0, w, h);
    const cores = ["#b9ad9b", "#8f8577", "#d2c6b4", "#6f7f7a", "#c9a98a", "#f4f0e8", "#5d6b68"];
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = cores[(rnd() * cores.length) | 0]; g.globalAlpha = 0.55 + rnd() * 0.45;
      const x = rnd() * w, y = rnd() * h, r = rnd() < 0.08 ? 3 + rnd() * 4 : 0.7 + rnd() * 1.8;
      g.beginPath(); g.ellipse(x, y, r, r * (0.6 + rnd() * 0.5), rnd() * 3, 0, 6.3); g.fill();
    }
    g.globalAlpha = 0.35; g.strokeStyle = "#cfc6b8"; g.lineWidth = 2; g.strokeRect(0, 0, w, h); g.globalAlpha = 1;
  });
  const texConcreto = textura(512, 512, (g, w, h) => {
    g.fillStyle = "#e9e4dc"; g.fillRect(0, 0, w, h);
    ruido(g, w, h, 9000, 0.10, ["#b8b0a3", "#fffaf2", "#a59c8e"]);
    g.strokeStyle = "rgba(120,110,95,.22)"; g.lineWidth = 1.5;
    for (let y = 0; y <= h; y += 128) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.strokeStyle = "rgba(120,110,95,.12)"; g.beginPath(); g.moveTo(256, 0); g.lineTo(256, h); g.stroke();
    for (let i = 0; i < 18; i++) { g.fillStyle = "rgba(110,100,90,.18)"; g.beginPath(); g.arc((i % 6) * 85 + 42, ((i / 6) | 0) * 128 + 64 + (i % 2 ? 128 * 0 : 0), 2.2, 0, 6.3); g.fill(); }
  });
  const texPiso = textura(512, 512, (g, w, h) => {
    const cores = ["#c9c1b4", "#bfb6a8", "#d1cabd", "#b8afa1"];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { g.fillStyle = cores[(i * 3 + j * 5) % 4]; g.fillRect(i * 128, j * 128, 128, 128); }
    ruido(g, w, h, 7000, 0.12, ["#8d8475", "#efe9de"]);
    g.strokeStyle = "#8f877a"; g.lineWidth = 3;
    for (let k = 0; k <= 512; k += 128) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, h); g.moveTo(0, k); g.lineTo(w, k); g.stroke(); }
  });
  const texGrama = textura(256, 256, (g, w, h) => { g.fillStyle = "#6f8a4e"; g.fillRect(0, 0, w, h); ruido(g, w, h, 6000, 0.35, ["#5b7740", "#88a25e", "#4d6537", "#9bb070"]); });
  const texMadeira = textura(256, 1024, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, "#b07c4f"); gr.addColorStop(0.5, "#c08d5c"); gr.addColorStop(1, "#a87348");
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) { g.strokeStyle = `rgba(${90 + rnd() * 30},${55 + rnd() * 20},30,${0.12 + rnd() * 0.18})`; g.lineWidth = 0.6 + rnd() * 1.6; g.beginPath(); const x = rnd() * w; g.moveTo(x, 0); for (let y = 0; y <= h; y += 64) g.lineTo(x + Math.sin(y * 0.01 + i) * 6, y); g.stroke(); }
  });
  const texAsfalto = textura(256, 256, (g, w, h) => { g.fillStyle = "#4a4b4d"; g.fillRect(0, 0, w, h); ruido(g, w, h, 5000, 0.4, ["#5e5f61", "#3a3b3c", "#6c6c6a"]); });
  texTerrazo.repeat.set(1, 1);

  function placa(texto, { sub = "", cor = "#0f766e", w = 1024, h = 256, fundo = "#f8f6f1", tinta = "#17323b", icone = true } = {}) {
    return textura(w, h, (g) => {
      g.fillStyle = fundo; g.fillRect(0, 0, w, h);
      g.fillStyle = cor; g.fillRect(0, 0, h * 0.16, h);
      if (icone) { g.fillStyle = cor; const cx = h * 0.62, cy = h / 2, s = h * 0.26; g.beginPath(); g.arc(cx, cy, s, 0, 6.3); g.fill(); g.fillStyle = "#fff"; g.font = `800 ${s * 1.2}px Inter, system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(texto[0], cx, cy + s * 0.05); }
      g.fillStyle = tinta; g.textAlign = "left"; g.textBaseline = "alphabetic";
      g.font = `700 ${h * 0.34}px Inter, system-ui, sans-serif`; g.fillText(texto, h * (icone ? 1.0 : 0.32), h * (sub ? 0.52 : 0.62));
      if (sub) { g.globalAlpha = 0.7; g.font = `500 ${h * 0.17}px Inter, system-ui, sans-serif`; g.fillText(sub, h * (icone ? 1.0 : 0.32), h * 0.8); g.globalAlpha = 1; }
    }, { repetir: false });
  }
  const logoFachada = textura(1024, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = "#fffdf7"; g.font = "800 150px Inter, system-ui, sans-serif"; g.textBaseline = "middle";
    const cx = 120, cy = h / 2; g.beginPath(); g.arc(cx, cy, 92, 0, 6.3); g.fill();
    g.fillStyle = "#0f766e"; g.fillRect(cx - 14, cy - 58, 28, 116); g.fillRect(cx - 58, cy - 14, 116, 28);
    g.fillStyle = "#fffdf7"; g.fillText("Saúde+", 250, cy + 6);
  }, { repetir: false });
  const faixaMarquise = textura(2048, 128, (g, w, h) => {
    g.fillStyle = "#16343d"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#f6efe1"; g.font = "700 64px Inter, system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.letterSpacing = "10px"; g.fillText("PRONTO ATENDIMENTO  ·  SAÚDE+", w / 2, h / 2 + 3);
  }, { repetir: false });
  const telaTv = textura(1024, 576, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#0d2531"); gr.addColorStop(1, "#06141c"); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = "#14b8a6"; g.fillRect(0, 0, w, 10);
    g.fillStyle = "#9fb7c2"; g.font = "600 34px Inter, system-ui, sans-serif"; g.fillText("PAINEL DE CHAMADAS", 56, 82);
    g.fillStyle = "#ffffff"; g.font = "800 190px Inter, system-ui, sans-serif"; g.fillText("A012", 56, 300);
    g.fillStyle = "#5eead4"; g.font = "700 54px Inter, system-ui, sans-serif"; g.fillText("Guichê 01", 64, 380);
    g.fillStyle = "rgba(255,255,255,.08)"; g.fillRect(640, 120, 330, 380);
    g.fillStyle = "#cfe1e8"; g.font = "600 30px Inter, system-ui, sans-serif";
    ["A011 · Triagem 1", "P004 · Consult. 2", "A010 · Medicação"].forEach((l, i) => g.fillText(l, 668, 190 + i * 86));
    g.fillStyle = "#7d97a3"; g.font = "500 24px Inter, system-ui, sans-serif"; g.fillText("Ilustração · simulação escolar", 56, 528);
  }, { repetir: false });
  const placaTeto = textura(2048, 256, (g, w, h) => {
    g.fillStyle = "#15323b"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#f3efe6"; g.font = "600 74px Inter, system-ui, sans-serif"; g.textBaseline = "middle";
    g.textAlign = "left"; g.fillText("←  Triagem  ·  Medicação", 70, h / 2);
    g.textAlign = "right"; g.fillText("Consultórios  ·  Almoxarifado  →", w - 70, h / 2);
    g.fillStyle = "#d97706"; g.fillRect(0, h - 14, w / 2, 14); g.fillStyle = "#2563eb"; g.fillRect(w / 2, h - 14, w / 2, 14);
  }, { repetir: false });
  const logoHall = textura(1024, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.fillStyle = "#f1ece2"; g.textBaseline = "middle";
    g.font = "800 140px Inter, system-ui, sans-serif"; g.fillText("Saúde+", 230, h / 2 + 4);
    g.lineWidth = 16; g.strokeStyle = "#f1ece2"; g.beginPath(); g.arc(110, h / 2, 82, 0, 6.3); g.stroke();
    g.fillRect(96, h / 2 - 50, 28, 100); g.fillRect(60, h / 2 - 14, 100, 28);
  }, { repetir: false });

  // ---------- materiais ----------
  const M = {};
  const mat = (nome, o) => (M[nome] = guardar(new THREE.MeshStandardMaterial(o)));
  mat("concreto", { map: texConcreto, color: 0xf3eee6, roughness: 0.86 });
  mat("concretoEsc", { map: texConcreto, color: 0xb9b2a7, roughness: 0.9 });
  mat("branco", { color: 0xf4f1ea, roughness: 0.62 });
  mat("reboco", { color: 0xefe9df, roughness: 0.9 });
  mat("teto", { color: 0xf2efe9, roughness: 0.95 });
  mat("terrazo", { map: texTerrazo, roughness: 0.32, metalness: 0.0 });
  mat("piso", { map: texPiso, roughness: 0.88 });
  mat("grama", { map: texGrama, roughness: 1 });
  mat("asfalto", { map: texAsfalto, roughness: 0.95 });
  mat("madeira", { map: texMadeira, roughness: 0.58 });
  mat("aco", { color: 0x9aa3a8, metalness: 0.85, roughness: 0.32 });
  mat("acoEsc", { color: 0x2c3336, metalness: 0.7, roughness: 0.45 });
  mat("vidro", { color: 0x9fc2c8, metalness: 0.2, roughness: 0.04, transparent: true, opacity: 0.22, depthWrite: false, envMapIntensity: 1.6 });
  mat("vidroEsc", { color: 0x2b4148, metalness: 0.55, roughness: 0.12, envMapIntensity: 1.3 });
  mat("teal", { color: 0x0f6b64, roughness: 0.55 });
  mat("tealSoft", { color: 0x5f8f8a, roughness: 0.7 });
  mat("folha", { vertexColors: true, roughness: 0.92 });
  mat("tronco", { color: 0x5b4636, roughness: 0.95 });
  mat("estofado", { color: 0x2f5d62, roughness: 0.8 });
  mat("superficie", { color: 0xf7f5f0, roughness: 0.28 });
  mat("escuro", { color: 0x1b2326, roughness: 0.55 });
  mat("vaso", { color: 0xcfc4b3, roughness: 0.75 });
  mat("luzQuente", { color: 0xfff1d6, emissive: 0xffe2b0, emissiveIntensity: 2.2, roughness: 1 });
  mat("luzFria", { color: 0xffffff, emissive: 0xfff6e8, emissiveIntensity: 1.5, roughness: 1 });
  mat("faixaAmbar", { color: 0xd98a1c, roughness: 0.6 });
  mat("faixaAzul", { color: 0x3a6fd8, roughness: 0.6 });
  mat("faixaVerde", { color: 0x2f9a55, roughness: 0.6 });

  // ---------- montagem: tudo que é estático vai para "baldes" por material e vira uma malha só ----------
  const baldes = new Map();
  const UV_MUNDO = { concreto: 3.2, concretoEsc: 3.2, terrazo: 3.0, piso: 6, grama: 5, asfalto: 6, madeira: 0 };
  function por(nomeMat, geo, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv", "color"].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.color && nomeMat === "folha") g.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
    g.clearGroups();
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    const esc = UV_MUNDO[nomeMat];
    if (esc) {
      const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
        if (ay >= ax && ay >= az) uv.setXY(i, p.getX(i) / esc, p.getZ(i) / esc);
        else if (ax >= az) uv.setXY(i, p.getZ(i) / esc, p.getY(i) / esc);
        else uv.setXY(i, p.getX(i) / esc, p.getY(i) / esc);
      }
    }
    if (!baldes.has(nomeMat)) baldes.set(nomeMat, []);
    baldes.get(nomeMat).push(g);
  }
  const caixa = (m, w, h, d, x, y, z, ry = 0) => por(m, new THREE.BoxGeometry(w, h, d), x, y + h / 2, z, ry);
  const arred = (m, w, h, d, r, x, y, z, ry = 0) => por(m, new RoundedBoxGeometry(w, h, d, 2, r), x, y + h / 2, z, ry);
  const cil = (m, rt, rb, h, x, y, z, seg = 16) => por(m, new THREE.CylinderGeometry(rt, rb, h, seg), x, y + h / 2, z);
  const plano = (m, w, d, x, y, z) => por(m, new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), x, y, z);

  // chão externo, calçada, gramado e rua
  plano("grama", 240, 240, 0, -0.02, 20);
  caixa("piso", 46, 0.12, 30, 0, -0.1, 15);
  caixa("asfalto", 240, 0.02, 9, 0, -0.06, 34.5);
  caixa("concretoEsc", 240, 0.16, 0.35, 0, -0.06, 29.9);
  for (let x = -110; x < 110; x += 6) caixa("luzFria", 2.6, 0.012, 0.14, x, -0.03, 34.5);

  // volume do edifício
  const L = 16, PROF = 18;
  caixa("concreto", L * 2, 4.6, 0.5, 0, 0, -PROF);
  caixa("concreto", 0.5, 9.6, PROF, -L, 0, -PROF / 2);
  caixa("concreto", 0.5, 9.6, PROF, L, 0, -PROF / 2);
  // alas laterais (térreo) em concreto com janelas verticais recuadas
  for (const s of [-1, 1]) {
    const cx = s * 12.5;
    caixa("concreto", 7, 4.6, 0.6, cx, 0, -0.3);
    for (let i = 0; i < 4; i++) { const x = cx - 2.4 + i * 1.6; caixa("vidroEsc", 0.7, 3.0, 0.05, x, 0.8, 0.02); caixa("concretoEsc", 0.9, 0.08, 0.32, x, 0.72, 0.12); }
  }
  // pavimento superior projetado com brises verticais
  caixa("concreto", L * 2 + 0.6, 0.7, 1.2, 0, 4.6, 0.25);
  caixa("vidroEsc", L * 2 - 0.4, 2.7, 0.1, 0, 5.35, 0.3);
  caixa("concreto", L * 2 + 0.6, 1.5, 1.2, 0, 8.05, 0.25);
  caixa("concreto", L * 2, 4.6, PROF - 1, 0, 4.6 + 0.02, -PROF / 2 - 0.7);
  for (let x = -L + 0.6; x <= L - 0.5; x += 1.1) caixa("branco", 0.14, 2.7, 0.9, x, 5.35, 0.75);
  caixa("acoEsc", L * 2 + 0.7, 0.12, 1.3, 0, 9.5, 0.25);
  // volume da marca (torre teal) à direita
  arred("teal", 4.2, 6.4, 1.6, 0.08, -12.6, 3.4, 1.3);
  // fachada de vidro do hall com montantes
  caixa("vidro", 18, 4.6, 0.04, 0, 0, 0);
  for (let x = -9; x <= 9.01; x += 1.5) if (Math.abs(x) > 1.7) caixa("acoEsc", 0.07, 4.6, 0.14, x, 0, 0);
  caixa("acoEsc", 18, 0.08, 0.14, 0, 3.05, 0);
  caixa("acoEsc", 3.4, 0.1, 0.2, 0, 2.95, 0);
  caixa("acoEsc", 18, 0.12, 0.2, 0, 0, 0);
  // marquise com forro de madeira e luminárias embutidas
  caixa("branco", 13, 0.34, 6.2, 0, 3.7, 3.0);
  caixa("madeira", 12.6, 0.04, 5.8, 0, 3.67, 3.0);
  for (let x = -5; x <= 5; x += 2.5) for (const z of [1.4, 3.4, 5.2]) cil("luzQuente", 0.12, 0.12, 0.02, x, 3.655, z, 12);
  for (const x of [-5.6, 5.6]) cil("aco", 0.09, 0.09, 3.7, x, 0, 5.4, 12);
  // rampa / degrau e piso de entrada
  caixa("concretoEsc", 13, 0.16, 6.4, 0, 0, 3.1);
  // canteiros, bancos e balizadores na praça
  const arvores = [];
  for (const [x, z, w, d] of [[-9.5, 9, 6, 2.4], [9.5, 9, 6, 2.4], [-14, 16, 5, 5], [14, 16, 5, 5], [-12.5, 23, 3, 3], [12, 23.5, 3, 3]]) {
    arred("concreto", w, 0.55, d, 0.05, x, -0.05, z);
    caixa("grama", w - 0.3, 0.02, d - 0.3, x, 0.5, z);
    for (let i = 0; i < Math.round(w / 0.7); i++) por("folha", corFolha(new THREE.IcosahedronGeometry(0.42 + rnd() * 0.12, 2), 0.55), x - w / 2 + 0.45 + i * 0.7, 0.75, z + (rnd() - 0.5) * (d - 1));
    arvores.push([x + (rnd() - 0.5) * 1.5, z + (rnd() - 0.5) * 0.6, 0.85 + rnd() * 0.35]);
  }
  for (const [x, z] of [[-24, 4], [24, 5], [-28, 22], [30, 20], [-20, 40], [22, 42], [-40, 30], [42, 30], [-8, 44], [10, 46]]) arvores.push([x, z, 1.1 + rnd() * 0.5]);
  for (const [x, z, s] of (baixo ? arvores.slice(0, 8) : arvores)) arvore(x, z, s);
  for (const x of [-3.2, 3.2]) { caixa("madeira", 2.2, 0.08, 0.5, x, 0.44, 11.6); for (const dx of [-0.85, 0.85]) caixa("acoEsc", 0.08, 0.44, 0.44, x + dx, 0, 11.6); }
  for (let i = -3; i <= 3; i++) if (i) { cil("acoEsc", 0.09, 0.09, 0.85, i * 2.1, 0, 7.2, 10); cil("luzQuente", 0.07, 0.07, 0.05, i * 2.1, 0.86, 7.2, 10); }

  // folhagem: esfera subdividida com deformação contínua (normais suaves) e cor por vértice — evita o aspecto facetado
  function corFolha(geo, base) {
    geo.deleteAttribute("uv"); const g = mergeVertices(geo); geo.dispose();
    const p = g.attributes.position, cores = new Float32Array(p.count * 3), v3 = new THREE.Vector3();
    const fase = rnd() * 10, c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      v3.fromBufferAttribute(p, i); const r = v3.length(), d = v3.clone().normalize();
      const n = Math.sin(d.x * 5.1 + fase) * Math.sin(d.y * 4.3 + fase * 0.7) * Math.sin(d.z * 5.7 - fase) ;
      v3.multiplyScalar(1 + n * 0.22 + (rnd() - 0.5) * 0.07); if (v3.y < -r * 0.35) v3.y = -r * 0.35 + (v3.y + r * 0.35) * 0.4;
      p.setXYZ(i, v3.x, v3.y, v3.z);
      const luz = 0.5 + 0.5 * d.y, h = rnd();
      c.setHSL(0.21 + h * 0.07 - luz * 0.02, 0.36 + h * 0.18, (0.1 + luz * 0.17 + n * 0.04) * (0.75 + base * 0.35));
      cores[i * 3] = c.r; cores[i * 3 + 1] = c.g; cores[i * 3 + 2] = c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(cores, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(p.count * 2), 2)); g.computeVertexNormals();
    return g;
  }
  function arvore(x, z, s) {
    cil("tronco", 0.09 * s, 0.16 * s, 2.6 * s, x, 0, z, 7);
    // copa em cachos: várias massas menores, mais escuras embaixo, galhos aparentes entre elas
    const n = baixo ? 5 : 9;
    for (let i = 0; i < n; i++) {
      const a = i * 2.39996 + rnd() * 0.5, r = Math.sqrt(i / n) * 1.05 * s, y = (3.0 + (1 - i / n) * 0.9 + rnd() * 0.5) * s;
      if (i % 3 === 1) cil("tronco", 0.03 * s, 0.05 * s, 1.1 * s, x + Math.cos(a) * r * 0.5, 2.0 * s, z + Math.sin(a) * r * 0.5, 5);
      por("folha", corFolha(new THREE.IcosahedronGeometry((0.62 + rnd() * 0.32) * s, baixo ? 1 : 2), 1), x + Math.cos(a) * r, y, z + Math.sin(a) * r);
    }
  }

  // ---------- interior ----------
  const balcaoDest = guardar(new THREE.MeshStandardMaterial({ color: 0x0f766e, emissive: 0x2dd4bf, emissiveIntensity: 0, roughness: 0.5 }));
  caixa("terrazo", 18, 0.02, 14, 0, -0.01, -7);
  caixa("teto", 18, 0.1, 14, 0, 4.6, -7);
  for (let z = -2; z >= -13; z -= 2.75) caixa("luzFria", 12, 0.02, 0.16, 0, 4.57, z);
  caixa("reboco", 0.2, 4.6, 14, -9, 0, -7);
  caixa("reboco", 0.2, 4.6, 14, 9, 0, -7);
  caixa("reboco", 18, 4.6, 0.2, 0, 0, -14);
  for (const s of [-1, 1]) caixa("tealSoft", 0.04, 1.0, 13.6, s * 8.88, 0.12, -7.1);
  // parede de ripas de madeira atrás do balcão
  caixa("escuro", 8.4, 4.4, 0.05, 0, 0, -13.86);
  for (let x = -4.1; x <= 4.1; x += 0.16) caixa("madeira", 0.08, 4.4, 0.09, x, 0, -13.79);
  // balcão curvo
  balcao();
  // sala de espera: cadeiras em longarina, voltadas para o painel
  for (const z of [-4.2, -6.4]) for (let i = 0; i < 4; i++) cadeira(-7.3 + i * 0.78, z);
  for (const z of [-4.2, -6.4]) caixa("acoEsc", 3.2, 0.06, 0.06, -6.1, 0.38, z + 0.05);
  // vasos e plantas internas
  for (const [x, z] of [[-8.2, -1.0], [8.2, -1.0], [-4.9, -13.1], [4.9, -13.1], [8.1, -12.8]]) {
    cil("vaso", 0.34, 0.26, 0.62, x, 0, z, 18);
    for (let i = 0; i < 3; i++) por("folha", corFolha(new THREE.IcosahedronGeometry(0.42 + rnd() * 0.18, 2), 0.8), x + (rnd() - 0.5) * 0.4, 1.0 + i * 0.34, z + (rnd() - 0.5) * 0.4);
  }
  // banco junto à vidraça
  caixa("madeira", 3.2, 0.07, 0.6, 5.4, 0.45, -1.1); for (const dx of [-1.4, 1.4]) caixa("acoEsc", 0.06, 0.45, 0.5, 5.4 + dx, 0, -1.1);
  // faixas de orientação no piso (cores dos setores)
  for (const [m, x0, x1, z] of [["faixaAmbar", 0, -8.8, -4.0], ["faixaVerde", 0, -8.8, -9.5], ["faixaAzul", 0, 8.8, -4.0]]) {
    caixa(m, 0.12, 0.006, Math.abs(z) - 0.8, x0 + (m === "faixaAzul" ? 0.2 : m === "faixaVerde" ? -0.2 : 0), 0.004, z / 2 - 0.4);
    caixa(m, Math.abs(x1 - x0), 0.006, 0.12, (x0 + x1) / 2, 0.004, z);
  }
  // luminária pendente circular sobre a recepção
  const anel = new THREE.TorusGeometry(2.1, 0.06, 8, 64).rotateX(Math.PI / 2);
  por("acoEsc", anel, 0, 3.55, -10.4);
  por("luzQuente", new THREE.TorusGeometry(2.1, 0.035, 6, 64).rotateX(Math.PI / 2), 0, 3.5, -10.4);
  for (let i = 0; i < 3; i++) { const a = (i / 3) * 6.28; caixa("acoEsc", 0.012, 1.05, 0.012, Math.cos(a) * 2.1, 3.55, -10.4 + Math.sin(a) * 2.1); }

  function balcao() {
    const forma = (r1, r2, a) => { const s = new THREE.Shape(); const c = 15.5; s.moveTo(r1 * Math.sin(-a), c - r1 * Math.cos(-a)); s.absarc(0, c, r1, -Math.PI / 2 - a, -Math.PI / 2 + a, false); s.absarc(0, c, r2, -Math.PI / 2 + a, -Math.PI / 2 - a, true); return s; };
    const ext = (s, h) => new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 28 }).rotateX(-Math.PI / 2);
    // a forma usa Y = -z do mundo; o centro do arco fica em z = -15.5
    const corr = g => g;
    por("madeira", corr(ext(forma(5.3, 4.75, 0.62), 1.02)), 0, 0.1, 0);
    por("escuro", corr(ext(forma(5.24, 4.8, 0.62), 0.1)), 0, 0, 0);
    por("superficie", corr(ext(forma(5.42, 4.62, 0.64), 0.05)), 0, 1.12, 0);
    const faixa = new THREE.Mesh(guardar(ext(forma(5.31, 5.27, 0.6), 0.08)), balcaoDest); faixa.position.y = 0.86; cena.add(faixa);
    for (const x of [-1.6, 1.6]) { arred("escuro", 0.62, 0.38, 0.04, 0.012, x, 1.32, -11.6, x > 0 ? -0.25 : 0.25); caixa("acoEsc", 0.05, 0.16, 0.05, x, 1.17, -11.58); }
  }
  function cadeira(x, z) {
    arred("estofado", 0.62, 0.09, 0.56, 0.035, x, 0.42, z);
    por("estofado", new RoundedBoxGeometry(0.62, 0.5, 0.07, 2, 0.03), x, 0.82, z + 0.3, 0, -0.12);
    caixa("acoEsc", 0.04, 0.42, 0.04, x - 0.26, 0, z - 0.22); caixa("acoEsc", 0.04, 0.42, 0.04, x + 0.26, 0, z - 0.22);
  }

  // portas e placas dos setores (malhas próprias: recebem o destaque)
  const destaques = {};
  const corPorta = { triagem: "faixaAmbar", medicacao: "faixaVerde", consultorio: "faixaAzul", almoxarifado: "acoEsc", admin: "teal" };
  for (const s of SETORES) {
    if (s.id === "recepcao" || s.id === "tv") continue;
    const lado = s.p[0] < 0 ? 1 : s.p[0] > 8 ? -1 : 0;
    const g = new THREE.Group();
    const folha = new THREE.Mesh(guardar(new RoundedBoxGeometry(1.25, 2.35, 0.06, 2, 0.02)), guardar(new THREE.MeshStandardMaterial({ map: texMadeira, color: 0xe8d8c4, roughness: 0.55, emissive: new THREE.Color(s.cor), emissiveIntensity: 0 })));
    folha.position.y = 1.175;
    const visor = new THREE.Mesh(guardar(new THREE.PlaneGeometry(0.16, 1.2)), M.vidroEsc); visor.position.set(0.38, 1.4, 0.035);
    const batente = new THREE.Mesh(guardar(new THREE.BoxGeometry(1.45, 2.48, 0.04)), M[corPorta[s.id]] || M.acoEsc); batente.position.set(0, 1.24, -0.03);
    const pl = new THREE.Mesh(guardar(new THREE.PlaneGeometry(1.7, 0.42)), guardar(new THREE.MeshStandardMaterial({ map: placa(s.nome, { cor: s.cor }), roughness: 0.5, emissive: 0xffffff, emissiveMap: null, emissiveIntensity: 0 })));
    pl.position.set(0, 2.78, 0.04);
    g.add(batente, folha, visor, pl);
    if (lado) { g.position.set(s.p[0] < 0 ? -8.88 : 8.88, 0, s.p[2]); g.rotation.y = lado * Math.PI / 2; }
    else { g.position.set(s.p[0], 0, -13.88); }
    cena.add(g); destaques[s.id] = folha.material;
  }
  // painel de chamadas (TV) e logo do hall
  const tv = new THREE.Mesh(guardar(new RoundedBoxGeometry(2.3, 1.36, 0.08, 2, 0.02)), M.escuro); tv.position.set(-6.2, 2.55, -13.86); cena.add(tv);
  const telaMat = guardar(new THREE.MeshBasicMaterial({ map: telaTv, toneMapped: false, color: 0xd8d8d8 }));
  const tela = new THREE.Mesh(guardar(new THREE.PlaneGeometry(2.18, 1.23)), telaMat); tela.position.set(-6.2, 2.55, -13.81); cena.add(tela);
  destaques.tv = { set emissiveIntensity(v) { telaMat.color.setScalar(0.85 + v * 0.35); }, get emissiveIntensity() { return 0; } };
  const lh = new THREE.Mesh(guardar(new THREE.PlaneGeometry(3.6, 0.9)), guardar(new THREE.MeshStandardMaterial({ map: logoHall, transparent: true, roughness: 0.3, metalness: 0.6, color: 0xe9e2d4 }))); lh.position.set(0, 3.45, -13.72); cena.add(lh);
  destaques.recepcao = balcaoDest;
  // placa suspensa de orientação
  const ps = new THREE.Mesh(guardar(new THREE.PlaneGeometry(6.4, 0.8)), guardar(new THREE.MeshBasicMaterial({ map: placaTeto, toneMapped: false, color: 0xe6e6e6 }))); ps.position.set(0, 3.7, -2.9); cena.add(ps);
  const psv = ps.clone(); psv.rotation.y = Math.PI; psv.position.z -= 0.03; cena.add(psv);
  for (const x of [-2.6, 2.6]) caixa("acoEsc", 0.012, 0.5, 0.012, x, 4.1, -2.92);
  // identidade na fachada
  const lf = new THREE.Mesh(guardar(new THREE.PlaneGeometry(3.6, 0.9)), guardar(new THREE.MeshStandardMaterial({ map: logoFachada, transparent: true, emissive: 0xfff4dc, emissiveMap: logoFachada, emissiveIntensity: 1.25, roughness: 0.5 })));
  lf.position.set(-12.6, 7.9, 2.12); lf.rotation.z = 0; cena.add(lf);
  const fm = new THREE.Mesh(guardar(new THREE.PlaneGeometry(12.6, 0.3)), guardar(new THREE.MeshStandardMaterial({ map: faixaMarquise, emissive: 0xffffff, emissiveMap: faixaMarquise, emissiveIntensity: 0.9, roughness: 0.6 })));
  fm.position.set(0, 3.87, 6.11); cena.add(fm);

  // portas automáticas (deslizam com o avanço da câmera)
  const portaGeo = guardar(new THREE.BoxGeometry(1.62, 2.86, 0.03));
  const portas = [-1, 1].map(s => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(portaGeo, M.vidro));
    for (const [w, h, x, y] of [[1.62, 0.07, 0, 1.4], [1.62, 0.07, 0, -1.4], [0.06, 2.86, s * -0.78, 0], [0.06, 2.86, s * 0.78, 0]]) { const b = new THREE.Mesh(guardar(new THREE.BoxGeometry(w, h, 0.06)), M.aco); b.position.set(x, y, 0); g.add(b); }
    g.position.set(s * 0.81, 1.47, 0.05); cena.add(g);
    return { g, s };
  });
  const abrirPortas = k => { for (const p of portas) p.g.position.x = p.s * (0.81 + 1.55 * k); };

  // mescla final
  const malhasEstaticas = [];
  for (const [nome, lista] of baldes) {
    const geo = guardar(mergeGeometries(lista, false));
    lista.forEach(g => g.dispose());
    const m = new THREE.Mesh(geo, M[nome]);
    const sombra = !["vidro", "luzQuente", "luzFria", "grama", "piso", "terrazo", "asfalto", "teto"].includes(nome);
    m.castShadow = sombra && !baixo; m.receiveShadow = !baixo && !["luzQuente", "luzFria", "vidro"].includes(nome);
    if (nome === "vidro") m.renderOrder = 2;
    cena.add(m); malhasEstaticas.push(m);
  }

  // ---------- céu, luz e névoa ----------
  const sol = new THREE.Vector3(0.62, 0.26, 0.6).normalize();
  const ceuMat = guardar(new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sol: { value: sol } },
    vertexShader: "varying vec3 vd; void main(){ vd = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }",
    fragmentShader: "uniform vec3 sol; varying vec3 vd; void main(){ float h = clamp(vd.y,0.0,1.0); vec3 zen = vec3(0.17,0.33,0.58); vec3 hor = vec3(1.0,0.72,0.48); vec3 c = mix(hor, zen, pow(h,0.55)); float s = max(dot(normalize(vd), sol),0.0); c += vec3(1.0,0.70,0.42)*pow(s,8.0)*0.45 + vec3(1.0,0.86,0.66)*pow(s,900.0)*3.0; c = mix(c, vec3(0.86,0.78,0.70), clamp(-vd.y*4.0,0.0,1.0)); gl_FragColor = vec4(c,1.0); }"
  }));
  const ceu = new THREE.Mesh(guardar(new THREE.SphereGeometry(300, 32, 16)), ceuMat); cena.add(ceu);
  cena.fog = new THREE.Fog(0xf0c9a2, 50, 200);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const cenaCeu = new THREE.Scene(); cenaCeu.add(new THREE.Mesh(ceu.geometry, ceuMat));
  const env = pmrem.fromScene(cenaCeu, 0.02).texture; guardar(env); pmrem.dispose();
  cena.environment = env;
  for (const m of Object.values(M)) if (m.envMapIntensity === 1) m.envMapIntensity = 0.55;

  cena.add(new THREE.HemisphereLight(0xcfe0f2, 0x7a634c, 0.42));
  const luzSol = new THREE.DirectionalLight(0xffc68f, 3.4);
  luzSol.position.copy(sol).multiplyScalar(60); luzSol.target.position.set(0, 0, 2);
  if (!baixo) {
    luzSol.castShadow = true; const t = alto ? 2048 : 1024; luzSol.shadow.mapSize.set(t, t);
    Object.assign(luzSol.shadow.camera, { left: -30, right: 30, top: 26, bottom: -18, near: 10, far: 140 });
    luzSol.shadow.bias = -0.0004; luzSol.shadow.normalBias = 0.03;
  }
  cena.add(luzSol, luzSol.target);
  // luz interna: poucas fontes quentes (o restante vem do ambiente e das luminárias emissivas)
  for (const [x, z, i] of (baixo ? [[0, -8, 40]] : [[0, -9.6, 34], [-5.5, -5, 22], [5.5, -5, 22]])) {
    const l = new THREE.PointLight(0xffe3bf, i, 18, 2); l.position.set(x, 4.1, z); cena.add(l);
  }

  // ---------- câmera, entrada e foco ----------
  const curvaPos = new THREE.CatmullRomCurve3(INTRO.map(k => new THREE.Vector3(...k[0])), false, "centripetal");
  const curvaAlvo = new THREE.CatmullRomCurve3(INTRO.map(k => new THREE.Vector3(...k[1])), false, "centripetal");
  const DUR = 6.2;
  const alvo = new THREE.Vector3();
  let estado = "parado", tIntro = 0, voo = null, portasK = 0, parallax = { x: 0, y: 0 };
  const tmp = new THREE.Vector3();
  let congelado = false;
  let quadros = 0, tempoQuadros = 0, rodando = false, pendente = true, ultimo = 0, ativo = true;

  function ajustarTela() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const hfov = 74 * Math.PI / 180;
    camera.fov = lim(2 * Math.atan(Math.tan(hfov / 2) / camera.aspect) * 180 / Math.PI, 46, camera.aspect < 0.8 ? 64 : 80);
    const dx = w > 820 ? Math.min(230, w * 0.15) : 0, dy = w <= 820 ? Math.min(70, h * 0.07) : 0;
    if (dx || dy) camera.setViewOffset(w, h, dx, dy, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix(); pedir();
  }
  function poseIntro(u) {
    const e = senoide(u);
    curvaPos.getPointAt(e, camera.position); curvaAlvo.getPointAt(e, alvo);
    camera.lookAt(alvo);
    const k = lim((u - 0.5) / 0.16, 0, 1); if (k !== portasK) { portasK = k; abrirPortas(suave(k)); sombraSuja = true; }
  }
  let sombraSuja = true;
  function irPara(pos, olhar, dur = 1.25) {
    if (reduzido) dur = 0.001;
    voo = { de: camera.position.clone(), deAlvo: alvo.clone(), para: pos.clone(), paraAlvo: olhar.clone(), t: 0, dur };
    estado = "voo"; acordar();
  }
  function fimIntro() {
    estado = "parado"; portasK = 1; abrirPortas(1); sombraSuja = true;
    camera.position.copy(VISAO.pos); alvo.copy(VISAO.alvo); camera.lookAt(alvo);
    stats.introMs = Math.round(performance.now() - T0); pedir();
    aoFimIntro && aoFimIntro();
  }

  const stats = { nivel, dpr, fps: 0, drawCalls: 0, triangulos: 0, carregamentoMs: 0, introMs: 0 };
  function quadro(agora) {
    rodando = false;
    if (!ativo) return;
    const dt = Math.min(0.05, ultimo ? (agora - ultimo) / 1000 : 0.016); ultimo = agora;
    let anima = false;
    if (estado === "intro") {
      if (!congelado) tIntro += dt / DUR; anima = !congelado;
      if (tIntro >= 1) fimIntro(); else poseIntro(tIntro);
      quadros++; tempoQuadros += dt;
      // queda de qualidade automática se o aparelho não acompanhar
      if (tempoQuadros > 1.4 && quadros / tempoQuadros < 28 && dpr > 1) { dpr = Math.max(1, dpr * 0.75); renderer.setPixelRatio(dpr); stats.dpr = dpr; ajustarTela(); quadros = 0; tempoQuadros = 0; }
    } else if (estado === "voo" && voo) {
      voo.t += Math.min(0.1, (agora - (voo.t0 || (voo.t0 = agora - 16))) / 1000) / voo.dur; voo.t0 = agora; const e = suave(Math.min(1, voo.t));
      camera.position.lerpVectors(voo.de, voo.para, e);
      const arco = Math.sin(Math.PI * e) * 0.35; camera.position.y += arco;
      alvo.lerpVectors(voo.deAlvo, voo.paraAlvo, e);
      camera.lookAt(alvo); anima = true;
      if (voo.t >= 1) { estado = "parado"; voo = null; }
    }
    if (estado === "parado" && (parallax.x || parallax.y)) {
      tmp.copy(alvo); tmp.x += parallax.x * 0.5; tmp.y += parallax.y * 0.25; camera.lookAt(tmp);
    }
    for (const id in brilho) {
      const b = brilho[id]; const d = b.alvo - b.v;
      if (Math.abs(d) > 0.005) { b.v += d * Math.min(1, dt * 10); anima = true; } else b.v = b.alvo;
      destaques[id] && (destaques[id].emissiveIntensity = b.v);
    }
    if (sombraSuja && renderer.shadowMap.enabled) { renderer.shadowMap.needsUpdate = true; sombraSuja = false; }
    renderer.render(cena, camera);
    stats.drawCalls = renderer.info.render.calls; stats.triangulos = renderer.info.render.triangles;
    if (estado === "intro" && tempoQuadros) stats.fps = Math.round(quadros / tempoQuadros);
    projetar();
    if (anima || pendente) { pendente = false; acordar(); }
  }
  function acordar() { if (!rodando && ativo) { rodando = true; requestAnimationFrame(quadro); } }
  function pedir() { pendente = true; acordar(); }

  const brilho = {};
  function projetar() {
    if (!aoProjetar) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    aoProjetar(SETORES.map(s => {
      tmp.set(...s.p).project(camera);
      const frente = tmp.z < 1 && tmp.z > -1;
      return { id: s.id, x: (tmp.x * 0.5 + 0.5) * w, y: (-tmp.y * 0.5 + 0.5) * h, visivel: frente && Math.abs(tmp.x) < 1.05 && Math.abs(tmp.y) < 1.05 && estado !== "intro" };
    }));
  }

  // ---------- ciclo de vida ----------
  const aoRedimensionar = () => ajustarTela();
  const aoVisibilidade = () => { ativo = !document.hidden; if (ativo) { ultimo = 0; pedir(); } };
  const aoMover = e => { if (estado !== "parado" || reduzido || e.pointerType !== "mouse") return; parallax.x = (e.clientX / innerWidth - 0.5); parallax.y = -(e.clientY / innerHeight - 0.5); pedir(); };
  addEventListener("resize", aoRedimensionar);
  document.addEventListener("visibilitychange", aoVisibilidade);
  addEventListener("pointermove", aoMover, { passive: true });
  canvas.addEventListener("webglcontextlost", e => { e.preventDefault(); ativo = false; aoFalhar && aoFalhar(new Error("contexto perdido")); });

  ajustarTela();
  stats.carregamentoMs = Math.round(performance.now() - T0);
  if (intro && !reduzido) { estado = "intro"; tIntro = 0; poseIntro(0); }
  else fimIntro();
  pedir();

  const api = {
    stats,
    pular() { if (estado === "intro") fimIntro(); },
    /** Só para QA visual: congela a abertura no instante u (0–1); null retoma. */
    amostrar(u) { if (estado !== "intro") return false; congelado = u != null; if (u != null) { tIntro = u; poseIntro(u); } pedir(); return true; },
    focar(id) {
      const s = SETORES.find(x => x.id === id); if (!s) return;
      if (estado === "intro") fimIntro();
      irPara(new THREE.Vector3(...s.cam), new THREE.Vector3(s.p[0], s.id === "tv" ? s.p[1] : Math.max(1.4, s.p[1] - 0.85), s.p[2]));
    },
    visaoGeral() { if (estado === "intro") fimIntro(); irPara(VISAO.pos, VISAO.alvo); },
    destacar(id, ligado) { brilho[id] = brilho[id] || { v: 0, alvo: 0 }; brilho[id].alvo = ligado ? 0.55 : 0; acordar(); },
    destruir() {
      ativo = false;
      removeEventListener("resize", aoRedimensionar); document.removeEventListener("visibilitychange", aoVisibilidade); removeEventListener("pointermove", aoMover);
      cena.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      for (const d of descartaveis) d.dispose && d.dispose();
      renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss();
    }
  };
  window.__hospital = api;
  return api;
}
