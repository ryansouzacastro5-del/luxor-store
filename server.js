const express = require("express");
const path = require("path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const app = express();

const PORT = process.env.PORT || 10000;

const PUBLIC_URL =
  process.env.PUBLIC_URL ||
  "https://luxor-store-1.onrender.com";

// =====================================================
// PAGBANK
// =====================================================

const PAGBANK_ENV =
  String(process.env.PAGBANK_ENV || "sandbox").toLowerCase();

const PAGBANK_API =
  PAGBANK_ENV === "production"
    ? "https://api.pagseguro.com"
    : "https://sandbox.api.pagseguro.com";

// Token: no Render coloque SOMENTE o token.
// Não coloque "Bearer" no valor da variável.
let PAGBANK_TOKEN = String(
  process.env.PAGBANK_TOKEN || ""
).trim();

PAGBANK_TOKEN = PAGBANK_TOKEN
  .replace(/^Bearer\s+/i, "")
  .trim();

// =====================================================
// MIDDLEWARE
// =====================================================

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Arquivos do site
app.use(express.static(__dirname));

// =====================================================
// BANCO DE DADOS
// =====================================================

const dbConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "lojadereilogio",
  ssl:
    process.env.DB_SSL === "false"
      ? undefined
      : {
          rejectUnauthorized: false
        },
  connectTimeout: 20000
};

let pool;

try {
  pool = mysql.createPool({
    ...dbConfig,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });
} catch (erro) {
  console.error("Erro ao criar pool do banco:", erro);
}

// =====================================================
// TESTE DE BANCO
// =====================================================

async function testarBanco() {
  try {
    const conexao = await pool.getConnection();
    await conexao.ping();
    conexao.release();

    return true;
  } catch (erro) {
    console.error("Erro MariaDB:", erro.message);
    return false;
  }
}

// =====================================================
// API PRINCIPAL
// =====================================================

app.get("/api", async (req, res) => {
  const banco = await testarBanco();

  res.json({
    ok: true,
    servidor: "LUXOR",
    banco,
    pagbank: PAGBANK_ENV,
    pagbank_token_configurado: Boolean(PAGBANK_TOKEN)
  });
});

// =====================================================
// STATUS DO BANCO
// =====================================================

app.get("/api/banco", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT 1 AS ok");

    res.json({
      ok: true,
      banco: true,
      resultado: rows
    });
  } catch (erro) {
    console.error("Erro /api/banco:", erro);

    res.status(500).json({
      ok: false,
      banco: false,
      erro: erro.message
    });
  }
});

// =====================================================
// PRODUTOS
// =====================================================

app.get("/api/produtos", async (req, res) => {
  try {
    const [produtos] = await pool.query(
      "SELECT * FROM produtos ORDER BY id ASC"
    );

    res.json(produtos);
  } catch (erro) {
    console.error("Erro /api/produtos:", erro);

    res.status(500).json({
      ok: false,
      erro: erro.message
    });
  }
});

// =====================================================
// CRIAR PEDIDO
// =====================================================

app.post("/api/pedidos", async (req, res) => {
  try {
    const {
      produto_id,
      produto_nome,
      quantidade = 1,
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
      estado
    } = req.body;

    if (!nome || !email || !cpf) {
      return res.status(400).json({
        ok: false,
        erro: "Nome, e-mail e CPF são obrigatórios."
      });
    }

    if (!produto_nome || valor === undefined) {
      return res.status(400).json({
        ok: false,
        erro: "Produto e valor são obrigatórios."
      });
    }

    const quantidadeFinal = Number(quantidade) || 1;
    const valorFinal = Number(valor);

    if (!Number.isFinite(valorFinal) || valorFinal <= 0) {
      return res.status(400).json({
        ok: false,
        erro: "Valor inválido."
      });
    }

    const [resultado] = await pool.query(
      `
      INSERT INTO pedidos
      (
        produto_id,
        produto_nome,
        quantidade,
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
        payment_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        produto_id || null,
        produto_nome,
        quantidadeFinal,
        valorFinal,
        nome,
        email,
        telefone || null,
        cpf,
        cep || null,
        endereco || null,
        numero || null,
        complemento || null,
        cidade || null,
        estado || null,
        "aguardando_pagamento",
        "PENDING"
      ]
    );

    const pedidoId = resultado.insertId;

    // =================================================
    // PAGBANK
    // =================================================

    if (!PAGBANK_TOKEN) {
      return res.status(500).json({
        ok: false,
        pedido_id: pedidoId,
        erro: "PAGBANK_TOKEN não configurado no Render."
      });
    }

    const referenceId = `LUXOR-${pedidoId}`;

    const payload = {
      reference_id: referenceId,

      customer: {
        name: nome,
        email: email
      },

      customer_modifiable: true,

      items: [
        {
          reference_id: String(produto_id || pedidoId),
          name: produto_nome,
          quantity: quantidadeFinal,
          unit_amount: Math.round(valorFinal * 100)
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
        `${PUBLIC_URL}/pagamento-retorno.html?pedido=${pedidoId}`,

      redirect_waiting_time: 5,

      return_url:
        `${PUBLIC_URL}/pagamento-retorno.html?pedido=${pedidoId}`,

      notification_urls: [
        `${PUBLIC_URL}/api/pagbank/webhook`
      ],

      payment_notification_urls: [
        `${PUBLIC_URL}/api/pagbank/webhook`
      ]
    };

    console.log("======================================");
    console.log("PAGBANK - CRIANDO CHECKOUT");
    console.log("Ambiente:", PAGBANK_ENV);
    console.log("Endpoint:", `${PAGBANK_API}/checkouts`);
    console.log("Pedido:", pedidoId);
    console.log("Reference ID:", referenceId);
    console.log("Token configurado:", Boolean(PAGBANK_TOKEN));
    console.log("======================================");

    const respostaPagBank = await fetch(
      `${PAGBANK_API}/checkouts`,
      {
        method: "POST",

        headers: {
          // IMPORTANTE:
          // O token do Render NÃO deve conter "Bearer".
          // O código acrescenta automaticamente.
          "Authorization": `Bearer ${PAGBANK_TOKEN}`,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },

        body: JSON.stringify(payload)
      }
    );

    const textoResposta = await respostaPagBank.text();

    let dadosPagBank;

    try {
      dadosPagBank = JSON.parse(textoResposta);
    } catch {
      dadosPagBank = {
        resposta: textoResposta
      };
    }

    console.log(
      "PagBank HTTP:",
      respostaPagBank.status
    );

    console.log(
      "PagBank resposta:",
      JSON.stringify(dadosPagBank)
    );

    if (!respostaPagBank.ok) {
      const codigo =
        dadosPagBank?.error_messages?.[0]?.code ||
        dadosPagBank?.error_messages?.[0]?.error ||
        "pagbank_error";

      // Erro específico de autorização/homologação
      if (codigo === "allowlist_access_required") {
        return res.status(502).json({
          ok: false,
          pedido_id: pedidoId,
          erro:
            "O PagBank recusou o Checkout em produção porque esta conta ainda não está liberada/homologada para a API Checkout.",
          codigo,
          pagbank: dadosPagBank
        });
      }

      // Erro de token/autorização
      if (
        codigo === "invalid_authorization_header" ||
        codigo === "unauthorized"
      ) {
        return res.status(502).json({
          ok: false,
          pedido_id: pedidoId,
          erro:
            "O PagBank rejeitou o token de autenticação. Verifique o PAGBANK_TOKEN no Render.",
          codigo,
          pagbank: dadosPagBank
        });
      }

      return res.status(502).json({
        ok: false,
        pedido_id: pedidoId,
        erro: "Erro ao criar pagamento no PagBank.",
        codigo,
        pagbank: dadosPagBank
      });
    }

    // =================================================
    // ID DO CHECKOUT
    // =================================================

    const checkoutId =
      dadosPagBank?.id ||
      dadosPagBank?.checkout_id ||
      null;

    // =================================================
    // LINK DE PAGAMENTO
    // =================================================

    let paymentLink =
      dadosPagBank?.payment_link ||
      dadosPagBank?.pay_link ||
      null;

    if (!paymentLink && Array.isArray(dadosPagBank?.links)) {
      const linkPay = dadosPagBank.links.find(
        (link) =>
          String(link.rel || "").toUpperCase() === "PAY"
      );

      if (linkPay) {
        paymentLink =
          linkPay.href ||
          linkPay.url ||
          null;
      }
    }

    await pool.query(
      `
      UPDATE pedidos
      SET
        pagbank_reference_id = ?,
        pagbank_checkout_id = ?
      WHERE id = ?
      `,
      [
        referenceId,
        checkoutId,
        pedidoId
      ]
    );

    res.json({
      ok: true,
      pedido_id: pedidoId,
      reference_id: referenceId,
      checkout_id: checkoutId,
      payment_link: paymentLink,
      pagbank: dadosPagBank
    });
  } catch (erro) {
    console.error(
      "Erro geral ao criar pedido/pagamento:",
      erro
    );

    res.status(500).json({
      ok: false,
      erro: erro.message
    });
  }
});

// =====================================================
// PEDIDOS DO CLIENTE
// =====================================================

app.get("/api/pedidos/cliente", async (req, res) => {
  try {
    const email = String(req.query.email || "").trim();

    if (!email) {
      return res.status(400).json({
        ok: false,
        erro: "Informe o e-mail."
      });
    }

    const [pedidos] = await pool.query(
      `
      SELECT *
      FROM pedidos
      WHERE email = ?
      ORDER BY id DESC
      `,
      [email]
    );

    res.json(pedidos);
  } catch (erro) {
    console.error("Erro /api/pedidos/cliente:", erro);

    res.status(500).json({
      ok: false,
      erro: erro.message
    });
  }
});

// =====================================================
// RESUMO ADMIN
// =====================================================

app.get("/api/admin/resumo", async (req, res) => {
  try {
    const [[quantidade]] = await pool.query(
      "SELECT COUNT(*) AS quantidade FROM pedidos"
    );

    const [[total]] = await pool.query(
      `
      SELECT COALESCE(SUM(valor * quantidade), 0) AS total
      FROM pedidos
      `
    );

    const [[clientes]] = await pool.query(
      `
      SELECT COUNT(DISTINCT email) AS clientes
      FROM pedidos
      `
    );

    const [[ultima]] = await pool.query(
      `
      SELECT MAX(criado_em) AS ultima
      FROM pedidos
      `
    );

    res.json({
      quantidade: quantidade.quantidade,
      total: Number(total.total || 0),
      clientes: clientes.clientes,
      ultima: ultima.ultima
    });
  } catch (erro) {
    console.error("Erro /api/admin/resumo:", erro);

    res.status(500).json({
      ok: false,
      erro: erro.message
    });
  }
});

// =====================================================
// LISTAR PEDIDOS ADMIN
// =====================================================

app.get("/api/admin/pedidos", async (req, res) => {
  try {
    const [pedidos] = await pool.query(
      `
      SELECT *
      FROM pedidos
      ORDER BY id DESC
      `
    );

    res.json(pedidos);
  } catch (erro) {
    console.error("Erro /api/admin/pedidos:", erro);

    res.status(500).json({
      ok: false,
      erro: erro.message
    });
  }
});

// =====================================================
// PEDIDO ADMIN POR ID
// =====================================================

app.get("/api/admin/pedidos/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    const [pedidos] = await pool.query(
      `
      SELECT *
      FROM pedidos
      WHERE id = ?
      `,
      [id]
    );

    if (!pedidos.length) {
      return res.status(404).json({
        ok: false,
        erro: "Pedido não encontrado."
      });
    }

    res.json(pedidos[0]);
  } catch (erro) {
    console.error("Erro /api/admin/pedidos/:id:", erro);

    res.status(500).json({
      ok: false,
      erro: erro.message
    });
  }
});

// =====================================================
// WEBHOOK PAGBANK
// =====================================================

app.post("/api/pagbank/webhook", async (req, res) => {
  try {
    console.log(
      "Webhook PagBank recebido:",
      JSON.stringify(req.body)
    );

    const dados = req.body || {};

    let statusPagamento =
      dados?.charges?.[0]?.status ||
      dados?.status ||
      dados?.payment_status ||
      null;

    if (statusPagamento) {
      statusPagamento = String(
        statusPagamento
      ).toUpperCase();
    }

    const referenceId =
      dados?.reference_id ||
      dados?.charges?.[0]?.reference_id ||
      null;

    const checkoutId =
      dados?.id ||
      dados?.checkout_id ||
      null;

    const paymentId =
      dados?.charges?.[0]?.id ||
      dados?.payment_id ||
      null;

    if (referenceId) {
      await pool.query(
        `
        UPDATE pedidos
        SET
          payment_status = ?,
          pagbank_checkout_id =
            COALESCE(?, pagbank_checkout_id),
          pagbank_payment_id =
            COALESCE(?, pagbank_payment_id),
          status =
            CASE
              WHEN ? IN ('PAID', 'AVAILABLE') THEN 'pago'
              WHEN ? IN ('CANCELED', 'DECLINED', 'DENIED') THEN 'cancelado'
              ELSE status
            END
        WHERE pagbank_reference_id = ?
        `,
        [
          statusPagamento,
          checkoutId,
          paymentId,
          statusPagamento,
          statusPagamento,
          referenceId
        ]
      );
    }

    res.status(200).json({
      ok: true
    });
  } catch (erro) {
    console.error(
      "Erro webhook PagBank:",
      erro
    );

    res.status(500).json({
      ok: false,
      erro: erro.message
    });
  }
});

// =====================================================
// SINCRONIZAR CHECKOUT PAGBANK
// =====================================================

app.get(
  "/api/pagbank/sincronizar/:id",
  async (req, res) => {
    try {
      const pedidoId = Number(req.params.id);

      if (!pedidoId) {
        return res.status(400).json({
          ok: false,
          erro: "ID do pedido inválido."
        });
      }

      const [pedidos] = await pool.query(
        `
        SELECT *
        FROM pedidos
        WHERE id = ?
        `,
        [pedidoId]
      );

      if (!pedidos.length) {
        return res.status(404).json({
          ok: false,
          erro: "Pedido não encontrado."
        });
      }

      const pedido = pedidos[0];

      if (!pedido.pagbank_checkout_id) {
        return res.status(400).json({
          ok: false,
          erro:
            "Este pedido não possui pagbank_checkout_id."
        });
      }

      if (!PAGBANK_TOKEN) {
        return res.status(500).json({
          ok: false,
          erro:
            "PAGBANK_TOKEN não configurado."
        });
      }

      const resposta = await fetch(
        `${PAGBANK_API}/checkouts/${pedido.pagbank_checkout_id}`,
        {
          method: "GET",

          headers: {
            "Authorization": `Bearer ${PAGBANK_TOKEN}`,
            "Content-Type": "application/json",
            "Accept": "application/json"
          }
        }
      );

      const texto = await resposta.text();

      let dados;

      try {
        dados = JSON.parse(texto);
      } catch {
        dados = {
          resposta: texto
        };
      }

      console.log(
        "Sincronização PagBank:",
        resposta.status,
        JSON.stringify(dados)
      );

      if (!resposta.ok) {
        return res.status(502).json({
          ok: false,
          erro: "Erro ao consultar Checkout no PagBank.",
          pagbank: dados
        });
      }

      const statusPagamento =
        dados?.charges?.[0]?.status ||
        dados?.status ||
        null;

      if (statusPagamento) {
        const statusUpper = String(
          statusPagamento
        ).toUpperCase();

        let statusPedido = pedido.status;

        if (
          statusUpper === "PAID" ||
          statusUpper === "AVAILABLE"
        ) {
          statusPedido = "pago";
        }

        if (
          statusUpper === "CANCELED" ||
          statusUpper === "DECLINED" ||
          statusUpper === "DENIED"
        ) {
          statusPedido = "cancelado";
        }

        await pool.query(
          `
          UPDATE pedidos
          SET
            payment_status = ?,
            status = ?,
            pagbank_payment_id =
              COALESCE(?, pagbank_payment_id)
          WHERE id = ?
          `,
          [
            statusUpper,
            statusPedido,
            dados?.charges?.[0]?.id || null,
            pedidoId
          ]
        );
      }

      res.json({
        ok: true,
        pedido_id: pedidoId,
        payment_status: statusPagamento,
        pagbank: dados
      });
    } catch (erro) {
      console.error(
        "Erro sincronizar PagBank:",
        erro
      );

      res.status(500).json({
        ok: false,
        erro: erro.message
      });
    }
  }
);

// =====================================================
// FALLBACK PARA /API
// =====================================================

app.use("/api", (req, res) => {
  res.status(404).json({
    ok: false,
    erro: "Rota da API não encontrada."
  });
});

// =====================================================
// PÁGINAS
// =====================================================

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "index.html")
  );
});

// =====================================================
// ERROS
// =====================================================

app.use((erro, req, res, next) => {
  console.error("Erro interno:", erro);

  res.status(500).json({
    ok: false,
    erro: erro.message || "Erro interno do servidor."
  });
});

// =====================================================
// SERVIDOR
// =====================================================

app.listen(PORT, () => {
  console.log("======================================");
  console.log("LUXOR iniciado");
  console.log("Porta:", PORT);
  console.log("Ambiente PagBank:", PAGBANK_ENV);
  console.log(
    "Token PagBank configurado:",
    Boolean(PAGBANK_TOKEN)
  );
  console.log(
    "URL pública:",
    PUBLIC_URL
  );
  console.log("======================================");
});
