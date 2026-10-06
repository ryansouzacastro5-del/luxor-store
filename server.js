const express = require("express");
const path = require("path");
const mysql = require("mysql2/promise");

require("dotenv").config();

const app = express();

const PORT = process.env.PORT || 10000;

const PUBLIC_URL =
  process.env.PUBLIC_URL ||
  "https://luxor-store-1.onrender.com";

const PAGBANK_ENV =
  process.env.PAGBANK_ENV || "sandbox";

const PAGBANK_TOKEN =
  process.env.PAGBANK_TOKEN || "";

const PAGBANK_API =
  PAGBANK_ENV === "production"
    ? "https://api.pagseguro.com"
    : "https://sandbox.api.pagseguro.com";

// ===============================
// BANCO DE DADOS
// ===============================

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "lojadereilogio",

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,

  ssl:
    process.env.DB_SSL === "false"
      ? undefined
      : {
          rejectUnauthorized: false
        }
});

// ===============================
// MIDDLEWARE
// ===============================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// ===============================
// PÁGINAS
// ===============================

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/checkout.html", (req, res) => {
  res.sendFile(path.join(__dirname, "checkout.html"));
});

app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/pagamento-retorno.html", (req, res) => {
  res.sendFile(path.join(__dirname, "pagamento-retorno.html"));
});

app.get("/painel/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// ===============================
// TESTE DA API
// ===============================

app.get("/api", async (req, res) => {
  let banco = false;

  try {
    const connection = await pool.getConnection();

    await connection.query("SELECT 1");

    connection.release();

    banco = true;
  } catch (error) {
    console.error("Erro no banco:", error.message);
  }

  res.json({
    ok: true,
    servidor: "LUXOR",
    banco,
    pagbank: PAGBANK_ENV
  });
});

// ===============================
// TESTE DO BANCO
// ===============================

app.get("/api/banco", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT 1 AS conectado"
    );

    res.json({
      ok: true,
      banco: rows[0]
    });

  } catch (error) {
    console.error("Erro no banco:", error);

    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// ===============================
// PRODUTOS
// ===============================

app.get("/api/produtos", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        id,
        nome,
        descricao,
        preco,
        estoque,
        imagem
      FROM produtos
      ORDER BY id ASC
    `);

    res.json(rows);

  } catch (error) {
    console.error("Erro ao buscar produtos:", error);

    res.status(500).json({
      ok: false,
      error: "Erro ao buscar produtos."
    });
  }
});

// ===============================
// CRIAR PEDIDO + PAGBANK
// ===============================

app.post("/api/pedidos", async (req, res) => {
  try {

    const { cliente, produto } = req.body;

    if (!cliente) {
      return res.status(400).json({
        ok: false,
