/** Servidor local: `npm start` e abra http://localhost:3000 */
const app = require("./app");
const store = require("./store");

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log("Saúde+ Sentinela rodando em http://localhost:" + PORT + " (armazenamento: " + store.modo() + ")");
});
