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
  (process.env.PAGBANK_ENV || "sandbox").toLowerCase();

const PAGBANK_TOKEN =
  process.env.PAGBANK_TOKEN;

const PAGBANK_API =
  PAGBANK_ENV === "production"
    ? "https://api.pagseguro.com"
    : "https://sandbox.api.pagseguro.com";


/* =========================================================
   BANCO DE DADOS
========================================================= */

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


/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(__dirname));


/* =========================================================
   PÁGINAS
========================================================= */

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "index.html")
  );
});

app.get("/checkout.html", (req, res) => {
  res.sendFile(
    path.join(__dirname, "checkout.html")
  );
});

app.get("/admin.html", (req, res) => {
  res.sendFile(
    path.join(__dirname, "admin.html")
  );
});

app.get("/pagamento-retorno.html", (req, res) => {
  res.sendFile(
    path.join(__dirname, "pagamento-retorno.html")
  );
});


/* =========================================================
   TESTE DA API
========================================================= */

app.get("/api", async (req, res) => {

  let banco = false;

  try {

    await pool.query("SELECT 1");

    banco = true;

  } catch (error) {

    console.error(
      "Erro ao testar banco:",
      error.message
    );

  }

  res.json({
    ok: true,
    servidor: "LUXOR",
    banco: banco,
    pagbank: PAGBANK_ENV
  });

});


/* =========================================================
   TESTE DO BANCO
========================================================= */

app.get("/api/banco", async (req, res) => {

  try {

    const [rows] =
      await pool.query(
        "SELECT NOW() AS data"
      );

    res.json({

      ok: true,

      banco: "conectado",

      data:
        rows[0].data

    });

  } catch (error) {

    console.error(
      "Erro MariaDB:",
      error
    );

    res.status(500).json({

      ok: false,

      error:
        "Não foi possível conectar ao MariaDB.",

      detalhes:
        error.message

    });

  }

});


/* =========================================================
   PRODUTOS
========================================================= */

app.get("/api/produtos", async (req, res) => {

  try {

    const [produtos] =
      await pool.query(`
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

    res.json({

      ok: true,

      produtos:
        produtos

    });

  } catch (error) {

    console.error(
      "Erro ao buscar produtos:",
      error
    );

    res.status(500).json({

      ok: false,

      error:
        "Não foi possível carregar os produtos.",

      detalhes:
        error.message

    });

  }

});


/* =========================================================
   CRIAR PEDIDO
========================================================= */

app.post(
  "/api/pedidos",
  async (req, res) => {

    let connection = null;

    try {

      if (!PAGBANK_TOKEN) {

        return res.status(500).json({

          ok: false,

          error:
            "PAGBANK_TOKEN não configurado no Render."

        });

      }


      const {
        cliente,
        produto
      } = req.body;


      if (!cliente) {

        return res.status(400).json({

          ok: false,

          error:
            "Dados do cliente não foram enviados."

        });

      }


      if (!produto) {

        return res.status(400).json({

          ok: false,

          error:
            "Produto não foi enviado."

        });

      }


      /* =========================
         CLIENTE
      ========================= */

      const nome =
        String(
          cliente.nome || ""
        ).trim();

      const email =
        String(
          cliente.email || ""
        ).trim();

      const telefone =
        String(
          cliente.telefone || ""
        ).replace(/\D/g, "");

      const cpf =
        String(
          cliente.cpf || ""
        ).replace(/\D/g, "");

      const cep =
        String(
          cliente.cep || ""
        ).trim();

      const estado =
        String(
          cliente.estado || ""
        ).trim();

      const endereco =
        String(
          cliente.endereco || ""
        ).trim();

      const numero =
        String(
          cliente.numero || ""
        ).trim();

      const complemento =
        String(
          cliente.complemento || ""
        ).trim();

      const cidade =
        String(
          cliente.cidade || ""
        ).trim();


      /* =========================
         PRODUTO
      ========================= */

      const produtoId =
        Number(
          produto.id || 0
        );

      const produtoNome =
        String(
          produto.nome ||
          "Relógio Premium importado"
        ).trim();

      const preco =
        Number(
          produto.preco
        );


      /* =========================
         VALIDAÇÕES
      ========================= */

      if (!nome) {

        return res.status(400).json({

          ok: false,

          error:
            "Informe o nome completo."

        });

      }


      if (!email) {

        return res.status(400).json({

          ok: false,

          error:
            "Informe o e-mail."

        });

      }


      if (
        !Number.isFinite(preco) ||
        preco <= 0
      ) {

        return res.status(400).json({

          ok: false,

          error:
            "Valor do produto inválido."

        });
