/** Servidor local: `npm start` e abra http://localhost:3000 */
const app = require("./app");
const store = require("./store");

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log("Sumaúma rodando na porta " + PORT + " (armazenamento: " + store.modo() + ")");
  // diagnóstico sem expor valores: indica só se o administrador está configurado
  try { store.credenciaisAdmin(); console.log("[config] administrador: configurado"); }
  catch (e) { console.error("[config] administrador NÃO configurado: " + e.message); }
});
