const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 10000;

// JSON
app.use(express.json());

// Arquivos estáticos na raiz do projeto
app.use(express.static(__dirname));

// Página inicial
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Checkout
app.get("/checkout.html", (req, res) => {
  res.sendFile(path.join(__dirname, "checkout.html"));
});

// Admin
app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// Retorno do pagamento
app.get("/pagamento-retorno.html", (req, res) => {
  res.sendFile(path.join(__dirname, "pagamento-retorno.html"));
});

// Teste da API
app.get("/api", (req, res) => {
  res.json({
    ok: true,
    mensagem: "Servidor LUXOR funcionando."
  });
});

// Iniciar servidor
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor LUXOR funcionando na porta ${PORT}`);
});
