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

// ==========================================
// BANCO DE DADOS
// ==========================================

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

// ==========================================
// MIDDLEWARE
// ==========================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(__dirname));

// ==========================================
// PÁGINAS
// ==========================================

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
  res.sendFile(
    path.join(__dirname, "pagamento-retorno.html")
  );
});

app.get("/painel/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// ==========================================
// TESTE DA API
// ==========================================

app.get("/api", async (req, res) => {
  let banco = false;

  try {
    const connection =
      await pool.getConnection();

    await connection.query("SELECT 1");

    connection.release();

    banco = true;
  } catch (error) {
    console.error(
      "Erro no banco:",
      error.message
    );
  }

  res.json({
    ok: true,
    servidor: "LUXOR",
    banco,
    pagbank: PAGBANK_ENV
  });
});

// ==========================================
// TESTE DO BANCO
// ==========================================

app.get("/api/banco", async (req, res) => {
  try {
    const [rows] =
      await pool.query(
        "SELECT 1 AS conectado"
      );

    res.json({
      ok: true,
      banco: rows[0]
    });

  } catch (error) {
    console.error(
      "Erro no banco:",
      error
    );

    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// ==========================================
// PRODUTOS
// ==========================================

app.get("/api/produtos", async (req, res) => {
  try {
    const [rows] =
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

    res.json(rows);

  } catch (error) {
    console.error(
      "Erro ao buscar produtos:",
      error
    );

    res.status(500).json({
      ok: false,
      error:
        "Erro ao buscar produtos."
    });
  }
});

// ==========================================
// CRIAR PEDIDO + PAGBANK
// ==========================================

app.post("/api/pedidos", async (req, res) => {
  try {

    const { cliente, produto } =
      req.body;

    if (!cliente) {
      return res.status(400).json({
        ok: false,
        error:
          "Dados do cliente não informados."
      });
    }

    if (!produto) {
      return res.status(400).json({
        ok: false,
        error:
          "Produto não informado."
      });
    }

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
      ).trim();

    const cpf =
      String(
        cliente.cpf || ""
      ).trim();

    const cep =
      String(
        cliente.cep || ""
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

    const estado =
      String(
        cliente.estado || ""
      ).trim();

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

    if (!nome || !email) {
      return res.status(400).json({
        ok: false,
        error:
          "Nome e e-mail são obrigatórios."
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
    }

    const referencia =
      "LUXOR-" +
      Date.now() +
      "-" +
      Math.floor(
        Math.random() * 10000
      );

    const [resultado] =
      await pool.query(`
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
          payment_status,
          pagbank_reference_id
        )
        VALUES
        (
          ?,
          ?,
          1,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          'AGUARDANDO_PAGAMENTO',
          'PENDING',
          ?
        )
      `,
      [
        produtoId,
        produtoNome,
        preco,
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
        referencia
      ]);

    const pedidoId =
      resultado.insertId;

    if (!PAGBANK_TOKEN) {
      return res.status(500).json({
        ok: false,
        error:
          "PAGBANK_TOKEN não configurado."
      });
    }

    const valorCentavos =
      Math.round(
        preco * 100
      );

    const customer = {
      name: nome,
      email: email,
      tax_id:
        cpf.replace(
          /\D/g,
          ""
        )
    };

    const checkoutPayload = {

      reference_id:
        referencia,

      customer,

      customer_modifiable:
        true,

      items: [
        {
          reference_id:
            String(
              produtoId || 1
            ),

          name:
            produtoNome,

          quantity: 1,

          unit_amount:
            valorCentavos
        }
      ],

      payment_methods: [
        {
          type:
            "CREDIT_CARD"
        },
        {
          type:
            "PIX"
        },
        {
          type:
            "BOLETO"
        }
      ],

      redirect_url:
        PUBLIC_URL +
        "/pagamento-retorno.html",

      return_url:
        PUBLIC_URL +
        "/index.html",

      notification_urls: [
        PUBLIC_URL +
        "/api/pagbank/webhook"
      ]
    };

    console.log(
      "Criando checkout PagBank:",
      referencia
    );

    const respostaPagBank =
      await fetch(
        PAGBANK_API +
        "/checkouts",
        {
          method: "POST",

          headers: {
            Authorization:
              "Bearer " +
              PAGBANK_TOKEN,

            "Content-Type":
              "application/json",

            Accept:
              "application/json"
          },

          body:
            JSON.stringify(
              checkoutPayload
            )
        }
      );

    const dadosPagBank =
      await respostaPagBank.json();

    if (
      !respostaPagBank.ok
    ) {

      console.error(
        "Erro PagBank:",
        dadosPagBank
      );

      return res.status(502).json({
        ok: false,
        error:
          "Erro ao criar pagamento no PagBank.",
        detalhe:
          dadosPagBank
      });
    }

    let payLink = null;

    if (
      Array.isArray(
        dadosPagBank.links
      )
    ) {

      const link =
        dadosPagBank.links.find(
          item =>
            item.rel === "PAY" ||
            item.rel === "payment"
        );

      if (link) {
        payLink =
          link.href;
      }
    }

    if (!payLink) {
      payLink =
        dadosPagBank.payment_link ||
        dadosPagBank.pay_link ||
        null;
    }

    const pagbankCheckoutId =
      dadosPagBank.id ||
      null;

    await pool.query(`
      UPDATE pedidos
      SET
        pagbank_checkout_id = ?,
        payment_status = 'PENDING'
      WHERE id = ?
    `,
    [
      pagbankCheckoutId,
      pedidoId
    ]);

    res.json({
      ok: true,
      pedidoId,
      pagbankCheckoutId,
      payLink
    });

  } catch (error) {

    console.error(
      "Erro ao criar pedido:",
      error
    );

    res.status(500).json({
      ok: false,
      error:
        error.message ||
        "Erro interno ao criar pedido."
    });
  }
});

// ==========================================
// CONSULTAR PEDIDO DO CLIENTE
// NOME + CPF
// ==========================================

app.get(
  "/api/pedidos/cliente",
  async (req, res) => {

    try {

      const nome =
        String(
          req.query.nome || ""
        ).trim();

      const cpf =
        String(
          req.query.cpf || ""
        ).replace(
          /\D/g,
          ""
        );

      if (!nome || !cpf) {

        return res.status(400).json({
          ok: false,
          error:
            "Nome e CPF são obrigatórios."
        });
      }

      if (cpf.length !== 11) {

        return res.status(400).json({
          ok: false,
          error:
            "CPF inválido."
        });
      }

      const [rows] =
        await pool.query(`
          SELECT
            id,
            criado_em,
            nome,
            produto_nome,
            quantidade,
            valor,
            status,
            payment_status
          FROM pedidos
          WHERE
            REPLACE(
              REPLACE(
                REPLACE(
                  cpf,
                  '.',
                  ''
                ),
                '-',
                ''
              ),
              ' ',
              ''
            ) = ?
            AND LOWER(
              TRIM(nome)
            ) =
            LOWER(
              TRIM(?)
            )
          ORDER BY
            criado_em DESC
        `,
        [
          cpf,
          nome
        ]);

      if (!rows.length) {

        return res.status(404).json({
          ok: false,
          error:
            "Nenhum pedido encontrado para este nome e CPF."
        });
      }

      const pedidos =
        rows.map(
          pedido => ({
            id:
              pedido.id,

            criado_em:
              pedido.criado_em,

            nome:
              pedido.nome,

            produto_nome:
              pedido.produto_nome,

            quantidade:
              Number(
                pedido.quantidade || 1
              ),

            valor:
              Number(
                pedido.valor || 0
              ),

            status:
              pedido.status,

            payment_status:
              pedido.payment_status
          })
        );

      res.json({
        ok: true,
        pedidos
      });

    } catch (error) {

      console.error(
        "Erro ao consultar pedido do cliente:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Erro ao consultar pedido."
      });
    }
  }
);

// ==========================================
// RESUMO DO ADMIN
// ==========================================

app.get(
  "/api/admin/resumo",
  async (req, res) => {

    try {

      const [rows] =
        await pool.query(`
          SELECT
            COUNT(*) AS quantidade,

            COALESCE(
              SUM(valor),
              0
            ) AS total,

            COUNT(
              DISTINCT email
            ) AS clientes,

            MAX(criado_em)
              AS ultima

          FROM pedidos

          WHERE
            payment_status =
              'PAID'

            OR status IN (
              'PAGO',
              'PAID',
              'APROVADO',
              'APPROVED'
            )
        `);

      res.json({

        quantidade:
          Number(
            rows[0].quantidade || 0
          ),

        total:
          Number(
            rows[0].total || 0
          ),

        clientes:
          Number(
            rows[0].clientes || 0
          ),

        ultima:
          rows[0].ultima || null
      });

    } catch (error) {

      console.error(
        "Erro no resumo do admin:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Erro ao carregar resumo administrativo."
      });
    }
  }
);

// ==========================================
// LISTAR PEDIDOS DO ADMIN
// ==========================================

app.get(
  "/api/admin/pedidos",
  async (req, res) => {

    try {

      const {
        q,
        inicio,
        fim
      } = req.query;

      let sql = `
        SELECT
          id,
          criado_em,
          nome,
          email,
          cpf,
          produto_nome,
          quantidade,
          valor,
          status,
          payment_status,
          pagbank_checkout_id
        FROM pedidos

        WHERE
          (
            payment_status = 'PAID'
            OR status IN (
              'PAGO',
              'PAID',
              'APROVADO',
              'APPROVED'
            )
          )
      `;

      const valores = [];

      if (q) {

        sql += `
          AND (
            CAST(id AS CHAR)
              LIKE ?

            OR nome
              LIKE ?

            OR email
              LIKE ?

            OR cpf
              LIKE ?

            OR produto_nome
              LIKE ?
          )
        `;

        const busca =
          "%" + q + "%";

        valores.push(
          busca,
          busca,
          busca,
          busca,
          busca
        );
      }

      if (inicio) {

        sql += `
          AND criado_em >= ?
        `;

        valores.push(
          inicio +
          " 00:00:00"
        );
      }

      if (fim) {

        sql += `
          AND criado_em <= ?
        `;

        valores.push(
          fim +
          " 23:59:59"
        );
      }

      sql += `
        ORDER BY
          criado_em DESC
      `;

      const [rows] =
        await pool.query(
          sql,
          valores
        );

      res.json(rows);

    } catch (error) {

      console.error(
        "Erro ao listar pedidos:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Erro ao listar pedidos."
      });
    }
  }
);

// ==========================================
// DETALHES DE UM PEDIDO
// ==========================================

app.get(
  "/api/admin/pedidos/:id",
  async (req, res) => {

    try {

      const id =
        Number(
          req.params.id
        );

      if (
        !Number.isInteger(id)
      ) {

        return res.status(400).json({
          ok: false,
          error:
            "ID do pedido inválido."
        });
      }

      const [rows] =
        await pool.query(
          `
          SELECT *
          FROM pedidos
          WHERE id = ?
          LIMIT 1
          `,
          [id]
        );

      if (!rows.length) {

        return res.status(404).json({
          ok: false,
          error:
            "Pedido não encontrado."
        });
      }

      res.json(
        rows[0]
      );

    } catch (error) {

      console.error(
        "Erro ao consultar pedido:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Erro ao consultar pedido."
      });
    }
  }
);

// ==========================================
// WEBHOOK PAGBANK
// ==========================================

app.post(
  "/api/pagbank/webhook",
  async (req, res) => {

    try {

      console.log(
        "Webhook PagBank recebido:"
      );

      console.log(
        JSON.stringify(
          req.body,
          null,
          2
        )
      );

      const body =
        req.body || {};

      const referenceId =
        body.reference_id ||
        body.referenceId ||
        null;

      const status =
        body.status ||
        null;

      if (
        referenceId &&
        status
      ) {

        let paymentStatus =
          "PENDING";

        let pedidoStatus =
          "AGUARDANDO_PAGAMENTO";

        if (
          status === "PAID" ||
          status === "APPROVED"
        ) {

          paymentStatus =
            "PAID";

          pedidoStatus =
            "PAGO";
        }

        if (
          status === "CANCELED" ||
          status === "CANCELLED"
        ) {

          paymentStatus =
            "CANCELED";

          pedidoStatus =
            "CANCELADO";
        }

        await pool.query(`
          UPDATE pedidos

          SET
            payment_status = ?,
            status = ?

          WHERE
            pagbank_reference_id = ?
        `,
        [
          paymentStatus,
          pedidoStatus,
          referenceId
        ]);
      }

      res.status(200).json({
        ok: true
      });

    } catch (error) {

      console.error(
        "Erro no webhook PagBank:",
        error
      );

      res.status(500).json({
        ok: false
      });
    }
  }
);

// ==========================================
// FALLBACK DA API
// ==========================================

app.use(
  (req, res, next) => {

    if (
      req.path.startsWith("/api")
    ) {

      return res.status(404).json({
        ok: false,

        error:
          "Rota da API não encontrada.",

        rota:
          req.method +
          " " +
          req.originalUrl
      });
    }

    next();
  }
);

// ==========================================
// ERRO GERAL
// ==========================================

app.use(
  (
    error,
    req,
    res,
    next
  ) => {

    console.error(
      "Erro geral:",
      error
    );

    res.status(500).json({
      ok: false,
      error:
        "Erro interno do servidor."
    });
  }
);

// ==========================================
// INICIAR SERVIDOR
// ==========================================

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `LUXOR rodando na porta ${PORT}`
    );

    console.log(
      "PagBank:",
      PAGBANK_ENV
    );

    console.log(
      "URL:",
      PUBLIC_URL
    );
  }
);
