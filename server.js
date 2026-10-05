require("dotenv").config();

const express = require("express");
const path = require("path");
const mysql = require("mysql2/promise");

const app = express();

const PORT = process.env.PORT || 10000;

// ======================================================
// CONFIGURAÇÕES
// ======================================================

const PAGBANK_TOKEN = process.env.PAGBANK_TOKEN;

const PAGBANK_API =
  process.env.PAGBANK_ENV === "production"
    ? "https://api.pagseguro.com"
    : "https://sandbox.api.pagseguro.com";

const SITE_URL =
  process.env.SITE_URL || "https://luxor-store-1.onrender.com";

// ======================================================
// MIDDLEWARE
// ======================================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ======================================================
// ARQUIVOS DO SITE
// ======================================================

app.use(express.static(__dirname));

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

// ======================================================
// CONEXÃO COM MARIADB / MYSQL
// ======================================================

let pool = null;

function obterBanco() {
  if (pool) return pool;

  if (!process.env.DB_HOST) {
    console.log("AVISO: DB_HOST não configurado.");
    return null;
  }

  pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || "lojadereilogio",

    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,

    ssl:
      process.env.DB_SSL === "false"
        ? undefined
        : {
            rejectUnauthorized: false
          }
  });

  return pool;
}

// ======================================================
// TESTE DA API
// ======================================================

app.get("/api", (req, res) => {
  res.json({
    ok: true,
    mensagem: "Servidor LUXOR funcionando."
  });
});

// ======================================================
// CRIAR PEDIDO
// ======================================================

app.post("/api/pedidos", async (req, res) => {
  try {
    console.log("======================================");
    console.log("NOVO PEDIDO RECEBIDO");
    console.log("======================================");

    const { cliente, produto } = req.body;

    // --------------------------------------------------
    // VALIDAR DADOS
    // --------------------------------------------------

    if (!cliente || !produto) {
      return res.status(400).json({
        ok: false,
        error: "Dados do cliente ou produto não enviados."
      });
    }

    if (!cliente.nome || !cliente.email || !cliente.telefone) {
      return res.status(400).json({
        ok: false,
        error: "Preencha nome, e-mail e telefone."
      });
    }

    if (
      !cliente.cep ||
      !cliente.estado ||
      !cliente.endereco ||
      !cliente.numero ||
      !cliente.cidade
    ) {
      return res.status(400).json({
        ok: false,
        error: "Preencha todos os dados obrigatórios do endereço."
      });
    }

    if (!produto.nome || !produto.preco) {
      return res.status(400).json({
        ok: false,
        error: "Produto inválido."
      });
    }

    const valor = Number(produto.preco);

    if (!Number.isFinite(valor) || valor <= 0) {
      return res.status(400).json({
        ok: false,
        error: "Valor do produto inválido."
      });
    }

    // --------------------------------------------------
    // CRIAR REFERÊNCIA
    // --------------------------------------------------

    const referencia =
      "LUXOR-" +
      Date.now() +
      "-" +
      Math.floor(Math.random() * 10000);

    // --------------------------------------------------
    // SALVAR PEDIDO NO BANCO
    // --------------------------------------------------

    let pedidoId = null;

    const banco = obterBanco();

    if (banco) {
      const [resultado] = await banco.execute(
        `
        INSERT INTO pedidos
        (
          produto_nome,
          valor,
          nome,
          email,
          telefone,
          cpf,
          cep,
          endereco,
          numero,
          complemento,
          cidade,
          estado,
          status,
          payment_status,
          pagbank_checkout_id
        )
        VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         'aguardando_pagamento',
         'pending',
         NULL)
        `,
        [
          produto.nome,
          valor.toFixed(2),
          cliente.nome,
          cliente.email,
          cliente.telefone,
          cliente.cpf || null,
          cliente.cep,
          cliente.endereco,
          cliente.numero,
          cliente.complemento || null,
          cliente.cidade,
          cliente.estado
        ]
      );

      pedidoId = resultado.insertId;

      console.log("Pedido salvo no banco:", pedidoId);
    } else {
      console.log(
        "DB_HOST não configurado. Pedido não foi salvo no banco."
      );
    }

    // --------------------------------------------------
    // VERIFICAR TOKEN PAGBANK
    // --------------------------------------------------

    if (!PAGBANK_TOKEN) {
      return res.status(500).json({
        ok: false,
        error:
          "PAGBANK_TOKEN não configurado no Render. O pedido foi recebido, mas o pagamento não pôde ser criado."
      });
    }

    // --------------------------------------------------
    // VALOR EM CENTAVOS
    // R$ 349,90 = 34990
    // --------------------------------------------------

    const valorCentavos = Math.round(valor * 100);

    // --------------------------------------------------
    // CRIAR CHECKOUT PAGBANK
    // --------------------------------------------------

    const payload = {
      reference_id: referencia,

      customer_modifiable: true,

      customer: {
        name: cliente.nome,
        email: cliente.email,
        tax_id: cliente.cpf
          ? cliente.cpf.replace(/\D/g, "")
          : undefined,
        phone: {
          country: "+55",
          area:
            cliente.telefone
              .replace(/\D/g, "")
              .slice(0, 2) || "00",
          number:
            cliente.telefone
              .replace(/\D/g, "")
              .slice(-9) || "000000000"
        }
      },

      items: [
        {
          reference_id: String(
            produto.id || produto.produto_id || "1"
          ),
          name: produto.nome,
          quantity: 1,
          unit_amount: valorCentavos
        }
      ],

      payment_methods: [
        {
          type: "CREDIT_CARD"
        },
        {
          type: "PIX"
        },
        {
          type: "BOLETO"
        }
      ],

      redirect_url:
        SITE_URL + "/pagamento-retorno.html",

      return_url:
        SITE_URL + "/index.html",

      notification_urls: [
        SITE_URL + "/api/pagbank/notificacao"
      ],

      payment_notification_urls: [
        SITE_URL + "/api/pagbank/notificacao"
      ]
    };

    console.log("Criando checkout PagBank...");

    const respostaPagBank = await fetch(
      PAGBANK_API + "/checkouts",
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${PAGBANK_TOKEN}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },

        body: JSON.stringify(payload)
      }
    );

    const textoPagBank = await respostaPagBank.text();

    let dadosPagBank;

    try {
      dadosPagBank = JSON.parse(textoPagBank);
    } catch (erro) {
      console.error(
        "Resposta inválida do PagBank:",
        textoPagBank
      );

      return res.status(502).json({
        ok: false,
        error: "O PagBank retornou uma resposta inválida."
      });
    }

    if (!respostaPagBank.ok) {
      console.error(
        "ERRO PAGBANK:",
        JSON.stringify(dadosPagBank, null, 2)
      );

      return res.status(502).json({
        ok: false,
        error:
          dadosPagBank?.error_messages?.[0]?.description ||
          "Não foi possível criar o checkout PagBank."
      });
    }

    // --------------------------------------------------
    // PEGAR ID DO CHECKOUT
    // --------------------------------------------------

    const pagbankCheckoutId = dadosPagBank.id || null;

    // --------------------------------------------------
    // PEGAR LINK DE PAGAMENTO
    // --------------------------------------------------

    const linkPagamento =
      Array.isArray(dadosPagBank.links)
        ? dadosPagBank.links.find(
            link => link.rel === "PAY"
          )
        : null;

    const payLink = linkPagamento?.href || null;

    if (!payLink) {
      console.error(
        "PagBank não retornou link PAY:",
        JSON.stringify(dadosPagBank, null, 2)
      );

      return res.status(502).json({
        ok: false,
        error:
          "O PagBank criou o checkout, mas não retornou o link de pagamento."
      });
    }

    // --------------------------------------------------
    // ATUALIZAR ID PAGBANK NO BANCO
    // --------------------------------------------------

    if (banco && pedidoId) {
      await banco.execute(
        `
        UPDATE pedidos
        SET pagbank_checkout_id = ?
        WHERE id = ?
        `,
        [pagbankCheckoutId, pedidoId]
      );
    }

    console.log("Checkout PagBank criado.");
    console.log("ID:", pagbankCheckoutId);
    console.log("Link:", payLink);

    // --------------------------------------------------
    // RESPONDER AO CHECKOUT.HTML
    // --------------------------------------------------

    return res.status(201).json({
      ok: true,
      pedidoId: pedidoId,
      pagbankCheckoutId: pagbankCheckoutId,
      payLink: payLink
    });
  } catch (erro) {
    console.error("ERRO AO CRIAR PEDIDO:");
    console.error(erro);

    return res.status(500).json({
      ok: false,
      error:
        erro.message ||
        "Erro interno ao criar o pedido."
    });
  }
});

// ======================================================
// NOTIFICAÇÃO DO PAGBANK
// ======================================================

app.post("/api/pagbank/notificacao", async (req, res) => {
  try {
    console.log("======================================");
    console.log("NOTIFICAÇÃO PAGBANK");
    console.log("======================================");

    console.log(
      JSON.stringify(req.body, null, 2)
    );

    /*
      O PagBank pode enviar notificações de alteração
      de status do checkout/pagamento.

      O processamento detalhado pode ser adicionado
      posteriormente para atualizar payment_status
      no banco.
    */

    return res.status(200).json({
      ok: true
    });
  } catch (erro) {
    console.error(
      "Erro na notificação PagBank:",
      erro
    );

    return res.status(500).json({
      ok: false
    });
  }
});

// ======================================================
// TRATAMENTO DE ERROS
// ======================================================

app.use((err, req, res, next) => {
  console.error("ERRO EXPRESS:", err);

  if (req.path.startsWith("/api/")) {
    return res.status(500).json({
      ok: false,
      error: "Erro interno do servidor."
    });
  }

  res.status(500).send("Erro interno do servidor.");
});

// ======================================================
// INICIAR SERVIDOR
// ======================================================

app.listen(PORT, "0.0.0.0", () => {
  console.log("======================================");
  console.log("SERVIDOR LUXOR FUNCIONANDO");
  console.log("PORTA:", PORT);
  console.log("PAGBANK:", PAGBANK_API);
  console.log("SITE:", SITE_URL);
  console.log("======================================");
});
