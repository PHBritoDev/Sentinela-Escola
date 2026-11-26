/** Setores do hospital 3D: posição do ponto (p), da câmera (cam), destino e perfis com acesso (o admin sempre tem). */
export const SETORES = [
  { id: "recepcao", nome: "Recepção", desc: "Cadastro com nome fictício, código SIM e senha de atendimento.", href: "atendimento.html", perfis: ["atendimento"], cor: "#0f766e", p: [0, 1.25, -10.4], cam: [0.4, 1.7, -5.6] },
  { id: "triagem", nome: "Triagem", desc: "Sinais vitais e classificação de risco por cores.", href: "triagem.html", perfis: ["triagem"], cor: "#d97706", p: [-8.85, 2.45, -4], cam: [-3.4, 1.75, -0.6] },
  { id: "medicacao", nome: "Medicação", desc: "Prescrições do consultório e registro da alta.", href: "medicacoes.html", perfis: ["enfermagem", "medico"], cor: "#15803d", p: [-8.85, 2.45, -9.5], cam: [-3.6, 1.75, -5.4] },
  { id: "consultorio", nome: "Consultórios", desc: "Fila por gravidade e registro da consulta. Exige login médico.", href: "medico.html", perfis: ["medico"], cor: "#2563eb", p: [8.85, 2.45, -4], cam: [3.4, 1.75, -0.6] },
  { id: "almoxarifado", nome: "Almoxarifado", desc: "Estoque fictício de materiais, entradas e saídas.", href: "almoxarifado.html", perfis: ["enfermagem", "medico"], cor: "#64748b", p: [8.85, 2.45, -9.5], cam: [3.6, 1.75, -5.4] },
  { id: "tv", nome: "Painel de chamadas", desc: "TV pública da sala de espera: mostra apenas senha e local.", href: "tv.html", publico: true, cor: "#1e3a5f", p: [-6.2, 2.55, -13.85], cam: [-3.6, 1.7, -8.2] },
  { id: "admin", nome: "Administração", desc: "Equipe, auditoria, cenário de demonstração.", href: "admin.html", perfis: [], cor: "#0b5a54", p: [6.4, 2.45, -13.9], cam: [3.4, 1.7, -8.4] }
];
